import React, { useMemo, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn, useServerFn } from '@tanstack/react-start'

import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  Add as AddIcon,
  MusicNote as MusicIcon,
  QueueMusic as QueueIcon,
  Search as SearchIcon,
} from '@mui/icons-material'
import { prisma } from '@/db'

type MBRecording = {
  id: string
  title: string
  'artist-credit': Array<{
    name: string
    artist?: { id: string; name: string }
  }>
  releases?: Array<{ id: string; title: string }>
  cover_url?: string
}

const MB_USER_AGENT = 'MusicMatchApp/1.0.0 ( contact@example.com )'

function getCoverArtUrlFromReleaseMbid(
  releaseMbid?: string | null,
  size: 250 | 500 | 1200 = 250,
) {
  if (!releaseMbid) return undefined
  return `https://coverartarchive.org/release/${releaseMbid}/front-${size}`
}

const searchMusicFn = createServerFn({ method: 'GET' })
  .inputValidator((data: { query: string }) => data)
  .handler(async ({ data }) => {
    const query = data.query.trim()
    if (!query) return []

    try {
      const response = await fetch(
        `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(
          query,
        )}&fmt=json&limit=8&inc=releases`,
        {
          headers: {
            'User-Agent': MB_USER_AGENT,
            Accept: 'application/json',
          },
        },
      )

      if (!response.ok) throw new Error('Erro MusicBrainz (search)')
      const result = await response.json()

      const recordings = result.recordings

      const enriched: Array<MBRecording> = recordings.map((rec: { releases: Array<{ id: any }> }) => {
        const firstReleaseMbid = rec.releases[0]?.id
        const cover_url = getCoverArtUrlFromReleaseMbid(firstReleaseMbid, 250)
        return {
          ...rec,
          ...(cover_url ? { cover_url } : {}),
        }
      })

      return enriched
    } catch (error) {
      console.error('Server Error (Search):', error)
      return []
    }
  })

const getQueueFn = createServerFn({ method: 'GET' }).handler(async () => {
  // Ordem de chegada
  return await prisma.radioRequest.findMany({
    orderBy: { createdAt: 'asc' },
  })
})

const addToQueueFn = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      recordingMbid: string
      trackName: string
      artistName: string
      releaseName?: string
      coverUrl?: string
    }) => data,
  )
  .handler(async ({ data }) => {
    const trackName = data.trackName.trim()
    const artistName = data.artistName.trim()
    const recordingMbid = data.recordingMbid.trim()

    if (!recordingMbid || !trackName || !artistName) {
      throw new Error('Dados inválidos para adicionar à fila.')
    }

    return await prisma.radioRequest.create({
      data: {
        recordingMbid,
        trackName,
        artistName,
        releaseName: data.releaseName?.trim() || null,
        coverUrl: data.coverUrl?.trim() || null,
      },
    })
  })


export const Route = createFileRoute('/queue')({
    ssr: false,
  component: MusicRequestQueuePage,
  loader: async () => await getQueueFn(),
})


function getArtistName(track: MBRecording) {
  return track['artist-credit'][0]?.name || 'Desconhecido'
}

function getReleaseName(track: MBRecording) {
  return track.releases?.[0]?.title
}


