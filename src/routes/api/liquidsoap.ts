// src/routes/api/liquidsoap.ts
import { createFileRoute } from '@tanstack/react-router'

// 
// Config
// 

// Queremos garantir que, antes de entregar 1, existam pelo menos 2 pendentes.
// Assim, depois de marcar 1 como entregue, ainda sobra 1 na fila.
const TARGET_UNDELIVERED_BEFORE_DELIVER = 2

// quanto tempo o item fica no banco depois de entregue
const DELETE_TTL_MS = 10 * 60 * 1000

// throttle simples pra não spammar LB/YT em caso de prefetch/retry do liquidsoap
let lastAutofillAt = 0
const AUTOFILL_COOLDOWN_MS = 10_000

// token é obrigatório (você disse que sempre vai ter)
const LB_TOKEN = process.env.LISTENBRAINZ_TOKEN ?? ''
const LB_USER_AGENT =
  process.env.LISTENBRAINZ_USER_AGENT ||
  'MyRadio/1.0 (jadson.g-matos@oultook.com)'

// MusicBrainz app identification (recomendado pelo musicbrainz-api)
const MB_APP_NAME = process.env.MUSICBRAINZ_APP_NAME || 'MyRadio'
const MB_APP_VERSION = process.env.MUSICBRAINZ_APP_VERSION || '1.0.0'
const MB_APP_CONTACT = process.env.MUSICBRAINZ_APP_CONTACT || LB_USER_AGENT

// 
// Errors
// 

class ListenBrainzEmptyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ListenBrainzEmptyError'
  }
}

class ListenBrainzPromptEmptyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ListenBrainzPromptEmptyError'
  }
}

class ListenBrainzSeedMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ListenBrainzSeedMissingError'
  }
}

// 
// Helpers: YouTube
// 

let ytPromise: Promise<any> | null = null

function isValidYouTubeUrl(url: string) {
  const u = url.trim()
  if (!u) return false
  return /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|music\.youtube\.com\/watch\?v=)/i.test(
    u,
  )
}

