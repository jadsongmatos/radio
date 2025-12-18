// src/api/queue.ts
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
  'Surrogate-Control': 'no-store',
  'CDN-Cache-Control': 'no-store',
}

function isValidYouTubeUrl(url: string) {
  const u = url.trim()
  if (!u) return false
  return /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|music\.youtube\.com\/watch\?v=)/i.test(
    u,
  )
}

function isLikelyYouTubeVideoId(id: string) {
  return /^[a-zA-Z0-9_-]{6,20}$/.test(id)
}

function parseDurationTextToSec(s?: string | null) {
  if (!s) return null
  const parts = s
    .split(':')
    .map((p) => p.trim())
    .filter(Boolean)

  if (parts.some((p) => !/^\d+$/.test(p))) return null

  const nums = parts.map(Number)
  if (nums.length === 3) {
    const [h, m, sec] = nums
    return h * 3600 + m * 60 + sec
  }
  if (nums.length === 2) {
    const [m, sec] = nums
    return m * 60 + sec
  }
  if (nums.length === 1) return nums[0]
  return null
}

function normalizeDurationSec(body: AddBodyCompat) {
  const raw = body.durationSec
  if (Number.isFinite(raw)) return Math.max(0, Math.floor(raw as number))

  const parsed = parseDurationTextToSec(body.durationText ?? null)
  return parsed ?? 0
}

type AddBodyCompat = {
  videoId?: string
  albumName?: string

  recordingMbid?: string
  releaseName?: string

  trackName?: string
  artistName?: string
  coverUrl?: string
  youtubeUrl?: string

  durationSec?: number
  durationText?: string
}

export const Route = createFileRoute('/api/queue')({
  server: {
    handlers: {
      GET: async () => {
        const { prisma } = await import('@/db')

        const items = await prisma.radioRequest.findMany({
          where: { deleteAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })

        return json(items, { headers: NO_STORE_HEADERS })
      },

      POST: async ({ request }) => {
        const { prisma } = await import('@/db')

        let body: AddBodyCompat | null = null
        try {
          body = (await request.json()) as AddBodyCompat
        } catch {
          return json(
            { message: 'JSON inválido.' },
            { status: 400, headers: NO_STORE_HEADERS },
          )
        }

        const videoId = (body.videoId ?? body.recordingMbid ?? '').trim()
        const trackName = (body.trackName ?? '').trim()
        const artistName = (body.artistName ?? '').trim()
        const youtubeUrl = (body.youtubeUrl ?? '').trim()

        const releaseNameRaw = (body.albumName ?? body.releaseName ?? '').trim()
        const releaseName = releaseNameRaw ? releaseNameRaw : null

        const coverUrlRaw = (body.coverUrl ?? '').trim()
        const coverUrl = coverUrlRaw ? coverUrlRaw : null

        const durationSec = normalizeDurationSec(body)

        if (!videoId) {
          return json(
            { message: 'videoId (ou recordingMbid) é obrigatório.' },
            { status: 400, headers: NO_STORE_HEADERS },
          )
        }

        if (!isLikelyYouTubeVideoId(videoId)) {
          return json(
            { message: 'videoId inválido.' },
            { status: 400, headers: NO_STORE_HEADERS },
          )
        }

        if (!trackName || !artistName || !youtubeUrl) {
          return json(
            { message: 'trackName, artistName e youtubeUrl são obrigatórios.' },
            { status: 400, headers: NO_STORE_HEADERS },
          )
        }

        if (!isValidYouTubeUrl(youtubeUrl)) {
          return json(
            { message: 'Link do YouTube inválido.' },
            { status: 400, headers: NO_STORE_HEADERS },
          )
        }

        const created = await prisma.radioRequest.create({
          data: {
            recordingMbid: videoId,
            trackName,
            artistName,
            releaseName,
            coverUrl,
            youtubeUrl,
            durationSec,
          },
        })

        return json(created, { status: 201, headers: NO_STORE_HEADERS })
      },
    },
  },
})
