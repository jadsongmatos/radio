// src/routes/index.tsx (ou onde estiver sua rota '/')
import React, { useMemo, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
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
  Stack,
  TextField,
  Typography,
  keyframes,
} from '@mui/material'

import {
  Add as AddIcon,
  QueueMusic as QueueIcon,
  Radio as RadioIcon,
  Search as SearchIcon,
} from '@mui/icons-material'

import 'swiper/css'
import 'swiper/css/effect-coverflow'
import 'swiper/css/pagination'
import 'swiper/css/navigation'

import RadioPlayerCard from '@/components/RadioPlayerCard'
import {  useAzuraNowPlaying } from '@/hooks/azuraNowPlaying'

/**  ANIMAÇÕES CSS (Keyframes) */
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

/**  TIPOS (YouTube / Queue) */
type YTMusicSearchItem = {
  videoId: string
  title: string
  artists: Array<string>
  album?: string | null
  durationText?: string | null
  thumbnailUrl?: string | null
  youtubeUrl: string
}

type YTMusicSearchResponse = {
  query: string
  items: Array<YTMusicSearchItem>
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
const YTMUSIC_SEARCH_ENDPOINT = '/api/ytmusic-search'

function formatAzuraDate(timestamp?: number | null) {
  if (!timestamp) return ''
  return new Date(timestamp * 1000).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getYTArtistText(item: YTMusicSearchItem) {
  const s = (item.artists ?? []).filter(Boolean).join(', ').trim()
  return s || 'Desconhecido'
}

function getYTCoverUrl(item: YTMusicSearchItem) {
  return item.thumbnailUrl || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`
}

async function searchYouTubeMusic(query: string, limit = 8): Promise<Array<YTMusicSearchItem>> {
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
  return data?.items ?? []
}

export const Route = createFileRoute('/')({
  ssr: false,
  component: MusicRequestQueuePage,
  loader: async () => {
    try {
      const res = await fetch('/api/queue', {
        cache: 'no-store',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
      })
      if (!res.ok) return { queue: [] as Array<RadioRequestItem> }
      const queue = (await res.json()) as Array<RadioRequestItem>
      return { queue }
    } catch {
      return { queue: [] as Array<RadioRequestItem> }
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

  const initialQueue = loaderData.queue ?? []
  const queue = useMemo(() => initialQueue ?? [], [initialQueue])

  const { data: azura } = useAzuraNowPlaying(15000)
  const isOnline = !!azura?.is_online

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Array<YTMusicSearchItem>>([])
  const [searching, setSearching] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <>
      <GlobalStyles
        styles={{
          body: { margin: 0, padding: 0, background: '#000', fontFamily: "'Inter', sans-serif" },

          '.recentSwiper': { paddingBottom: 28, paddingLeft: 8, paddingRight: 8 },
          '.recentSwiper .swiper-slide': { width: 170 },
          '.recentSwiper .swiper-slide-transform': { height: '100%' },
          '.recentSwiper .swiper-pagination': { bottom: 6 },
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

          {/* ✅ PLAYER agora só recebe azura */}
          <RadioPlayerCard azura={azura} />

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

          {/* TOCOU RECENTEMENTE */}
          {!!azura?.song_history?.length && (
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
                      const time = formatAzuraDate(h.played_at)

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

/** (Opcional) Header de ouvintes usando a mesma query */
export function HeaderOuvintes() {
  const { data: azura } = useAzuraNowPlaying()
  const ouvintes = azura?.listeners?.current ?? 0
  return <div>{ouvintes} ouvintes</div>
}
