import React, { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'

import AudioPlayer, { RHAP_UI } from 'react-h5-audio-player'
import 'react-h5-audio-player/lib/styles.css'

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
  FormControl,
  GlobalStyles,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  keyframes,
  useTheme,
} from '@mui/material'
import {
  Add as AddIcon,
  Equalizer as EqualizerIcon,
  QueueMusic as QueueIcon,
  Radio as RadioIcon,
  Search as SearchIcon,
} from '@mui/icons-material'

/**  ANIMAÇÕES CSS (Keyframes) */

// Nova animação de rotação para o disco
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
  if (song.artist || song.title) {
    return [song.artist, song.title].filter(Boolean).join(' - ')
  }
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

  const params = new URLSearchParams({
    q,
    limit: String(limit),
  })

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

/**  ROUTE  */

export const Route = createFileRoute('/')({
  ssr: false,
  component: MusicRequestQueuePage,
  loader: async () => {
    try {
      const res = await fetch('/api/queue')
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
  const theme = useTheme()
  const loaderData = Route.useLoaderData()

  const initialQueue = (loaderData.queue ?? []) as RadioRequestItem[]

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<YTMusicSearchItem[]>([])
  const [searching, setSearching] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const queue = useMemo(() => initialQueue ?? [], [initialQueue])

  const [azura, setAzura] = useState<AzuraNowPlaying | null>(null)
  const [azuraLoading, setAzuraLoading] = useState<boolean>(true)
  const [azuraError, setAzuraError] = useState<string | null>(null)
  const [selectedMountId, setSelectedMountId] = useState<string>('auto')

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
      } catch (e) {
        if (!alive) return
        setAzura(null)
        setAzuraError('Rádio offline ou inalcançável.')
      } finally {
        if (alive) setAzuraLoading(false)
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
    } catch (err: any) {
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

  const streamSrc = useMemo(() => {
    if (!azura) return undefined
    const mounts = azura.station.mounts ?? []
    if (selectedMountId !== 'auto') {
      const chosen = mounts.find((m) => String(m.id) === selectedMountId)
      if (chosen?.url) return chosen.url
    }
    if (azura.station.listen_url) return azura.station.listen_url
    return mounts[0]?.url
  }, [azura, selectedMountId])

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

          /* ✅ "layout limpo": some barra/tempo/seek */
          '.rhap_progress-section': { display: 'none !important' },
          '.rhap_time': { display: 'none !important' },

          '.rhap_container': {
            backgroundColor: 'transparent !important',
            boxShadow: 'none !important',
            padding: '10px 0 !important',
          },

          /* Mantém o look dos botões */
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

          {/* PLAYER PRINCIPAL (DISCO DE VINIL) */}
          <GlassCard sx={{ mb: 6, position: 'relative', overflow: 'hidden' }}>
            {/* Background Blur da Capa */}
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
              {/* DISCO GIRATÓRIO (VINIL) */}
              <Box
                sx={{
                  position: 'relative',
                  width: { xs: 240, sm: 280 },
                  height: { xs: 240, sm: 280 },
                  flexShrink: 0,
                }}
              >
                {/* Wrapper do Disco (Sombra e Borda) */}
                <Box
                  sx={{
                    width: '100%',
                    height: '100%',
                    borderRadius: '50%',
                    boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
                    border: '4px solid rgba(25,25,25, 0.8)',
                    position: 'relative',
                    animation: isOnline ? `${spin} 8s linear infinite` : 'none',
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
                  {/* Imagem da Arte (Arredondada) */}
                  <Box
                    component="img"
                    src={currentSong?.art || 'https://via.placeholder.com/300/111/fff?text=RADIO'}
                    sx={{
                      width: '100%',
                      height: '100%',
                      borderRadius: '50%',
                      objectFit: 'cover',
                    }}
                  />

                  {/* Furo do Meio (Vinil) */}
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

                {/* Badge de Pedido */}
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

              {/* Informações e Controles */}
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

                {/* Seletor de Qualidade */}
                {mounts.length > 0 && (
                  <FormControl size="small" variant="standard" sx={{ mb: 2, minWidth: 120 }}>
                    <Select
                      value={selectedMountId}
                      onChange={(e) => setSelectedMountId(e.target.value)}
                      disableUnderline
                      sx={{
                        color: '#fff',
                        fontSize: '0.875rem',
                        '.MuiSelect-icon': { color: '#a5b4fc' },
                        '& .MuiSelect-select': {
                          padding: '4px 8px',
                          background: 'rgba(255,255,255,0.1)',
                          borderRadius: 1,
                        },
                      }}
                    >
                      <MenuItem value="auto">Auto Quality</MenuItem>
                      {mounts.map((m) => (
                        <MenuItem key={m.id} value={String(m.id)}>
                          {m.bitrate}kbps {m.format.toUpperCase()}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}

                <Box sx={{ width: '100%' }}>
                  {/* ✅ PLAYER "LIMPO" */}
                  <AudioPlayer
                    src={streamSrc}
                    preload="none"
                    showJumpControls={false}
                    showSkipControls={false}
                    customAdditionalControls={[]}
                    customProgressBarSection={[]} // sem seek/tempo
                    customControlsSection={[
                      RHAP_UI.MAIN_CONTROLS, // play/pause
                      RHAP_UI.VOLUME_CONTROLS, // volume (opcional)
                    ]}
                    layout="horizontal"
                  />
                </Box>

                {listeners && (
                  <Stack direction="row" spacing={1} justifyContent={{ xs: 'center', sm: 'flex-start' }} mt={2}>
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
                  </Stack>
                )}
              </Box>
            </Stack>
          </GlassCard>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={4}>
            {/* COLUNA DA ESQUERDA: BUSCA & RESULTADOS */}
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

            {/* COLUNA DA DIREITA: FILA */}
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
                      {index === 0 && <Chip size="small" label="Next" color="primary" sx={{ height: 20, fontSize: '0.65rem' }} />}
                    </GlassCard>
                  ))}
                </Stack>
              )}
            </Box>
          </Stack>

          {/* HISTÓRICO HORIZONTAL */}
          {azura && azura.song_history.length > 0 && (
            <Box mt={6}>
              <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', mb: 3 }} />
              <Typography variant="overline" sx={{ color: 'rgba(255,255,255,0.5)', letterSpacing: 2 }}>
                Tocou Recentemente
              </Typography>
              <Stack direction="row" spacing={2} sx={{ overflowX: 'auto', py: 2, px: 1 }}>
                {azura.song_history.map((h) => (
                  <Box key={h.sh_id} sx={{ minWidth: 100, maxWidth: 100 }}>
                    <Avatar
                      src={h.song.art || ''}
                      variant="rounded"
                      sx={{ width: 100, height: 100, mb: 1, borderRadius: 3, boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}
                    />
                    <Typography variant="caption" display="block" color="#e2e8f0" noWrap fontWeight={600}>
                      {h.song.title}
                    </Typography>
                    <Typography variant="caption" display="block" color="rgba(255,255,255,0.5)" noWrap>
                      {formatAzuraDate(h.played_at).split(' ')[1]}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}
        </Container>
      </Box>
    </>
  )
}
