// src/api/spotify-to-ytmusic.ts
import { createFileRoute } from '@tanstack/react-router'

type ConvertBody =
  | string
  | {
      spotifyUrl?: string
    }

type HistoryItem = {
  id: number
  spotifyUrl: string
  youtubeUrl: string | null
  createdAt: string
}

const history: HistoryItem[] = []

function isSpotifyTrackUrl(url: string) {
  return /open\.spotify\.com\/track\//i.test(url)
}

async function convertSpotifyToYouTube(spotifyUrl: string) {
  const mod: any = await import('spotify-to-ytmusic')

  const fn =
    mod?.default ??
    mod?.spotifyToYtmusic ??
    mod?.spotifyToYtMusic ??
    mod?.convert ??
    mod?.resolve

  if (typeof fn !== 'function') {
    throw new Error(
      'spotify-to-ytmusic: função de conversão não encontrada nos exports.',
    )
  }

  const out: any = await fn(spotifyUrl)

  if (typeof out === 'string') return out

  return out?.youtubeMusicUrl ?? out?.youtubeUrl ?? out?.url ?? null
}

export const Route = createFileRoute('/api/spotify-to-ytmusic')({
  server: {
    handlers: {
      GET: () => {
        return Response.json(history)
      },

      POST: async ({ request }) => {
        let body: ConvertBody

        try {
          body = (await request.json()) as ConvertBody
        } catch {
          return Response.json({ message: 'JSON inválido.' }, { status: 400 })
        }

        const raw =
          typeof body === 'string' ? body : (body.spotifyUrl ?? '')

        const spotifyUrl = raw.trim()

        if (!spotifyUrl) {
          return Response.json(
            { message: 'spotifyUrl é obrigatório.' },
            { status: 400 },
          )
        }

        if (!isSpotifyTrackUrl(spotifyUrl)) {
          return Response.json(
            { message: 'Use uma URL de track do Spotify.' },
            { status: 400 },
          )
        }

        try {
          const youtubeUrl = await convertSpotifyToYouTube(spotifyUrl)

          const item: HistoryItem = {
            id: history.length + 1,
            spotifyUrl,
            youtubeUrl,
            createdAt: new Date().toISOString(),
          }

          history.push(item)

          if (!youtubeUrl) {
            return Response.json(
              {
                ...item,
                message: 'Não foi possível resolver um link do YouTube.',
              },
              { status: 404 },
            )
          }

          return Response.json(item)
        } catch (err: any) {
          return Response.json(
            {
              message:
                err?.message ?? 'Erro ao converter Spotify para YouTube.',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
