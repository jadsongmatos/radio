import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'

import Hls from 'hls.js'

import AudioPlayer, { RHAP_UI } from 'react-h5-audio-player'
import 'react-h5-audio-player/lib/styles.css'

import { Swiper, SwiperSlide } from 'swiper/react'
import { EffectCoverflow, Keyboard, Mousewheel, Navigation, Pagination } from 'swiper/modules'

import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Container,
  Divider,
  GlobalStyles,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
  keyframes,
} from '@mui/material'

import {
  Add as AddIcon,
  Check as CheckIcon,
  Equalizer as EqualizerIcon,
  QueueMusic as QueueIcon,
  Radio as RadioIcon,
  Search as SearchIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material'

/**  ANIMAÇÕES CSS (Keyframes) */

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`

const pulseGlow = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(79, 70, 229, 0.4); }
  70% { box-shadow: 0 0 0 10px rgba(79, 70, 229, 0); }
  100% { box-shadow: 0 0 0 0 rgba(79, 70, 229, 0); }
`

const gradientBg = keyframes`
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`

const equalizerAnim = keyframes`
  0% { height: 3px; }
  50% { height: 15px; }
  100% { height: 3px; }
`

/**  TIPOS  */

type YTMusicSearchItem = {
  videoId: string
  title: string
  artists: string[]
  album?: string | null
  durationText?: string | null
  thumbnailUrl?: string | null
  youtubeUrl: string
}

type YTMusicSearchResponse = {
  query: string
  items: YTMusicSearchItem[]
}

type AzuraSong = {
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

type AzuraSongHistoryItem = {
  sh_id: number
  played_at: number
  duration: number
  playlist: string
  streamer: string
  is_request: boolean
  song: AzuraSong
}

type AzuraNowPlaying = {
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
  song_history: AzuraSongHistoryItem[]
  is_online: boolean
  cache: unknown
}

type RadioRequestItem = {
  id: string
  recordingMbid: string
  trackName: string
  artistName: string
  releaseName?: string | null
  coverUrl?: string | null
  youtubeUrl: string
  createdAt: string
}

/**  CONSTANTS / HELPERS  */

const AZURA_NOWPLAYING_URL = 'https://webradio.dpdns.org/api/nowplaying/j'
const YTMUSIC_SEARCH_ENDPOINT = '/api/ytmusic-search'

// SUA URL HLS FIXA
const HLS_STREAM_URL = 'https://webradio.dpdns.org/hls/j/live.m3u8'

// Seus parâmetros de servidor
const HLS_SEGMENT_DURATION_SECONDS = 2
const HLS_PLAYLIST_SEGMENTS = 30
// const HLS_OVERHEAD_SEGMENTS = 15

function formatAzuraDate(timestamp?: number | null) {
  if (!timestamp) return ''
  return new Date(timestamp * 1000).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getAzuraSongText(song?: AzuraSong | null) {
  if (!song) return ''
  if (song.text) return song.text
  if (song.artist || song.title) return [song.artist, song.title].filter(Boolean).join(' - ')
  return ''
}

function getYTArtistText(item: YTMusicSearchItem) {
  const s = (item.artists ?? []).filter(Boolean).join(', ').trim()
  return s || 'Desconhecido'
}

function getYTCoverUrl(item: YTMusicSearchItem) {
  return item.thumbnailUrl || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`
}

async function searchYouTubeMusic(query: string, limit = 8): Promise<YTMusicSearchItem[]> {
  const q = query.trim()
  if (!q) return []

  const params = new URLSearchParams({ q, limit: String(limit) })
  const res = await fetch(`${YTMUSIC_SEARCH_ENDPOINT}?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.message ?? `Erro na busca do YouTube Music (${res.status}).`)
  }

  const data = (await res.json().catch(() => null)) as YTMusicSearchResponse | null
  return (data?.items ?? []) as YTMusicSearchItem[]
}

export const Route = createFileRoute('/')({
  ssr: false,
  component: MusicRequestQueuePage,
  loader: async () => {
    try {
      const res = await fetch('/api/queue', {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-store',
        },
      })
      if (!res.ok) return { queue: [] as RadioRequestItem[] }
      const queue = (await res.json()) as RadioRequestItem[]
      return { queue }
    } catch {
      return { queue: [] as RadioRequestItem[] }
    }
  },
})


/**  COMPONENTES VISUAIS CUSTOMIZADOS  */

const GlassCard = ({ children, sx, ...props }: any) => (
  <Card
    sx={{
      background: 'rgba(20, 20, 30, 0.6)',
      backdropFilter: 'blur(16px)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.3)',
      color: '#fff',
      borderRadius: 4,
      overflow: 'visible',
      ...sx,
    }}
    {...props}
  >
    {children}
  </Card>
)