function MusicRequestQueuePage() {
  const router = useRouter()
  const initialQueue = Route.useLoaderData()

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Array<MBRecording>>([])
  const [searching, setSearching] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const searchMusic = useServerFn(searchMusicFn)
  const addToQueue = useServerFn(addToQueueFn)

  const queue = useMemo(() => initialQueue ?? [], [initialQueue])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()

    const q = query.trim()
    if (!q) return

    setSearching(true)
    setError(null)
    setSearchResults([])

    try {
      const results = await searchMusic({ data: { query: q } })
      if (results && results.length > 0) {
        setSearchResults(results)
      } else {
        setError('Nenhuma música encontrada com esse termo.')
      }
    } catch (err) {
      console.error(err)
      setError('Falha na busca. Tente novamente.')
    } finally {
      setSearching(false)
    }
  }

  const handleAdd = async (track: MBRecording) => {
    setAddingId(track.id)
    setError(null)

    try {
      await addToQueue({
        data: {
          recordingMbid: track.id,
          trackName: track.title,
          artistName: getArtistName(track),
          releaseName: getReleaseName(track),
          coverUrl: track.cover_url,
        },
      })

      // Recarrega a fila via loader
      router.invalidate()

      // Opcional: limpa resultados para incentivar nova busca
      // setSearchResults([])
      // setQuery('')
    } catch (err) {
      console.error(err)
      setError('Não foi possível adicionar à fila.')
    } finally {
      setAddingId(null)
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background:
          'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0b1020 100%)',
        py: 8,
        px: 2,
      }}
    >
      <Container maxWidth="md">
        <Paper
          elevation={16}
          sx={{
            p: { xs: 3, sm: 4 },
            borderRadius: 4,
            background: 'rgba(255, 255, 255, 0.97)',
            backdropFilter: 'blur(12px)',
          }}
        >
          {/* Header */}
          <Stack alignItems="center" spacing={1.5} mb={4}>
            <Avatar sx={{ bgcolor: '#4f46e5', width: 64, height: 64 }}>
              <QueueIcon fontSize="large" />
            </Avatar>
            <Typography variant="h4" fontWeight={800} textAlign="center">
              Pedidos de Música
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              textAlign="center"
            >
              Busque no MusicBrainz e adicione à fila da rádio.
            </Typography>
          </Stack>

          {/* Search */}
          <form onSubmit={handleSearch}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={2}>
              <TextField
                fullWidth
                label="Música ou artista"
                placeholder="Ex: Do I Wanna Know?"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={searching || !!addingId}
                InputProps={{
                  startAdornment: (
                    <Box sx={{ display: 'flex', alignItems: 'center', mr: 1 }}>
                      <MusicIcon color="action" />
                    </Box>
                  ),
                }}
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={searching || !!addingId || !query.trim()}
                startIcon={
                  searching ? (
                    <CircularProgress size={20} color="inherit" />
                  ) : (
                    <SearchIcon />
                  )
                }
                sx={{
                  bgcolor: '#4f46e5',
                  '&:hover': { bgcolor: '#4338ca' },
                  minWidth: { sm: 140 },
                }}
              >
                Buscar
              </Button>
            </Stack>
          </form>

          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          {/* Search Results */}
          {searchResults.length > 0 && (
            <Box mb={4}>
              <Typography variant="h6" fontWeight={700} gutterBottom>
                Resultados
              </Typography>

              <Stack spacing={1}>
                {searchResults.map((track) => {
                  const artist = getArtistName(track)
                  const release = getReleaseName(track)
                  const isAdding = addingId === track.id

                  return (
                    <Card
                      key={track.id}
                      variant="outlined"
                      sx={{
                        borderRadius: 2,
                        overflow: 'hidden',
                        '&:hover': {
                          borderColor: '#4f46e5',
                          bgcolor: '#f8f9ff',
                        },
                      }}
                    >
                      <CardActionArea
                        onClick={() => (isAdding ? null : handleAdd(track))}
                        disabled={isAdding}
                        sx={{ p: 2 }}
                      >
                        <Stack
                          direction="row"
                          alignItems="center"
                          spacing={2}
                          justifyContent="space-between"
                        >
                          <Stack
                            direction="row"
                            spacing={2}
                            alignItems="center"
                            sx={{ minWidth: 0 }}
                          >
                            <Avatar
                              variant="rounded"
                              src={track.cover_url}
                              sx={{
                                width: 56,
                                height: 56,
                                bgcolor: track.cover_url
                                  ? '#ffffff'
                                  : '#e5e7eb',
                                flexShrink: 0,
                              }}
                              imgProps={{ loading: 'lazy' }}
                            >
                              {!track.cover_url
                                ? artist
                                    .split(' ')
                                    .map((p) => p[0])
                                    .join('')
                                    .slice(0, 2)
                                : null}
                            </Avatar>

                            <Box sx={{ minWidth: 0 }}>
                              <Typography
                                variant="subtitle1"
                                fontWeight={700}
                                noWrap
                              >
                                {track.title}
                              </Typography>
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                noWrap
                              >
                                {artist}
                              </Typography>
                              {release && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  noWrap
                                >
                                  {release}
                                </Typography>
                              )}
                            </Box>
                          </Stack>

                          <Chip
                            icon={
                              isAdding ? (
                                <CircularProgress size={14} />
                              ) : (
                                <AddIcon />
                              )
                            }
                            label={
                              isAdding ? 'Adicionando...' : 'Adicionar à fila'
                            }
                            color="primary"
                            size="small"
                            sx={{
                              bgcolor: '#4f46e5',
                              flexShrink: 0,
                            }}
                          />
                        </Stack>
                      </CardActionArea>
                    </Card>
                  )
                })}
              </Stack>
            </Box>
          )}

          <Divider sx={{ my: 3 }} />

          {/* Queue */}
          <Box>
            <Stack direction="row" alignItems="center" spacing={1} mb={2}>
              <QueueIcon fontSize="small" />
              <Typography variant="h6" fontWeight={800}>
                Fila da Rádio
              </Typography>
              <Chip
                size="small"
                label={`${queue.length} ${queue.length === 1 ? 'pedido' : 'pedidos'}`}
                sx={{ ml: 1 }}
              />
            </Stack>

            {queue.length === 0 && (
              <Box
                sx={{
                  p: 3,
                  borderRadius: 2,
                  bgcolor: '#f6f7fb',
                  border: '1px dashed #c7c9d9',
                }}
              >
                <Typography color="text.secondary">
                  A fila está vazia. Faça uma busca e adicione a primeira
                  música.
                </Typography>
              </Box>
            )}

            <Stack spacing={1.2}>
              {queue.map((item, index) => (
                <Card
                  key={item.id}
                  variant="outlined"
                  sx={{
                    borderRadius: 2,
                    p: 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    bgcolor: index === 0 ? '#f5f3ff' : '#ffffff',
                    borderColor: index === 0 ? '#c4b5fd' : 'rgba(0,0,0,0.08)',
                  }}
                >
                  <Avatar
                    variant="rounded"
                    src={item.coverUrl ?? undefined}
                    sx={{
                      width: 52,
                      height: 52,
                      bgcolor: item.coverUrl ? '#ffffff' : '#e5e7eb',
                      fontWeight: 800,
                    }}
                  >
                    {!item.coverUrl ? index + 1 : null}
                  </Avatar>

                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="subtitle1" fontWeight={700} noWrap>
                      {item.trackName}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {item.artistName}
                    </Typography>
                    {item.releaseName && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                      >
                        {item.releaseName}
                      </Typography>
                    )}
                  </Box>

                  <Chip
                    size="small"
                    label={index === 0 ? 'Próxima' : `#${index + 1}`}
                    sx={{
                      bgcolor: index === 0 ? '#4f46e5' : '#eef2ff',
                      color: index === 0 ? '#fff' : '#1e1b4b',
                      fontWeight: 700,
                    }}
                  />
                </Card>
              ))}
            </Stack>
          </Box>
        </Paper>
      </Container>
    </Box>
  )
}
