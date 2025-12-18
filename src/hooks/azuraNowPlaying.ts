// src/queries/azuraNowPlaying.ts
import { useQuery } from '@tanstack/react-query'

/** TIPOS (Azura) */
export type AzuraSong = {
  id: string
  art: string | null
  custom_fields: Array<any>
  text: string
  artist: string
  title: string
  album: string
  genre: string
  isrc: string
  lyrics: string
}

export type AzuraSongHistoryItem = {
  sh_id: number
  played_at: number
  duration: number
  playlist: string
  streamer: string
  is_request: boolean
  song: AzuraSong
}

export type AzuraNowPlaying = {
  station: {
    id: number
    name: string
    shortcode: string
    description: string
    frontend: string
    backend: string
    timezone: string
    listen_url: string
    url: string
    public_player_url: string
    playlist_pls_url: string
    playlist_m3u_url: string
    is_public: boolean
    requests_enabled: boolean
    mounts: Array<{
      id: number
      name: string
      url: string
      bitrate: number
      format: string
      listeners: {
        total: number
        unique: number
        current: number
      }
      path: string
      is_default: boolean
    }>
    remotes: any[]
    hls_enabled: boolean
    hls_is_default: boolean
    hls_url: string
    hls_listeners: number
  }
  listeners: {
    total: number
    unique: number
    current: number
  }
  live: {
    is_live: boolean
    streamer_name: string
    broadcast_start: number | null
    art: string | null
  }
  now_playing: {
    sh_id: number
    played_at: number
    duration: number
    playlist: string
    streamer: string
    is_request: boolean
    song: AzuraSong
    elapsed: number
    remaining: number
  } | null
  playing_next: AzuraSongHistoryItem | null
  song_history: Array<AzuraSongHistoryItem>
  is_online: boolean
  cache: unknown
}

const AZURA_NOWPLAYING_URL = 'https://webradio.dpdns.org/api/nowplaying/j'

export const azuraNowPlayingKey = ['azura', 'nowplaying', 'j'] as const

async function fetchAzuraNowPlaying(): Promise<AzuraNowPlaying | null> {
  try {
    const res = await fetch(AZURA_NOWPLAYING_URL, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return (await res.json()) as AzuraNowPlaying
  } catch {
    return null
  }
}

export function useAzuraNowPlaying(pollMs = 15000) {
  return useQuery({
    queryKey: azuraNowPlayingKey,
    queryFn: fetchAzuraNowPlaying,
    refetchInterval: pollMs,
    refetchIntervalInBackground: true,
    staleTime: pollMs,
    gcTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev, // evita “piscar” pra null entre refetches
  })
}
