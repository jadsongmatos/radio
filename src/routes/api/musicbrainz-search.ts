// src/routes/api/musicbrainz-search.ts
import { createFileRoute } from '@tanstack/react-router'
import { MusicBrainzApi } from 'musicbrainz-api'

type ExternalUrl = { type?: string; url: string }

type MBRecording = {
  id: string
  title: string
  'artist-credit'?: Array<{
    name: string
    artist?: { id: string; name: string }
  }>
  releases?: Array<{ id: string; title: string }>

  // novo: preenchido quando expand=urls
  externalUrls?: ExternalUrl[]
}

type MBSearchResponse = {
  recordings: Array<MBRecording>
  count: number
  offset: number
}

const mbApi = new MusicBrainzApi({
  appName: 'webradio-queue',
  appVersion: '1.0.0',
  appContactInfo: 'jadson.g-matos@outlook.com',
})

function toInt(value: string | null, fallback: number) {
  if (!value) return fallback
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : fallback
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

/** Escape simples para colocar valores dentro de aspas no Lucene do MusicBrainz. */
function escLuceneQuoted(v: string) {
  return v.replace(/["\\]/g, '\\$&')
}

function parseExpandParam(raw: string | null) {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** Extrai as URLs externas do retorno do lookup (relations[].url.resource) */
function extractExternalUrls(entity: any): ExternalUrl[] {
  const rels = Array.isArray(entity?.relations) ? entity.relations : []
  return rels
    .filter((r: any) => r?.url?.resource)
    .map((r: any) => ({
      type: typeof r?.type === 'string' ? r.type : undefined,
      url: String(r.url.resource),
    }))
}

function filterStreamingOnly(urls: ExternalUrl[]) {
  // Ajuste a whitelist conforme sua necessidade
  const allowed = new Set(['free streaming', 'streaming'])
  return urls.filter((u) => !u.type || allowed.has(u.type))
}

/** Map com concorrência limitada (sem libs) */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
) {
  const results: R[] = new Array(items.length)
  let cursor = 0

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++
      results[idx] = await fn(items[idx], idx)
    }
  })

  await Promise.all(workers)
  return results
}

/**
 * Cache simples em memória com TTL (evita repetir lookups do mesmo recording)
 * Obs: em ambiente serverless pode não persistir entre cold starts.
 */
const urlCache = new Map<string, { expiresAt: number; urls: ExternalUrl[] }>()
const URL_CACHE_TTL_MS = 10 * 60 * 1000 // 10 min

function getCachedUrls(id: string): ExternalUrl[] | null {
  const hit = urlCache.get(id)
  if (!hit) return null
  if (Date.now() > hit.expiresAt) {
    urlCache.delete(id)
    return null
  }
  return hit.urls
}

function setCachedUrls(id: string, urls: ExternalUrl[]) {
  urlCache.set(id, { urls, expiresAt: Date.now() + URL_CACHE_TTL_MS })
}

export const Route = createFileRoute('/api/musicbrainz-search')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)

        // q = título da música (obrigatório)
        const title = (url.searchParams.get('q') ?? '').trim()
        // artist = nome do artista (opcional)
        const artist = (url.searchParams.get('artist') ?? '').trim()

        if (!title) {
          return Response.json(
            { message: 'Parâmetro "q" (título da música) é obrigatório.' },
            { status: 400 },
          )
        }

        const limit = clamp(toInt(url.searchParams.get('limit'), 12), 1, 100)
        const offset = Math.max(0, toInt(url.searchParams.get('offset'), 0))

        // novos params
        const expand = parseExpandParam(url.searchParams.get('expand'))
        const wantUrls = expand.has('urls')
        const streamingOnly = url.searchParams.get('streamingOnly') === '1'

        // Monta query SEM expor Lucene pra quem chama a API
        const titleQ = `recording:"${escLuceneQuoted(title)}"`
        const query = artist
          ? `${titleQ} AND artist:"${escLuceneQuoted(artist)}"`
          : titleQ

        try {
          const data: any = await mbApi.search('recording', {
            query,
            offset,
            limit,
          })

          let recordings = (data?.recordings ?? []) as Array<MBRecording>
          const count = typeof data?.count === 'number' ? data.count : 0
          const returnedOffset =
            typeof data?.offset === 'number' ? data.offset : offset

          // Se expand=urls, faz N lookups (com concorrência baixa) e injeta externalUrls
          if (wantUrls && recordings.length > 0) {
            recordings = await mapWithConcurrency(recordings, 2, async (rec) => {
              // 1) tenta cache
              const cached = getCachedUrls(rec.id)
              if (cached) {
                return {
                  ...rec,
                  externalUrls: streamingOnly
                    ? filterStreamingOnly(cached)
                    : cached,
                }
              }

              // 2) lookup no MB
              try {
                const full: any = await mbApi.lookup('recording', rec.id, [
                  'url-rels',
                ])
                const urls = extractExternalUrls(full)
                setCachedUrls(rec.id, urls)

                return {
                  ...rec,
                  externalUrls: streamingOnly
                    ? filterStreamingOnly(urls)
                    : urls,
                }
              } catch {
                // falhou lookup desse item (rate-limit, 404, etc.)
                return { ...rec, externalUrls: [] }
              }
            })
          }

          const payload: MBSearchResponse = {
            recordings,
            count,
            offset: returnedOffset,
          }

          return Response.json(payload)
        } catch (err: any) {
          const message =
            err?.message ??
            'Erro ao consultar MusicBrainz (proxy musicbrainz-search).'

          const status = /rate limit|503|service unavailable/i.test(message)
            ? 503
            : 500

          return Response.json({ message }, { status })
        }
      },
    },
  },
})