function normalizeArtist(raw: string) {
  return raw
    .replace(/\s+-\s+Topic$/i, '')
    .replace(/\s+VEVO$/i, '')
    .replace(/\b(feat\.?|ft\.?)\b.*$/i, '')
    .replace(/[“”"]/g, '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeTrackName(raw: string) {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[“”"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildPromptFromArtist(artistName: string) {
  const a = normalizeArtist(artistName)
  if (!a) return 'popular songs'
  return `artist:(${a})`
}

function buildPromptFromArtistMbid(artistMbid: string) {
  return `artist:(${artistMbid})`
}

async function getYT() {
  if (!ytPromise) {
    const { Innertube } = await import('youtubei.js')
    ytPromise = Innertube.create() // sem cookie
  }
  return ytPromise
}

type Thumb = { url?: string; width?: number; height?: number }

/**
 * Escolhe a melhor "capa" com heurística:
 * - prefere thumbs quadradas (ou quase)
 * - penaliza 16:9
 * - prefere googleusercontent (muito comum pra album art)
 * - evita i.ytimg.com (geralmente thumb de vídeo)
 */
function pickBestCoverThumbUrl(thumbnails: any): string | null {
  const arr: Array<Thumb> = Array.isArray(thumbnails)
    ? thumbnails
    : Array.isArray(thumbnails?.thumbnails)
      ? thumbnails.thumbnails
      : []

  let best: { url: string; score: number } | null = null

  for (const t of arr) {
    const url = typeof t?.url === 'string' ? t.url : null
    const w = Number(t?.width ?? 0)
    const h = Number(t?.height ?? 0)
    if (!url) continue

    const hasDims = w > 0 && h > 0
    const ratio = hasDims ? w / h : 1

    const isSquareish = hasDims ? Math.abs(ratio - 1) <= 0.15 : false
    const isVideoish = hasDims ? ratio >= 1.55 && ratio <= 2.05 : false

    const isGoogle = /googleusercontent\.com|lh3\.googleusercontent\.com/i.test(
      url,
    )
    const isYtImg = /i\.ytimg\.com/i.test(url)

    let score = hasDims ? w * h : 1

    if (isSquareish) score *= 3
    if (isVideoish) score *= 0.2

    if (isGoogle) score *= 2
    if (isYtImg) score *= 0.8

    if (/=s\d+/i.test(url) || /w\d+-h\d+/i.test(url)) score *= 1.1

    if (!best || score > best.score) best = { url, score }
  }

  return best?.url ?? null
}

function isProbablyVideoThumbUrl(url: string) {
  const u = (url ?? '').toLowerCase()
  return (
    u.includes('i.ytimg.com/vi/') ||
    u.includes('/hqdefault') ||
    u.includes('/mqdefault') ||
    u.includes('/sddefault') ||
    u.includes('/maxresdefault')
  )
}

function upscaleGoogleThumb(url: string, size = 800) {
  if (!/googleusercontent\.com|lh3\.googleusercontent\.com/i.test(url))
    return url

  if (url.includes('=s')) return url.replace(/=s\d+/i, `=s${size}`)
  if (url.includes('=w') && url.includes('-h')) {
    return url.replace(/=w\d+-h\d+/i, `=w${size}-h${size}`)
  }
  return `${url}=s${size}`
}

async function getBetterCoverFromTrackInfo(
  videoId: string,
): Promise<string | null> {
  try {
    const yt = await getYT()
    const info = await yt.music.getInfo(videoId)

    const cover =
      pickBestCoverThumbUrl(info?.basic_info?.thumbnail) ||
      pickBestCoverThumbUrl(info?.basic_info?.thumbnail?.thumbnails) ||
      null

    return cover ? upscaleGoogleThumb(cover, 800) : null
  } catch {
    return null
  }
}

async function resolveCoverUrlForCandidate(
  it: any,
  videoId: string,
): Promise<string | null> {
  let cover =
    pickBestCoverThumbUrl(it?.thumbnails) ||
    pickBestCoverThumbUrl(it?.thumbnail?.thumbnails) ||
    null

  if (!cover || isProbablyVideoThumbUrl(cover)) {
    const better = await getBetterCoverFromTrackInfo(videoId)
    if (better) cover = better
  }

  if (cover) cover = upscaleGoogleThumb(cover, 800)

  return cover
}

// Bloqueia “ao vivo” de forma conservadora (evita pegar “Live Forever”, etc.)
function isLikelyLiveRecording(title: string, albumName?: string | null) {
  const t = (title ?? '').trim()
  const a = (albumName ?? '').trim()

  const liveInBrackets =
    /[\(\[].*\b(live|ao vivo|en vivo|en directo|directo)\b.*[\)\]]/i.test(t)

  const liveAfterSeparator =
    /(?:\s[-–—|]\s*)(live|ao vivo|en vivo|en directo|directo)\b/i.test(t)

  const liveAtFromAfterSeparator = /(?:\s[-–—|]\s*)live\s+(at|from)\b/i.test(t)

  const aLower = a.toLowerCase()
  const liveAlbum =
    /^\s*live\b/i.test(aLower) ||
    /\b(ao vivo|en vivo|en directo|directo)\b/i.test(aLower)

  return (
    liveInBrackets ||
    liveAfterSeparator ||
    liveAtFromAfterSeparator ||
    liveAlbum
  )
}

type YtResolved = {
  videoId: string
  title: string
  artistName: string
  albumName?: string | null
  thumbnailUrl?: string | null
  youtubeUrl: string
}

async function searchYouTubeMusicFirstSong(
  query: string,
): Promise<YtResolved | null> {
  const yt = await getYT()
  const queries = [query, `${query} official audio`, `${query} audio`]

  for (const q of queries) {
    const r = await yt.music.search(q, { type: 'song' })
    const items: any[] = (r?.songs?.contents ?? []) as any[]

    for (const it of items) {
      const videoId: string | undefined =
        (typeof it?.id === 'string' && it.id) ||
        (typeof it?.video_id === 'string' && it.video_id) ||
        (typeof it?.videoId === 'string' && it.videoId)

      const title: string | undefined =
        (typeof it?.title === 'string' && it.title) ||
        (typeof it?.name === 'string' && it.name)

      const artistName: string | undefined =
        (typeof it?.artists?.[0]?.name === 'string' && it.artists[0].name) ||
        (typeof it?.author?.name === 'string' && it.author.name)

      const albumName: string | undefined =
        (typeof it?.album?.name === 'string' && it.album.name) ||
        (typeof it?.album?.title === 'string' && it.album.title)

      if (!videoId || !title || !artistName) continue
      if (isLikelyLiveRecording(title, albumName ?? null)) continue

      const youtubeUrl = `https://youtube.com/watch?v=${encodeURIComponent(videoId)}`
      if (!isValidYouTubeUrl(youtubeUrl)) continue

      const thumb = await resolveCoverUrlForCandidate(it, videoId)

      return {
        videoId,
        title,
        artistName,
        albumName: albumName ?? null,
        thumbnailUrl: thumb ?? null,
        youtubeUrl,
      }
    }
  }

  return null
}

// 
// Helpers: ListenBrainz (via @kellnerd/listenbrainz)
// 

type LbRadioResponse = {
  payload?: {
    feedback?: string[]
    jspf?: {
      playlist?: {
        track?: Array<{
          title?: string
          creator?: string
          album?: string
        }>
      }
    }
  }
}

let lbClientPromise: Promise<any> | null = null
async function getLBClient() {
  if (!LB_TOKEN.trim()) {
    throw new Error('LISTENBRAINZ_TOKEN ausente/empty (token é obrigatório).')
  }
  if (!lbClientPromise) {
    const { ListenBrainzClient } = await import('@kellnerd/listenbrainz')
    lbClientPromise = Promise.resolve(
      new ListenBrainzClient({
        userToken: LB_TOKEN.trim(),
        // se a lib suportar, você pode setar apiUrl/maxRetries aqui
      }),
    )
  }
  return lbClientPromise
}

// Regra sua: se prompt vier vazio => erro interno
async function fetchLbRadio(
  prompt: string,
  mode: 'easy' | 'medium' | 'hard' = 'easy',
) {
  const p = (prompt ?? '').trim()
  if (!p) {
    throw new ListenBrainzPromptEmptyError(
      'prompt do fetchLbRadio está vazio',
    )
  }

  const client = await getLBClient()

  try {
    // endpoint oficial: GET /1/explore/lb-radio :contentReference[oaicite:2]{index=2}
    const data = (await client.get('/1/explore/lb-radio', {
      prompt: p,
      mode,
    })) as LbRadioResponse

    const tracks = data.payload?.jspf?.playlist?.track
    return Array.isArray(tracks) ? tracks : []
  } catch (err: any) {
    // Ex.: ApiError 400 "Artist ... could not be looked up"
    // A estratégia de seed por MBID (abaixo) ajuda a evitar isso. :contentReference[oaicite:3]{index=3}
    throw err
  }
}

// 
// Helpers: MusicBrainz (via musicbrainz-api)
// 

const MBID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isMbid(s: string) {
  return MBID_RE.test((s ?? '').trim())
}

function luceneQuote(s: string) {
  // escapa " e \
  const safe = (s ?? '').replace(/([\\"])/g, '\\$1')
  return `"${safe}"`
}

let mbApiPromise: Promise<any> | null = null
async function getMBApi() {
  if (!mbApiPromise) {
    const { MusicBrainzApi } = await import('musicbrainz-api')
    mbApiPromise = Promise.resolve(
      new MusicBrainzApi({
        // MusicBrainz pede que clientes se identifiquem por User-Agent
        // via appName/appVersion/appContactInfo. :contentReference[oaicite:4]{index=4}
        appName: MB_APP_NAME,
        appVersion: MB_APP_VERSION,
        appContactInfo: MB_APP_CONTACT,
      }),
    )
  }
  return mbApiPromise
}

/**
 * Tenta descobrir o MBID do artista usando MusicBrainz.
 *
 * Estratégia:
 * 1) se tiver (track + artist), tenta search em "recording" usando campos recording e artist,
 *    porque você pediu "Use nome da música e mais nome do artista".
 *    Campos "recording" e "artist" existem no Search Server. :contentReference[oaicite:5]{index=5}
 * 2) fallback: search em "artist" pelo nome do artista.
 */
async function resolveArtistMbidFromMusicBrainz(
  rawArtistName: string,
  rawTrackName?: string | null,
): Promise<string | null> {
  const artistName = normalizeArtist(rawArtistName)
  const trackName = (rawTrackName ?? '').trim()

  if (!artistName) return null

  const mb = await getMBApi()

  // (1) recording search: recording:"..." AND artist:"..."
  if (trackName) {
    const q = `recording:${luceneQuote(trackName)} AND artist:${luceneQuote(
      artistName,
    )}`

    try {
      // assinatura aceita offset/limit conforme README (offset?, limit?) :contentReference[oaicite:6]{index=6}
      const result = (await mb.search('recording', q, 0, 5)) as any
      const recs: any[] = Array.isArray(result?.recordings)
        ? result.recordings
        : []

      for (const r of recs) {
        const ac = r?.['artist-credit'] ?? r?.artist_credit ?? r?.artistCredit
        if (!Array.isArray(ac) || ac.length === 0) continue
        const id = ac?.[0]?.artist?.id
        if (typeof id === 'string' && isMbid(id)) return id
      }
    } catch {
      // ignora e tenta por artist abaixo
    }
  }

  // (2) artist search
  try {
    const result = (await mb.search('artist', { query: artistName }, 0, 1)) as any
    const id = result?.artists?.[0]?.id
    if (typeof id === 'string' && isMbid(id)) return id
  } catch {
    // nada
  }

  return null
}

// 
// DB helpers
// 

async function cleanupExpired(prisma: any) {
  const now = new Date()
  await prisma.radioRequest.deleteMany({
    where: { deleteAt: { lte: now } },
  })
}

async function countUndeliveredPlayable(prisma: any) {
  return prisma.radioRequest.count({
    where: {
      deleteAt: null,
      youtubeUrl: { not: null },
    },
  })
}

async function getLatestDeliveredByDeleteAt(prisma: any) {
  return prisma.radioRequest.findFirst({
    where: {
      deleteAt: { not: null },
      youtubeUrl: { not: null },
    },
    orderBy: { deleteAt: 'desc' },
    select: { trackName: true, artistName: true },
  })
}

async function getLatestAnyByCreatedAt(prisma: any) {
  return prisma.radioRequest.findFirst({
    where: { youtubeUrl: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { trackName: true, artistName: true },
  })
}

/**
 * Regra sua:
 * - Se existe pelo menos 1 música com deleteAt=null (undelivered), podemos usar um seed "any" (última por createdAt).
 * - Se NÃO existe nenhuma deleteAt=null, devemos tentar seed pela entregue mais recente (deleteAt mais novo).
 * - Se nem isso existir => erro.
 */
async function getSeedTrackForLb(prisma: any, undeliveredPlayable: number) {
  if (undeliveredPlayable > 0) {
    // geralmente melhor para “continuar o vibe” do que seed vazio
    return (await getLatestAnyByCreatedAt(prisma)) ?? null
  }

  const lastDelivered = await getLatestDeliveredByDeleteAt(prisma)
  if (lastDelivered) return lastDelivered

  throw new ListenBrainzSeedMissingError(
    'Sem seed no banco: não existe deleteAt=null e também não existe nenhuma música entregue (deleteAt != null).',
  )
}

async function buildLbSeedPrompt(prisma: any, undeliveredPlayable: number) {
  const seed = await getSeedTrackForLb(prisma, undeliveredPlayable)

  const seedArtist = (seed?.artistName ?? '').trim()
  const seedTrack = (seed?.trackName ?? '').trim()

  // Preferir MBID para evitar erro 400 “could not be looked up”.
  // A doc do prompt diz que você pode usar artist MBID para ser preciso. :contentReference[oaicite:7]{index=7}
  if (seedArtist) {
    const mbid = await resolveArtistMbidFromMusicBrainz(seedArtist, seedTrack)
    if (mbid) return buildPromptFromArtistMbid(mbid)
    return buildPromptFromArtist(seedArtist)
  }

  if (seedTrack) return seedTrack

  // Se cair aqui e ficar vazio, fetchLbRadio vai gerar erro interno (regra sua).
  return ''
}

// 
// Prefill
// 

async function ensurePrefill(prisma: any, opts?: { force?: boolean }) {
  const force = !!opts?.force

  const now = Date.now()
  if (!force && now - lastAutofillAt < AUTOFILL_COOLDOWN_MS) return 0
  lastAutofillAt = now

  const undeliveredPlayable = await countUndeliveredPlayable(prisma)
  const need = Math.max(
    0,
    TARGET_UNDELIVERED_BEFORE_DELIVER - undeliveredPlayable,
  )
  if (need === 0) return 0

  const seedPrompt = await buildLbSeedPrompt(prisma, undeliveredPlayable)

  // regra sua: prompt vazio => erro interno (vai virar 500 na rota)
  if (!seedPrompt.trim()) {
    throw new ListenBrainzPromptEmptyError(
      'Seed prompt ficou vazio ao montar prompt do LB.',
    )
  }

  const lbTracks = await fetchLbRadio(seedPrompt, 'easy')

  let inserted = 0
  const seenComboKeys = new Set<string>()

  // Para evitar repetir a última música “exata”, pegamos a última do DB (createdAt desc)
  const lastAny = await prisma.radioRequest.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { trackName: true },
  })
  const lastPlayedKey = normalizeTrackName(lastAny?.trackName ?? '')

  for (const t of lbTracks) {
    if (inserted >= need) break

    const title = (t?.title ?? '').trim()
    const artist = (t?.creator ?? '').trim()
    const album = (t?.album ?? '').trim()
    if (!title || !artist) continue

    const titleKey = normalizeTrackName(title)
    const artistKey = normalizeArtist(artist).toLowerCase()
    const comboKey = `${titleKey}::${artistKey}`

    if (lastPlayedKey && titleKey && titleKey === lastPlayedKey) continue
    if (titleKey && artistKey && seenComboKeys.has(comboKey)) continue
    if (titleKey && artistKey) seenComboKeys.add(comboKey)

    const yt = await searchYouTubeMusicFirstSong(`${artist} - ${title}`)
    if (!yt) continue

    const exists = await prisma.radioRequest.findFirst({
      where: { youtubeUrl: yt.youtubeUrl },
      select: { id: true },
    })
    if (exists) continue

    await prisma.radioRequest.create({
      data: {
        recordingMbid: yt.videoId,
        trackName: yt.title,
        artistName: yt.artistName,
        releaseName: yt.albumName || album || null,
        coverUrl: yt.thumbnailUrl || null,
        youtubeUrl: yt.youtubeUrl,
        deleteAt: null,
      },
    })

    inserted++
  }

  // Se a fila estava totalmente vazia (sem nada playable) e não inseriu nada, erro.
  if (undeliveredPlayable === 0 && inserted === 0) {
    throw new ListenBrainzEmptyError(
      'ListenBrainz retornou playlist, mas nenhuma track foi resolvida para YouTube Music.',
    )
  }

  return inserted
}

// 
// Delivery
// 

/**
 * Entrega o mais antigo (deleteAt=null, youtubeUrl!=null).
 * Só marca deleteAt se houver "folga" (>= TARGET_UNDELIVERED_BEFORE_DELIVER).
 *
 * Isso atende sua regra:
 * - “Só deve adicionar deleteAt ... até quando for a última música só deve adicionar deleteAt após achar próxima”
 *   => se sobrar apenas 1 undeliveredPlayable, não marca deleteAt (entrega a mesma em chamadas subsequentes).
 */
function deliverOne(prisma: any, opts: { markDelivered: boolean }) {
  return prisma.$transaction(async (tx: any) => {
    const next = await tx.radioRequest.findFirst({
      where: { deleteAt: null, youtubeUrl: { not: null } },
      orderBy: { createdAt: 'asc' },
    })

    if (!next) return null

    if (opts.markDelivered) {
      await tx.radioRequest.update({
        where: { id: next.id },
        data: { deleteAt: new Date(Date.now() + DELETE_TTL_MS) },
      })
    }

    return next
  })
}

// 
// Route
// 

export const Route = createFileRoute('/api/liquidsoap')({
  server: {
    handlers: {
      GET: async () => {
        const { prisma } = await import('@/db')

        // 0) apagar vencidas
        try {
          await cleanupExpired(prisma)
        } catch {
          // não derruba
        }

        // 1) prefill só quando necessário
        let inserted = 0
        let undeliveredPlayableBefore = 0

        try {
          undeliveredPlayableBefore = await countUndeliveredPlayable(prisma)
          inserted = await ensurePrefill(prisma, {
            force: undeliveredPlayableBefore === 0,
          })
        } catch (err: any) {
          // prompt vazio => erro interno (regra sua)
          if (err?.name === 'ListenBrainzPromptEmptyError') {
            return new Response(`internal-error:${err.message}\n`, {
              status: 500,
              headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-store, max-age=0, must-revalidate',
                Pragma: 'no-cache',
                Expires: '0',
              },
            })
          }

          // sem seed no banco => erro interno (regra sua)
          if (err?.name === 'ListenBrainzSeedMissingError') {
            return new Response(`internal-error:${err.message}\n`, {
              status: 500,
              headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-store, max-age=0, must-revalidate',
                Pragma: 'no-cache',
                Expires: '0',
              },
            })
          }

          // se LB não gerou nada útil e a fila estava vazia => 502
          if (err?.name === 'ListenBrainzEmptyError') {
            return new Response(`listenbrainz-error:${err.message}\n`, {
              status: 502,
              headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-store, max-age=0, must-revalidate',
                Pragma: 'no-cache',
                Expires: '0',
              },
            })
          }

          // outros erros: não derruba imediatamente, mas pode acabar sem música e retornar 500 abaixo
        }

        // 2) reconta e entrega
        let undeliveredPlayableAfter = 0
        try {
          undeliveredPlayableAfter = await countUndeliveredPlayable(prisma)
        } catch {
          undeliveredPlayableAfter = 0
        }

        // Sua regra: se não tiver nenhuma música deleteAt=null (playable), tenta seed por delivered (feito dentro do ensurePrefill force),
        // e se ainda assim não tiver => erro.
        if (undeliveredPlayableAfter === 0) {
          return new Response(
            `internal-error:sem-música-disponível (deleteAt=null) e não foi possível preencher\n`,
            {
              status: 500,
              headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-store, max-age=0, must-revalidate',
                Pragma: 'no-cache',
                Expires: '0',
              },
            },
          )
        }

        // Só marca deleteAt se houver pelo menos TARGET pendentes (garante que sobra 1 depois).
        const markDelivered =
          undeliveredPlayableAfter >= TARGET_UNDELIVERED_BEFORE_DELIVER

        let next: any = null
        try {
          next = await deliverOne(prisma, { markDelivered })
        } catch {
          next = null
        }

        // Nunca entregar música com deleteAt != null: garantido por where deleteAt=null.
        // Se falhou, erro 500 (sem 204).
        if (!next?.youtubeUrl) {
          return new Response(`internal-error:sem-youtubeUrl-para-entregar\n`, {
            status: 500,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store, max-age=0, must-revalidate',
              Pragma: 'no-cache',
              Expires: '0',
            },
          })
        }

        // 3) resposta pronta pra AzuraCast (1 linha)
        return new Response(`youtube-dl:${next.youtubeUrl}\n`, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store, max-age=0, must-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
          },
        })
      },
    },
  },
})
