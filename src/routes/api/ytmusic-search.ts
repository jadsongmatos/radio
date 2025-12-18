// src/api/ytmusic-search.ts
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { Innertube, UniversalCache } from 'youtubei.js'

type SearchItem = {
  videoId: string
  title: string
  artists: Array<string>
  album?: string | null
  durationText?: string | null
  thumbnailUrl?: string | null
  youtubeUrl: string
}

type SearchResponse = {
  query: string
  items: Array<SearchItem>
}

let ytPromise: Promise<Innertube> | null = null

async function getYt() {
  if (!ytPromise) {
    // sem cookie / sem login
    // cache NÃO persistente (não escreve em disco)
    ytPromise = Innertube.create({
      cache: new UniversalCache(false),
    })
  }
  return ytPromise
}

function pickBestThumb(
  thumbs: Array<{ url: string; width?: number; height?: number }> | undefined,
) {
  if (!thumbs || thumbs.length === 0) return null
  const best = thumbs.reduce((a, b) => {
    const aa = (a.width ?? 0) * (a.height ?? 0)
    const bb = (b.width ?? 0) * (b.height ?? 0)
    return bb > aa ? b : a
  })
  return best?.url ?? null
}

function normalizeItem(item: any): SearchItem | null {
  const videoId =
    item?.id ??
    item?.endpoint?.payload?.videoId ??
    item?.endpoint?.payload?.video_id ??
    null

  if (!videoId || typeof videoId !== 'string') return null

  const title =
    (typeof item?.title === 'string' && item.title) ||
    (typeof item?.name === 'string' && item.name) ||
    ''

  const artists: Array<string> = []
  if (Array.isArray(item?.artists)) {
    for (const a of item.artists) {
      if (a?.name) artists.push(String(a.name))
    }
  }
  if (artists.length === 0 && item?.author?.name) artists.push(String(item.author.name))
  if (artists.length === 0 && Array.isArray(item?.authors)) {
    for (const a of item.authors) if (a?.name) artists.push(String(a.name))
  }

  const album = item?.album?.name ? String(item.album.name) : null
  const durationText = item?.duration?.text ? String(item.duration.text) : null

  let thumbUrl: string | null = null
  try {
    const thumbs = item?.thumbnails as Array<{
      url: string
      width?: number
      height?: number
    }>
    thumbUrl = pickBestThumb(thumbs)
  } catch {
    thumbUrl = null
  }

  if (!thumbUrl) {
    // fallback bem estável
    thumbUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  }

  return {
    videoId,
    title,
    artists,
    album,
    durationText,
    thumbnailUrl: thumbUrl,
    youtubeUrl: `https://youtube.com/watch?v=${videoId}`,
  }
}

export const Route = createFileRoute('/api/ytmusic-search')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const q = (url.searchParams.get('q') ?? '').trim()
        const limitRaw = Number(url.searchParams.get('limit') ?? '8')
        const limit = Number.isFinite(limitRaw) ? Math.min(25, Math.max(1, limitRaw)) : 8

        if (!q) {
          return json({ message: 'q é obrigatório.' }, { status: 400 })
        }

        try {
          const yt = await getYt()
          const r: any = await yt.music.search(q, { type: 'song' })

          const shelf = r?.songs
          const rawItems: Array<any> = Array.isArray(shelf?.contents) ? shelf.contents : []

          const items = rawItems
            .map(normalizeItem)
            .filter(Boolean)
            .slice(0, limit) as Array<SearchItem>

          const out: SearchResponse = { query: q, items }
          return json(out)
        } catch (err: any) {
          return json(
            { message: err?.message ?? 'Erro ao buscar no YouTube Music.' },
            { status: 500 },
          )
        }
      },
    },
  },
})
