// src/routes/api/liquidsoap.ts
import { createFileRoute } from '@tanstack/react-router'
import { ApiError, ListenBrainzClient } from '@kellnerd/listenbrainz'

const LB_RADIO_ENDPOINT = '1/explore/lb-radio'
const LB_TOKEN = process.env.LISTENBRAINZ_TOKEN || ''

// Queremos garantir que, antes de entregar 1, existam pelo menos 2 pendentes.
const TARGET_UNDELIVERED_BEFORE_DELIVER = 2

// quanto tempo o item fica no banco depois de entregue
const DELETE_TTL_MS = 10 * 60 * 1000

// throttle simples pra não spammar LB/YT em caso de prefetch/retry do liquidsoap
let lastAutofillAt = 0
const AUTOFILL_COOLDOWN_MS = 10_000

let ytPromise: Promise<any> | null = null
let lbClient: ListenBrainzClient | null = null

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
} as const

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

class ListenBrainzNetworkError extends Error {
  cause?: any
  constructor(message: string, cause?: any) {
    super(message)
    this.name = 'ListenBrainzNetworkError'
    this.cause = cause
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function isTransientNetworkError(err: any) {
  const code = err?.cause?.code || err?.code
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND'
  )
}

function getLB() {
  // Sem fallback: token é obrigatório
  if (!LB_TOKEN) throw new Error('LISTENBRAINZ_TOKEN não definido')
  if (!lbClient) {
    lbClient = new ListenBrainzClient({
      userToken: LB_TOKEN,
      maxRetries: 1,
    })
  }
  return lbClient
}

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

async function getYT() {
  if (!ytPromise) {
    const { Innertube } = await import('youtubei.js')
    ytPromise = Innertube.create() // sem cookie
  }
  return ytPromise
}

type Thumb = { url?: string; width?: number; height?: number }

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

type LbRadioResponse = {
  payload?: {
    feedback?: any
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

// Se prompt vazio -> erro interno (500 na API)
async function fetchLbRadio(
  prompt: string,
  mode: 'easy' | 'medium' | 'hard' = 'easy',
) {
  const trimmed = (prompt ?? '').trim()
  if (!trimmed) {
    throw new ListenBrainzPromptEmptyError(
      'prompt vazio em fetchLbRadio (isso não deveria acontecer)',
    )
  }

  const client = getLB()
  const MAX_ATTEMPTS = 3

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const data = (await client.get(LB_RADIO_ENDPOINT, {
        prompt: trimmed,
        mode,
      })) as LbRadioResponse

      const tracks = data?.payload?.jspf?.playlist?.track
      return Array.isArray(tracks) ? tracks : []
    } catch (err: any) {
      if (err instanceof ApiError) {
        console.log('LB ApiError', err.statusCode, err.message)
        return []
      }

      if (isTransientNetworkError(err) && attempt < MAX_ATTEMPTS) {
        const backoff = 250 * Math.pow(2, attempt - 1)
        console.log(
          `LB network error (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${backoff}ms`,
          err?.cause?.code || err?.code,
        )
        await sleep(backoff)
        continue
      }

      if (isTransientNetworkError(err)) {
        console.log('LB network error (final):', err?.cause?.code || err?.code)
        throw new ListenBrainzNetworkError(
          `listenbrainz-network:${err?.cause?.code || err?.code || 'unknown'}`,
          err,
        )
      }

      console.log('LB error', err)
      return []
    }
  }

  return []
}

async function cleanupExpired(prisma: any) {
  const now = new Date()
  await prisma.radioRequest.deleteMany({
    where: { deleteAt: { lte: now } },
  })
}

// ✅ Nunca entregar música com deleteAt != null.
// "tocáveis" = deleteAt=null e youtubeUrl não vazia
async function countUndeliveredPlayable(prisma: any) {
  return prisma.radioRequest.count({
    where: { deleteAt: null, youtubeUrl: { not: '' } },
  })
}

async function peekOldestUndeliveredPlayable(prisma: any) {
  return prisma.radioRequest.findFirst({
    where: { deleteAt: null, youtubeUrl: { not: '' } },
    orderBy: { createdAt: 'asc' },
  })
}

async function markAsDelivered(prisma: any, id: any) {
  await prisma.radioRequest.update({
    where: { id },
    data: { deleteAt: new Date(Date.now() + DELETE_TTL_MS) },
  })
}

async function ensurePrefill(prisma: any, opts?: { force?: boolean }) {
  const force = !!opts?.force

  const now = Date.now()
  if (!force && now - lastAutofillAt < AUTOFILL_COOLDOWN_MS) return
  lastAutofillAt = now

  const undeliveredPlayable = await countUndeliveredPlayable(prisma)
  const need = Math.max(
    0,
    TARGET_UNDELIVERED_BEFORE_DELIVER - undeliveredPlayable,
  )
  if (need === 0) return

  const lastPlayed = await prisma.radioRequest.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { trackName: true, artistName: true },
  })

  const seedPrompt =
    (lastPlayed?.artistName && buildPromptFromArtist(lastPlayed.artistName)) ||
    (lastPlayed?.trackName?.trim() ? lastPlayed.trackName : '#rock')

  const lbTracks = await fetchLbRadio(seedPrompt, 'easy')

  let inserted = 0
  const seenComboKeys = new Set<string>()
  const lastPlayedKey = normalizeTrackName(lastPlayed?.trackName ?? '')

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

  if (undeliveredPlayable === 0 && inserted === 0) {
    throw new ListenBrainzEmptyError(
      'ListenBrainz retornou playlist, mas nenhuma track foi resolvida para YouTube Music.',
    )
  }
}