const Visualizer = () => (
  <Stack direction="row" spacing={0.5} alignItems="flex-end" height={20}>
    {[...Array(4)].map((_, i) => (
      <Box
        key={i}
        sx={{
          width: 4,
          bgcolor: '#4f46e5',
          borderRadius: 1,
          animation: `${equalizerAnim} ${0.8 + i * 0.2}s infinite ease-in-out`,
        }}
      />
    ))}
  </Stack>
)

/**  PAGE  */

function MusicRequestQueuePage() {
  const router = useRouter()
  const loaderData = Route.useLoaderData()

  const initialQueue = (loaderData.queue ?? []) as RadioRequestItem[]
  const queue = useMemo(() => initialQueue ?? [], [initialQueue])

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<YTMusicSearchItem[]>([])
  const [searching, setSearching] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [azura, setAzura] = useState<AzuraNowPlaying | null>(null)
  // const [azuraLoading, setAzuraLoading] = useState<boolean>(true)
  const [azuraError, setAzuraError] = useState<string | null>(null)

  const [selectedMountId, setSelectedMountId] = useState<string>('hls')

  // -- MENU DE CONFIGURAÇÕES --
  const [settingsAnchorEl, setSettingsAnchorEl] = useState<null | HTMLElement>(null)
  const isSettingsOpen = Boolean(settingsAnchorEl)
  const handleSettingsOpen = (event: React.MouseEvent<HTMLElement>) => {
    setSettingsAnchorEl(event.currentTarget)
  }
  const handleSettingsClose = () => {
    setSettingsAnchorEl(null)
  }

  const playerRef = useRef<any>(null)

  const [keepAliveEnabled, setKeepAliveEnabled] = useState(true)
  const keepAliveRef = useRef(true)
  useEffect(() => {
    keepAliveRef.current = keepAliveEnabled
  }, [keepAliveEnabled])

  const [autoplayBlocked, setAutoplayBlocked] = useState(false)

  const [manualPaused, setManualPaused] = useState(false)
  const manualPausedRef = useRef(false)
  useEffect(() => {
    manualPausedRef.current = manualPaused
  }, [manualPaused])

  const userMainControlClickRef = useRef(false)

  const [streamBuster, setStreamBuster] = useState(0)
  const retryTimerRef = useRef<number | null>(null)
  const backoffRef = useRef(1000)

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current)
    retryTimerRef.current = null
  }, [])

  const hlsRef = useRef<Hls | null>(null)
  const usingHlsJsRef = useRef(false)

  const tryPlay = useCallback(async () => {
    const audio = playerRef.current?.audio?.current as HTMLAudioElement | undefined
    if (!audio) return false

    try {
      if (!usingHlsJsRef.current) {
        audio.load()
      }

      await audio.play()
      setAutoplayBlocked(false)
      return true
    } catch {
      setAutoplayBlocked(true)
      return false
    }
  }, [])

  useEffect(() => {
    let alive = true
    let timer: number | undefined

    const fetchAzura = async () => {
      try {
        setAzuraError(null)
        const res = await fetch(AZURA_NOWPLAYING_URL, {
          headers: { Accept: 'application/json' },
        })
        if (!res.ok) throw new Error('Erro AzuraCast')
        const data: AzuraNowPlaying = await res.json()
        if (!alive) return
        setAzura(data)
      } catch {
        if (!alive) return
        setAzura(null)
        setAzuraError('Rádio offline ou inalcançável.')
      } finally {
        // if (alive) setAzuraLoading(false)
      }
    }

    fetchAzura()
    timer = window.setInterval(fetchAzura, 15000)
    return () => {
      alive = false
      if (timer) window.clearInterval(timer)
    }
  }, [])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setError(null)
    setSearchResults([])
    try {
      const items = await searchYouTubeMusic(q, 8)
      if (items.length > 0) setSearchResults(items)
      else setError('Nada encontrado.')
    } catch {
      setError('Erro na busca.')
    } finally {
      setSearching(false)
    }
  }

  const handleAdd = async (track: YTMusicSearchItem) => {
    setAddingId(track.videoId)
    setError(null)
    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: track.videoId,
          trackName: track.title,
          artistName: getYTArtistText(track),
          albumName: track.album,
          coverUrl: getYTCoverUrl(track),
          youtubeUrl: track.youtubeUrl,
        }),
      })
      if (!res.ok) throw new Error()
      router.invalidate()
      setQuery('')
      setSearchResults([])
    } catch {
      setError('Falha ao adicionar.')
    } finally {
      setAddingId(null)
    }
  }

  const currentSong = azura?.now_playing?.song ?? null
  const isOnline = !!azura?.is_online
  const listeners = azura?.listeners
  const mounts = azura?.station?.mounts ?? []

  /**
   *  Escolha da URL do stream
   */
  const streamSrc = useMemo(() => {
    // Se usuário escolheu HLS fixo
    if (selectedMountId === 'hls') return HLS_STREAM_URL

    // Caso queira usar o HLS do próprio Azura (se existir)
    if (selectedMountId === 'hls-azura' && azura?.station?.hls_url) return azura.station.hls_url

    // Fallback para auto (Icecast/SHOUTcast etc)
    if (!azura) return undefined

    if (selectedMountId !== 'auto') {
      const chosen = mounts.find((m) => String(m.id) === selectedMountId)
      if (chosen?.url) return chosen.url
    }
    if (azura.station.listen_url) return azura.station.listen_url
    return mounts[0]?.url
  }, [azura, mounts, selectedMountId])

  /**
   *  Cache-buster
   */
  const effectiveStreamSrc = useMemo(() => {
    if (!streamSrc) return undefined
    const sep = streamSrc.includes('?') ? '&' : '?'
    return `${streamSrc}${sep}_t=${streamBuster}`
  }, [streamSrc, streamBuster])

  const isHlsUrl = useMemo(() => {
    const u = effectiveStreamSrc ?? ''
    return u.includes('.m3u8')
  }, [effectiveStreamSrc])

  useEffect(() => {
    const audio = playerRef.current?.audio?.current as HTMLAudioElement | undefined
    if (!audio) return

    // Limpa instância anterior
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy()
      } catch {}
      hlsRef.current = null
    }
    usingHlsJsRef.current = false

    const url = effectiveStreamSrc
    if (!url) return

    // Se não for HLS, deixa o AudioPlayer usar src normal
    if (!isHlsUrl) {
      audio.src = url
      return
    }

    // Safari/iOS: HLS nativo (sem hls.js)
    const canNativeHls = !!audio.canPlayType('application/vnd.apple.mpegurl')
    if (canNativeHls) {
      audio.src = url
      usingHlsJsRef.current = false
      return
    }

    // Outros browsers: hls.js (MSE)
    if (!Hls.isSupported()) {
      audio.src = url
      usingHlsJsRef.current = false
      return
    }

    // Remove qualquer src anterior direto
    audio.removeAttribute('src')
    audio.load()

    const playlistWindowSeconds = HLS_SEGMENT_DURATION_SECONDS * HLS_PLAYLIST_SEGMENTS // 120s

    const hls = new Hls({
      liveSyncDurationCount: 22,
      liveMaxLatencyDurationCount: 24,
      maxBufferLength: Math.min(110, Math.max(60, playlistWindowSeconds - 8)),
      backBufferLength: 118,
      maxBufferSize: 10 * 1000 * 1000,
    })

    hlsRef.current = hls
    usingHlsJsRef.current = true

    hls.attachMedia(audio)
    hls.loadSource(url)

    const onManifest = async () => {
      if (!keepAliveRef.current) return
      if (manualPausedRef.current) return
      if (autoplayBlocked) return
      await tryPlay()
    }

    const onError = (_event: string, data: any) => {
      if (!data) return
      if (data.fatal) {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          try {
            hls.startLoad()
          } catch {
            setStreamBuster((v) => v + 1)
          }
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          try {
            hls.recoverMediaError()
          } catch {
            setStreamBuster((v) => v + 1)
          }
        } else {
          try {
            hls.destroy()
          } catch {}
          hlsRef.current = null
          usingHlsJsRef.current = false
          setStreamBuster((v) => v + 1)
        }
      }
    }

    hls.on(Hls.Events.MANIFEST_PARSED, onManifest)
    hls.on(Hls.Events.ERROR, onError)

    return () => {
      try {
        hls.off(Hls.Events.MANIFEST_PARSED, onManifest)
        hls.off(Hls.Events.ERROR, onError)
      } catch {}
      try {
        hls.destroy()
      } catch {}
      hlsRef.current = null
      usingHlsJsRef.current = false
    }
  }, [effectiveStreamSrc, isHlsUrl])

  const scheduleRetry = useCallback(
    (_reason: string) => {
      if (manualPausedRef.current) return
      if (!keepAliveRef.current || !isOnline) return
      if (autoplayBlocked) return

      clearRetry()
      const delay = backoffRef.current

      retryTimerRef.current = window.setTimeout(async () => {
        if (manualPausedRef.current) return
        if (!keepAliveRef.current || !isOnline) return
        if (autoplayBlocked) return

        const ok = await tryPlay()
        if (ok) {
          backoffRef.current = 1000
          clearRetry()
          return
        }

        setStreamBuster((v) => v + 1)
        backoffRef.current = Math.min(backoffRef.current * 2, 30000)
        scheduleRetry('backoff')
      }, delay)
    },
    [autoplayBlocked, clearRetry, isOnline, tryPlay]
  )

  useEffect(() => {
    if (!keepAliveEnabled) return
    if (!isOnline) {
      clearRetry()
      return
    }
    if (manualPausedRef.current) return
    scheduleRetry('online-or-src-change')
  }, [keepAliveEnabled, isOnline, effectiveStreamSrc])

  useEffect(() => {
    if (!keepAliveEnabled) return
    const id = window.setInterval(() => {
      if (!keepAliveRef.current || !isOnline) return
      if (manualPausedRef.current) return
      if (autoplayBlocked) return
      const audio = playerRef.current?.audio?.current as HTMLAudioElement | undefined
      if (audio?.paused) scheduleRetry('watchdog-paused')
    }, 12000)
    return () => window.clearInterval(id)
  }, [autoplayBlocked, isOnline, keepAliveEnabled, scheduleRetry])

  useEffect(() => {
    const audio = playerRef.current?.audio?.current as HTMLAudioElement | undefined
    if (!audio) return
    const onStalled = () => scheduleRetry('stalled')
    audio.addEventListener('stalled', onStalled)
    return () => audio.removeEventListener('stalled', onStalled)
  }, [effectiveStreamSrc, scheduleRetry])

  const handlePlayerPointerDownCapture = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement
    if (target?.closest?.('.rhap_main-controls-button')) {
      userMainControlClickRef.current = true
      window.setTimeout(() => {
        userMainControlClickRef.current = false
      }, 300)
    }
  }

  const shouldAutoPlay = keepAliveEnabled && !manualPaused

  return (
    <>
      <GlobalStyles
        styles={{
          body: {
            margin: 0,
            padding: 0,
            background: '#000',
            fontFamily: "'Inter', sans-serif",
          },

          '.rhap_progress-section': { display: 'none !important' },
          '.rhap_time': { display: 'none !important' },
          '.rhap_container': {
            backgroundColor: 'transparent !important',
            boxShadow: 'none !important',
            padding: '10px 0 !important',
          },
          '.rhap_button-clear': {
            color: '#fff !important',
            opacity: 0.9,
            transition: 'all 0.2s',
          },
          '.rhap_button-clear:hover': {
            opacity: 1,
            transform: 'scale(1.1)',
            color: '#818cf8 !important',
          },
          '.rhap_main-controls-button': {
            fontSize: '40px !important',
          },

          '.recentSwiper': {
            paddingBottom: 28,
            paddingLeft: 8,
            paddingRight: 8,
          },
          '.recentSwiper .swiper-slide': {
            width: 170,
          },
          '.recentSwiper .swiper-slide-transform': {
            height: '100%',
          },
          '.recentSwiper .swiper-pagination': {
            bottom: 6,
          },
          '.recentSwiper .swiper-pagination-bullet': {
            width: 7,
            height: 7,
            opacity: 0.35,
            background: 'rgba(165,180,252,0.9)',
            transition: 'all 180ms ease',
          },
          '.recentSwiper .swiper-pagination-bullet-active': {
            width: 22,
            borderRadius: 999,
            opacity: 1,
            background: 'linear-gradient(90deg, rgba(99,102,241,1), rgba(236,72,153,1))',
            boxShadow: '0 10px 18px rgba(0,0,0,0.35)',
          },
          '.recentSwiper .swiper-button-prev, .recentSwiper .swiper-button-next': {
            width: 34,
            height: 34,
            borderRadius: 12,
            background: 'rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.10)',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
            transition: 'transform 160ms ease, opacity 160ms ease',
            opacity: 0.85,
          },
          '.recentSwiper .swiper-button-prev:hover, .recentSwiper .swiper-button-next:hover': {
            transform: 'scale(1.04)',
            opacity: 1,
          },
          '.recentSwiper .swiper-button-prev::after, .recentSwiper .swiper-button-next::after': {
            fontSize: 14,
            fontWeight: 900,
            color: '#e2e8f0',
          },
          '.historyCard': {
            borderRadius: 16,
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(0,0,0,0.25)',
            boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
            transform: 'translateY(0px) scale(1)',
            transition: 'transform 180ms ease, border-color 180ms ease',
          },
          '.recentSwiper .swiper-slide-active .historyCard': {
            transform: 'translateY(-6px) scale(1.03)',
            borderColor: 'rgba(236,72,153,0.55)',
          },
        }}
      />

      <Box
        sx={{
          minHeight: '100vh',
          width: '100%',
          position: 'relative',
          overflowX: 'hidden',
          background: 'linear-gradient(-45deg, #0f0c29, #302b63, #24243e)',
          backgroundSize: '400% 400%',
          animation: `${gradientBg} 15s ease infinite`,
          pb: 10,
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            top: '-10%',
            left: '-10%',
            width: '50vw',
            height: '50vw',
            background: 'radial-gradient(circle, rgba(99,102,241,0.25) 0%, rgba(0,0,0,0) 70%)',
            filter: 'blur(60px)',
            zIndex: 0,
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            bottom: '10%',
            right: '-10%',
            width: '60vw',
            height: '60vw',
            background: 'radial-gradient(circle, rgba(168,85,247,0.2) 0%, rgba(0,0,0,0) 70%)',
            filter: 'blur(80px)',
            zIndex: 0,
          }}
        />

        <Container maxWidth="md" sx={{ position: 'relative', zIndex: 1, pt: { xs: 4, md: 8 } }}>
          {/* HEADER */}
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={4} sx={{ px: 1 }}>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #6366f1, #ec4899)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 20px rgba(99,102,241,0.5)',
                }}
              >
                <RadioIcon sx={{ color: '#fff', fontSize: 28 }} />
              </Box>
              <Box>
                <Typography
                  variant="h4"
                  fontWeight={900}
                  sx={{
                    background: 'linear-gradient(to right, #fff, #c4b5fd)',
                    backgroundClip: 'text',
                    color: 'transparent',
                    letterSpacing: '-1px',
                    lineHeight: 1,
                  }}
                >
                  WEBRADIO
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)', letterSpacing: 1 }}>
                    LIVE STATION
                  </Typography>
                  {isOnline && <Visualizer />}
                </Stack>
              </Box>
            </Stack>

            <Chip
              label={isOnline ? 'ON AIR' : 'OFFLINE'}
              sx={{
                bgcolor: isOnline ? '#ef4444' : '#333',
                color: '#fff',
                fontWeight: 'bold',
                borderRadius: '8px',
                animation: isOnline ? `${pulseGlow} 2s infinite` : 'none',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            />
          </Stack>

          {/* PLAYER PRINCIPAL */}
          <GlassCard sx={{ mb: 6, position: 'relative', overflow: 'hidden' }}>
            {/* BOTÃO DE CONFIGURAÇÕES (NOVO) */}
            <Box sx={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}>
              <IconButton
                onClick={handleSettingsOpen}
                sx={{
                  color: 'rgba(255,255,255,0.4)',
                  backdropFilter: 'blur(4px)',
                  bgcolor: 'rgba(0,0,0,0.2)',
                  '&:hover': { color: '#fff', bgcolor: 'rgba(0,0,0,0.4)' },
                }}
              >
                <SettingsIcon />
              </IconButton>
            </Box>

            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundImage: `url(${currentSong?.art || ''})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: 'blur(50px) brightness(0.4)',
                opacity: 0.6,
                zIndex: 0,
              }}
            />

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={{ xs: 4, sm: 6 }}
              sx={{ p: { xs: 3, sm: 5 }, position: 'relative', zIndex: 1 }}
              alignItems="center"
            >
              {/* DISCO */}
              <Box
                sx={{
                  position: 'relative',
                  width: { xs: 240, sm: 280 },
                  height: { xs: 240, sm: 280 },
                  flexShrink: 0,
                }}
              >
                <Box
                  sx={{
                    width: '100%',
                    height: '100%',
                    borderRadius: '50%',
                    boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
                    border: '4px solid rgba(25,25,25, 0.8)',
                    position: 'relative',
                    animation: isOnline && !manualPaused ? `${spin} 8s linear infinite` : 'none',
                    '&::after': {
                      content: '""',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      borderRadius: '50%',
                      background:
                        'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 50%, rgba(255,255,255,0.05) 100%)',
                      pointerEvents: 'none',
                    },
                  }}
                >
                  <Box
                    component="img"
                    src={currentSong?.art || 'https://via.placeholder.com/300/111/fff?text=RADIO'}
                    sx={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
                  />
                  <Box
                    sx={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: 50,
                      height: 50,
                      bgcolor: '#1a1a1a',
                      borderRadius: '50%',
                      border: '3px solid #333',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.8)',
                    }}
                  >
                    <Box sx={{ width: 8, height: 8, bgcolor: '#888', borderRadius: '50%' }} />
                  </Box>
                </Box>

                {azura?.now_playing?.is_request && (
                  <Chip
                    label="Pedido"
                    color="primary"
                    size="small"
                    sx={{
                      position: 'absolute',
                      bottom: -10,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                      fontWeight: 'bold',
                      zIndex: 10,
                      background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                    }}
                  />
                )}
              </Box>

              {/* INFO + CONTROLES */}
              <Box sx={{ flex: 1, width: '100%', textAlign: { xs: 'center', sm: 'left' } }}>
                <Typography
                  variant="h4"
                  fontWeight={800}
                  gutterBottom
                  sx={{
                    textShadow: '0 2px 10px rgba(0,0,0,0.5)',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    lineHeight: 1.2,
                  }}
                >
                  {getAzuraSongText(currentSong) || 'Aguardando informações...'}
                </Typography>

                <Typography variant="h6" sx={{ color: '#a5b4fc', mb: 3, fontWeight: 500 }}>
                  {currentSong?.album || 'Rádio Online'}
                </Typography>
                <Stack
                  direction="row"
                  spacing={2}
                  alignItems="center"
                  justifyContent={{ xs: 'center', sm: 'flex-start' }}
                  sx={{ mb: 2 }}
                >
                  {listeners && (
                    <Chip
                      icon={<EqualizerIcon sx={{ fontSize: 16 }} />}
                      label={`${listeners.current} Ouvintes`}
                      size="small"
                      sx={{
                        bgcolor: 'rgba(0,0,0,0.3)',
                        color: '#94a3b8',
                        border: '1px solid rgba(255,255,255,0.05)',
                      }}
                    />
                  )}
                </Stack>

                <Box sx={{ width: '100%' }} onPointerDownCapture={handlePlayerPointerDownCapture}>
                  <AudioPlayer
                    ref={playerRef}
                    src={isHlsUrl ? '' : effectiveStreamSrc}
                    preload="none"
                    autoPlay={shouldAutoPlay}
                    autoPlayAfterSrcChange={shouldAutoPlay}
                    showJumpControls={false}
                    showSkipControls={false}
                    customAdditionalControls={[]}
                    customProgressBarSection={[]}
                    customControlsSection={[RHAP_UI.MAIN_CONTROLS, RHAP_UI.VOLUME_CONTROLS]}
                    layout="horizontal"
                    onPlay={() => {
                      setManualPaused(false)
                      manualPausedRef.current = false
                      backoffRef.current = 1000
                      clearRetry()
                    }}
                    onPlaying={() => {
                      setAutoplayBlocked(false)
                      backoffRef.current = 1000
                      clearRetry()
                    }}
                    onPause={() => {
                      const audio = playerRef.current?.audio?.current as HTMLAudioElement | undefined
                      const ended = !!audio?.ended

                      if (userMainControlClickRef.current && !ended) {
                        setManualPaused(true)
                        manualPausedRef.current = true
                        clearRetry()
                        return
                      }

                      if (!manualPausedRef.current) scheduleRetry('pause-not-manual')
                    }}
                    onError={() => scheduleRetry('onError')}
                    onWaiting={() => scheduleRetry('onWaiting')}
                    onSuspend={() => scheduleRetry('onSuspend')}
                    onEmptied={() => scheduleRetry('onEmptied')}
                    onEnded={() => scheduleRetry('onEnded')}
                    onPlayError={() => setAutoplayBlocked(true)}
                  />
                </Box>
              </Box>
            </Stack>

            {/* MENU DE CONFIGURAÇÕES OCULTO */}
            <Menu
              anchorEl={settingsAnchorEl}
              open={isSettingsOpen}
              onClose={handleSettingsClose}
              PaperProps={{
                sx: {
                  bgcolor: 'rgba(20, 20, 35, 0.95)',
                  backdropFilter: 'blur(10px)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.1)',
                  minWidth: 250,
                  '& .MuiMenuItem-root': {
                    fontSize: '0.9rem',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' },
                  },
                },
              }}
              transformOrigin={{ horizontal: 'right', vertical: 'top' }}
              anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            >
              {/* SWITCH AUTO-RECONECTAR */}
              <MenuItem
                onClick={() => setKeepAliveEnabled(!keepAliveEnabled)}
                sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1.5 }}
              >
                <Box>
                  <Typography variant="body2" fontWeight="bold">
                    Auto-Reconectar
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block' }}>
                    Tentar voltar se cair
                  </Typography>
                </Box>
                <Switch size="small" checked={keepAliveEnabled} />
              </MenuItem>

              <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', my: 1 }} />

              <Box sx={{ px: 2, py: 1 }}>
                <Typography variant="caption" sx={{ color: '#ec4899', fontWeight: 'bold', textTransform: 'uppercase' }}>
                  Fonte de Áudio (Stream)
                </Typography>
              </Box>

              {/* OPÇÕES DE STREAM */}
              {[
                { id: 'hls', label: 'HLS (Estável / Buffer Alto)' },
                { id: 'hls-azura', label: 'HLS (Nativo Azura)' },
                { id: 'auto', label: 'Auto Quality (Padrão)' },
                ...mounts.map((m) => ({ id: String(m.id), label: `${m.bitrate}kbps ${m.format.toUpperCase()}` })),
              ].map((opt) => (
                <MenuItem
                  key={opt.id}
                  onClick={() => {
                    setSelectedMountId(opt.id)
                    handleSettingsClose()
                  }}
                  selected={selectedMountId === opt.id}
                  sx={{ justifyContent: 'space-between' }}
                >
                  {opt.label}
                  {selectedMountId === opt.id && <CheckIcon sx={{ fontSize: 16, color: '#ec4899' }} />}
                </MenuItem>
              ))}
            </Menu>
          </GlassCard>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={4}>
            {/* ESQUERDA */}
            <Box sx={{ flex: 1 }}>
              <Typography
                variant="h6"
                fontWeight={800}
                sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, color: '#fff' }}
              >
                <SearchIcon sx={{ color: '#ec4899' }} /> FAÇA SEU PEDIDO
              </Typography>

              <GlassCard sx={{ p: 2, mb: 3 }}>
                <form onSubmit={handleSearch}>
                  <Stack direction="row" spacing={1}>
                    <TextField
                      fullWidth
                      placeholder="Nome da música ou artista..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      disabled={searching}
                      variant="outlined"
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          color: '#fff',
                          bgcolor: 'rgba(0,0,0,0.2)',
                          borderRadius: '12px',
                          '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
                          '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.3)' },
                          '&.Mui-focused fieldset': { borderColor: '#ec4899' },
                        },
                      }}
                    />
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={searching}
                      sx={{
                        borderRadius: '12px',
                        background: 'linear-gradient(135deg, #ec4899, #db2777)',
                        minWidth: 60,
                        boxShadow: '0 4px 12px rgba(236, 72, 153, 0.4)',
                      }}
                    >
                      {searching ? <CircularProgress size={24} color="inherit" /> : <SearchIcon />}
                    </Button>
                  </Stack>
                </form>
              </GlassCard>

              {error && (
                <Alert severity="error" variant="filled" sx={{ mb: 2, borderRadius: 2 }}>
                  {error}
                </Alert>
              )}

              <Stack spacing={2}>
                {searchResults.map((track) => (
                  <GlassCard
                    key={track.videoId}
                    sx={{
                      p: 0,
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      transition: 'transform 0.2s',
                      '&:hover': { transform: 'translateY(-4px)', borderColor: '#ec4899' },
                    }}
                  >
                    <Box component="img" src={getYTCoverUrl(track)} sx={{ width: 80, height: 80, objectFit: 'cover' }} />
                    <Box sx={{ p: 2, flex: 1, minWidth: 0 }}>
                      <Typography variant="subtitle2" fontWeight={700} noWrap sx={{ color: '#fff' }}>
                        {track.title}
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                        {getYTArtistText(track)}
                      </Typography>
                    </Box>
                    <IconButton
                      onClick={() => (addingId ? null : handleAdd(track))}
                      disabled={!!addingId}
                      sx={{
                        mr: 1,
                        bgcolor: 'rgba(255,255,255,0.1)',
                        color: '#ec4899',
                        '&:hover': { bgcolor: '#ec4899', color: '#fff' },
                      }}
                    >
                      {addingId === track.videoId ? <CircularProgress size={20} color="inherit" /> : <AddIcon />}
                    </IconButton>
                  </GlassCard>
                ))}
              </Stack>
            </Box>

            {/* DIREITA */}
            <Box sx={{ flex: 1 }}>
              <Typography
                variant="h6"
                fontWeight={800}
                sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, color: '#fff' }}
              >
                <QueueIcon sx={{ color: '#8b5cf6' }} /> FILA DE REPRODUÇÃO
              </Typography>

              {queue.length === 0 ? (
                <Box
                  sx={{
                    p: 4,
                    border: '2px dashed rgba(255,255,255,0.1)',
                    borderRadius: 4,
                    textAlign: 'center',
                    color: 'rgba(255,255,255,0.4)',
                  }}
                >
                  <Typography>A fila está vazia.</Typography>
                  <Typography variant="caption">Seja o DJ e peça algo agora!</Typography>
                </Box>
              ) : (
                <Stack spacing={1.5}>
                  {queue.map((item, index) => (
                    <GlassCard
                      key={item.id}
                      sx={{
                        p: 1.5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        background:
                          index === 0
                            ? 'linear-gradient(90deg, rgba(139, 92, 246, 0.2), rgba(20,20,30,0.6))'
                            : 'rgba(20, 20, 30, 0.4)',
                        borderColor: index === 0 ? '#8b5cf6' : 'rgba(255,255,255,0.05)',
                      }}
                    >
                      <Typography
                        variant="h6"
                        sx={{
                          color: index === 0 ? '#c4b5fd' : 'rgba(255,255,255,0.2)',
                          fontWeight: 900,
                          minWidth: 24,
                        }}
                      >
                        {index + 1}
                      </Typography>
                      <Avatar src={item.coverUrl || ''} variant="rounded" />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={700} noWrap sx={{ color: '#f8fafc' }}>
                          {item.trackName}
                        </Typography>
                        <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                          {item.artistName}
                        </Typography>
                      </Box>
                      {index === 0 && (
                        <Chip size="small" label="Next" color="primary" sx={{ height: 20, fontSize: '0.65rem' }} />
                      )}
                    </GlassCard>
                  ))}
                </Stack>
              )}
            </Box>
          </Stack>

          {/* TOCOU RECENTEMENTE (Swiper 3D) */}
          {azura && azura.song_history.length > 0 && (
            <Box mt={6}>
              <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', mb: 3 }} />

              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="overline" sx={{ color: 'rgba(255,255,255,0.55)', letterSpacing: 2 }}>
                  Tocou Recentemente
                </Typography>
                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)' }}>
                  Arraste / role →
                </Typography>
              </Stack>

              <GlassCard sx={{ p: 2.2, position: 'relative', overflow: 'hidden' }}>
                <Box
                  sx={{
                    position: 'absolute',
                    inset: -40,
                    background:
                      'radial-gradient(circle at 20% 20%, rgba(99,102,241,0.18), transparent 45%), radial-gradient(circle at 80% 30%, rgba(236,72,153,0.14), transparent 45%)',
                    filter: 'blur(18px)',
                    opacity: 0.9,
                    pointerEvents: 'none',
                  }}
                />

                <Box
                  sx={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 28,
                    background: 'linear-gradient(to right, rgba(20,20,30,0.9), rgba(20,20,30,0))',
                    pointerEvents: 'none',
                    zIndex: 2,
                  }}
                />
                <Box
                  sx={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: 28,
                    background: 'linear-gradient(to left, rgba(20,20,30,0.9), rgba(20,20,30,0))',
                    pointerEvents: 'none',
                    zIndex: 2,
                  }}
                />

                <Box sx={{ position: 'relative', zIndex: 3 }}>
                  <Swiper
                    className="recentSwiper"
                    modules={[EffectCoverflow, Pagination, Navigation, Mousewheel, Keyboard]}
                    effect="coverflow"
                    grabCursor
                    centeredSlides
                    slidesPerView="auto"
                    spaceBetween={16}
                    navigation
                    pagination={{ clickable: true }}
                    mousewheel={{ forceToAxis: true }}
                    keyboard={{ enabled: true }}
                    coverflowEffect={{
                      rotate: 0,
                      stretch: -10,
                      depth: 170,
                      modifier: 1.25,
                      slideShadows: false,
                    }}
                  >
                    {azura.song_history.map((h) => {
                      const cover = h.song.art || ''
                      const title = h.song.title || 'Sem título'
                      const artist = h.song.artist || '—'
                      const time = formatAzuraDate(h.played_at).split(' ')[1] || ''

                      return (
                        <SwiperSlide key={h.sh_id}>
                          <div className="swiper-slide-transform">
                            <Box className="historyCard">
                              <Box sx={{ position: 'relative' }}>
                                <Avatar
                                  src={cover}
                                  variant="rounded"
                                  sx={{
                                    width: '100%',
                                    height: 170,
                                    borderRadius: 0,
                                    bgcolor: 'rgba(255,255,255,0.06)',
                                  }}
                                />
                                <Box
                                  sx={{
                                    position: 'absolute',
                                    inset: 0,
                                    background:
                                      'linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0.10) 55%, rgba(0,0,0,0))',
                                  }}
                                />
                                <Chip
                                  label={time}
                                  size="small"
                                  sx={{
                                    position: 'absolute',
                                    left: 10,
                                    bottom: 10,
                                    height: 20,
                                    fontSize: '0.70rem',
                                    color: '#e2e8f0',
                                    bgcolor: 'rgba(0,0,0,0.55)',
                                    border: '1px solid rgba(255,255,255,0.10)',
                                    backdropFilter: 'blur(8px)',
                                  }}
                                />
                              </Box>

                              <Box sx={{ p: 1.2 }}>
                                <Typography variant="caption" sx={{ color: '#e2e8f0', fontWeight: 900 }} noWrap>
                                  {title}
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.55)' }} noWrap>
                                  {artist}
                                </Typography>
                              </Box>
                            </Box>
                          </div>
                        </SwiperSlide>
                      )
                    })}
                  </Swiper>
                </Box>
              </GlassCard>
            </Box>
          )}
        </Container>
      </Box>
    </>
  )
}