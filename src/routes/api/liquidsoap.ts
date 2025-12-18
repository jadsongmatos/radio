// src/routes/api/liquidsoap.ts
import { createFileRoute } from '@tanstack/react-router'

const LISTENBRAINZ_LB_RADIO = 'https://api.listenbrainz.org/1/explore/lb-radio'

const LB_TOKEN = process.env.LISTENBRAINZ_TOKEN || ''
const LB_USER_AGENT =
  process.env.LISTENBRAINZ_USER_AGENT || 'MyRadio/1.0 (jadson.g-matos@oultook.com)'

// Queremos garantir que, antes de entregar 1, existam pelo menos 2 pendentes.
// Assim, depois de marcar 1 como entregue, ainda sobra 1 na fila.
const TARGET_UNDELIVERED_BEFORE_DELIVER = 2

// quanto tempo o item fica no banco depois de entregue
const DELETE_TTL_MS = 10 * 60 * 1000

// throttle simples pra não spammar LB/YT em caso de prefetch/retry do liquidsoap
let lastAutofillAt = 0
const AUTOFILL_COOLDOWN_MS = 10_000

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

    // se não tiver dimensões, ainda dá pra ranquear por domínio
    const hasDims = w > 0 && h > 0
    const ratio = hasDims ? w / h : 1

    const isSquareish = hasDims ? Math.abs(ratio - 1) <= 0.15 : false
    const isVideoish = hasDims ? ratio >= 1.55 && ratio <= 2.05 : false

    const isGoogle = /googleusercontent\.com|lh3\.googleusercontent\.com/i.test(url)
    const isYtImg = /i\.ytimg\.com/i.test(url)

    let score = hasDims ? w * h : 1

    if (isSquareish) score *= 3
    if (isVideoish) score *= 0.2

    if (isGoogle) score *= 2
    if (isYtImg) score *= 0.8

    // bônus leve se parecer "capa" pelo caminho
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

// opcional: “upscale” de googleusercontent para evitar capas pequenas
function upscaleGoogleThumb(url: string, size = 800) {
  if (!/googleusercontent\.com|lh3\.googleusercontent\.com/i.test(url)) return url

  if (url.includes('=s')) return url.replace(/=s\d+/i, `=s${size}`)
  if (url.includes('=w') && url.includes('-h')) {
    return url.replace(/=w\d+-h\d+/i, `=w${size}-h${size}`)
  }
  return `${url}=s${size}`
}

async function getBetterCoverFromTrackInfo(videoId: string): Promise<string | null> {
  try {
    const yt = await getYT()
    const info = await yt.music.getInfo(videoId)

    // dependendo da versão, thumbnail pode estar em basic_info.thumbnail ou dentro de thumbnails
    const cover =
      pickBestCoverThumbUrl(info?.basic_info?.thumbnail) ||
      pickBestCoverThumbUrl(info?.basic_info?.thumbnail?.thumbnails) ||
      null

    return cover ? upscaleGoogleThumb(cover, 800) : null
  } catch {
    return null
  }
}

async function resolveCoverUrlForCandidate(it: any, videoId: string): Promise<string | null> {
  // 1) tenta usar thumb do resultado de busca (rápido)
  let cover =
    pickBestCoverThumbUrl(it?.thumbnails) ||
    pickBestCoverThumbUrl(it?.thumbnail?.thumbnails) ||
    null

  // 2) se não vier nada OU parecer thumb de vídeo, tenta melhorar com TrackInfo
  if (!cover || isProbablyVideoThumbUrl(cover)) {
    const better = await getBetterCoverFromTrackInfo(videoId)
    if (better) cover = better
  }

  // 3) se for googleusercontent, tenta upscale
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

  const liveAtFromAfterSeparator =
    /(?:\s[-–—|]\s*)live\s+(at|from)\b/i.test(t)

  const aLower = a.toLowerCase()
  const liveAlbum =
    /^\s*live\b/i.test(aLower) ||
    /\b(ao vivo|en vivo|en directo|directo)\b/i.test(aLower)

  return liveInBrackets || liveAfterSeparator || liveAtFromAfterSeparator || liveAlbum
}

type YtResolved = {
  videoId: string
  title: string
  artistName: string
  albumName?: string | null
  thumbnailUrl?: string | null
  youtubeUrl: string
}

async function searchYouTubeMusicFirstSong(query: string): Promise<YtResolved | null> {
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

      // >>> capa melhorada aqui <<<
      const thumb = await resolveCoverUrlForCandidate(it, videoId)

      return {
        videoId,
        title,
        artistName,
        albumName: albumName ?? null,
        thumbnailUrl: thumb ?? null, // sem fallback de thumb de vídeo
        youtubeUrl,
      }
    }
  }

  return null
}