function internal500(message: string) {
  return new Response(`${message}\n`, {
    status: 500,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...NO_CACHE_HEADERS,
    },
  })
}

function lb502(message: string) {
  return new Response(`${message}\n`, {
    status: 502,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...NO_CACHE_HEADERS,
    },
  })
}

export const Route = createFileRoute('/api/liquidsoap')({
  server: {
    handlers: {
      GET: async () => {
        const { prisma } = await import('@/db')

        // 0) apagar vencidas
        try {
          await cleanupExpired(prisma)
        } catch {
          console.log('catch cleanupExpired')
        }

        // 1) tenta prefill “normal”
        try {
          await ensurePrefill(prisma)
        } catch (err: any) {
          if (err?.name === 'ListenBrainzPromptEmptyError')
            return internal500(`internal-error:${err.message}`)
          if (err?.name === 'ListenBrainzNetworkError')
            return lb502(err.message)
          if (err?.name === 'ListenBrainzEmptyError')
            return lb502(`listenbrainz-error:${err.message}`)
        }

        // 2) pega o próximo pendente (deleteAt=null). Nunca usar replay.
        let next: any = null
        try {
          next = await peekOldestUndeliveredPlayable(prisma)
        } catch {
          next = null
        }

        // 3) Se NÃO existir nenhum deleteAt=null, força prefill.
        //    Se ainda assim não existir, ERRO (nunca 204, nunca replay).
        if (!next) {
          try {
            await ensurePrefill(prisma, { force: true })
          } catch (err: any) {
            if (err?.name === 'ListenBrainzPromptEmptyError')
              return internal500(`internal-error:${err.message}`)
            if (err?.name === 'ListenBrainzNetworkError')
              return lb502(err.message)
            if (err?.name === 'ListenBrainzEmptyError')
              return lb502(`listenbrainz-error:${err.message}`)
          }

          try {
            next = await peekOldestUndeliveredPlayable(prisma)
          } catch {
            next = null
          }

          if (!next?.youtubeUrl) {
            return internal500('internal-error:no-undelivered-tracks')
          }
        }

        // 4) existe "next" pendente (deleteAt=null).
        //    Regra: só marca deleteAt no final; se for a última, só marca depois de achar próxima.
        let undeliveredPlayable = 0
        try {
          undeliveredPlayable = await countUndeliveredPlayable(prisma)
        } catch {
          undeliveredPlayable = 0
        }

        if (undeliveredPlayable <= 1) {
          try {
            await ensurePrefill(prisma, { force: true })
          } catch (err: any) {
            if (err?.name === 'ListenBrainzPromptEmptyError')
              return internal500(`internal-error:${err.message}`)
            if (err?.name === 'ListenBrainzNetworkError')
              return lb502(err.message)
            if (err?.name === 'ListenBrainzEmptyError') {
              // não marca deleteAt -> evita "sumir" a última
              console.log('listenbrainz empty while last track:', err.message)
            }
          }

          try {
            undeliveredPlayable = await countUndeliveredPlayable(prisma)
          } catch {
            undeliveredPlayable = 0
          }
        }

        // Só marca como entregue se garantir que havia >=2 pendentes antes de marcar
        if (undeliveredPlayable >= 2 && next?.id) {
          try {
            await markAsDelivered(prisma, next.id)
          } catch {
            // não derruba
          }
        }

        return new Response(`youtube-dl:${next.youtubeUrl}\n`, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            ...NO_CACHE_HEADERS,
          },
        })
      },
    },
  },
})