type LbRadioResponse = {
  payload?: {
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

async function fetchLbRadio(prompt: string, mode: 'easy' | 'medium' | 'hard' = 'easy') {
  const url = new URL(LISTENBRAINZ_LB_RADIO)
  url.searchParams.set('prompt', prompt)
  url.searchParams.set('mode', mode)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': LB_USER_AGENT,
    }
    if (LB_TOKEN) headers.Authorization = `Token ${LB_TOKEN}`

    const res = await fetch(url.toString(), { method: 'GET', headers, signal: controller.signal })
    if (!res.ok) return []

    const data = (await res.json().catch(() => null)) as LbRadioResponse | null
    const tracks = data?.payload?.jspf?.playlist?.track
    return Array.isArray(tracks) ? tracks : []
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

async function cleanupExpired(prisma: any) {
  const now = new Date()
  await prisma.radioRequest.deleteMany({
    where: { deleteAt: { lte: now } },
  })
}

async function ensurePrefill(prisma: any) {
  const now = Date.now()
  if (now - lastAutofillAt < AUTOFILL_COOLDOWN_MS) return
  lastAutofillAt = now

  const undeliveredCount = await prisma.radioRequest.count({
    where: { deleteAt: null },
  })

  const need = Math.max(0, TARGET_UNDELIVERED_BEFORE_DELIVER - undeliveredCount)
  if (need === 0) return

  const seed =
    (await prisma.radioRequest.findFirst({
      where: { deleteAt: null },
      orderBy: { createdAt: 'desc' },
      select: { trackName: true, artistName: true },
    })) ||
    (await prisma.radioRequest.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { trackName: true, artistName: true },
    }))

  // último tocado = maior deleteAt (como deleteAt = deliveredAt + 10min, serve bem)
  const lastPlayed =
    (await prisma.radioRequest.findFirst({
      where: { deleteAt: { not: null } },
      orderBy: { deleteAt: 'desc' },
      select: { trackName: true },
    })) ||
    (await prisma.radioRequest.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { trackName: true },
    }))

  const lastTitleKey = normalizeTrackName(lastPlayed?.trackName ?? '')

  const prompt = seed?.artistName ? buildPromptFromArtist(seed.artistName) : 'popular songs'
  const lbTracks = await fetchLbRadio(prompt, 'easy')

  let inserted = 0
  const seenComboKeys = new Set<string>()

  for (const t of lbTracks.slice(0, 25)) {
    if (inserted >= need) break

    const title = (t?.title ?? '').trim()
    const artist = (t?.creator ?? '').trim()
    const album = (t?.album ?? '').trim()
    if (!title || !artist) continue

    const titleKey = normalizeTrackName(title)
    const artistKey = normalizeArtist(artist).toLowerCase()
    const comboKey = `${titleKey}::${artistKey}`

    if (lastTitleKey && titleKey && titleKey === lastTitleKey) continue
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
        releaseName: yt.albumName || (album || null),
        coverUrl: yt.thumbnailUrl || null,
        youtubeUrl: yt.youtubeUrl,
        deleteAt: null,
      },
    })

    inserted++
  }

  if (undeliveredCount === 0 && inserted === 0) {
    console.log("undeliveredCount",undeliveredCount,"inserted",inserted)
  }
}

/**
 * Entrega o mais antigo (deleteAt=null) e marca deleteAt = now + 10min.
 * Se não houver pendentes, tenta “replay” do último item do DB (sem marcar nada).
 */
function deliverOne(prisma: any) {
  return prisma.$transaction(async (tx: any) => {
    const next = await tx.radioRequest.findFirst({
      where: { deleteAt: null },
      orderBy: { createdAt: 'asc' },
    })

    if (next) {
      await tx.radioRequest.update({
        where: { id: next.id },
        data: { deleteAt: new Date(Date.now() + DELETE_TTL_MS) },
      })
      return next
    }

    const lastAny = await tx.radioRequest.findFirst({
      orderBy: { createdAt: 'desc' },
    })
    return lastAny ?? null
  })
}

export const Route = createFileRoute('/api/liquidsoap')({
  server: {
    handlers: {
      GET: async () => {
        const { prisma } = await import('@/db')

        // 0) primeira coisa: apagar vencidas
        try {
          await cleanupExpired(prisma)
        } catch {
          // não derruba o liquidsoap
          console.log("catch cleanupExpired")
        }

        // 1) garante prefill se a fila estiver baixa
        try {
          await ensurePrefill(prisma)
        } catch {
          // não derruba o liquidsoap
        }

        // 2) entrega 1 item
        let next: any = null
        try {
          next = await deliverOne(prisma)
        } catch {
          next = null
        }

        // 3) resposta “pronta para AzuraCast” (1 linha)
        if (!next?.youtubeUrl) {
          return new Response('', {
            status: 204,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        }

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

