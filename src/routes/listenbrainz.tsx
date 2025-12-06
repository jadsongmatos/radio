import React, { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn, useServerFn } from '@tanstack/react-start'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  CircularProgress,
  Container,
  Grid,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
  Chip
} from '@mui/material'
import {
  MusicNote as MusicIcon,
  Search as SearchIcon,
  Radio as RadioIcon,
  YouTube as YouTubeIcon
} from '@mui/icons-material'

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

type LBRecommendation = {
  recording_mbid: string
  track_name: string
  artist_name: string
  release_name?: string
  score?: number
  cover_url?: string
}

const MB_USER_AGENT = 'MusicMatchApp/1.0.0 ( contact@example.com )'

// Namespace de extensão usado pelo JSPF do ListenBrainz/MusicBrainz
const JSPF_TRACK_NS = 'https://musicbrainz.org/doc/jspf#track'

function extractRecordingMbidFromIdentifier(identifier?: string | string[]) {
  if (!identifier) return null
  const ids = Array.isArray(identifier) ? identifier : [identifier]

  for (const id of ids) {
    const match = String(id).match(/musicbrainz\.org\/recording\/([0-9a-fA-F-]{36})/)
    if (match?.[1]) return match[1]
  }
  return null
}

function extractReleaseMbidFromIdentifier(identifier?: string | string[]) {
  if (!identifier) return null
  const ids = Array.isArray(identifier) ? identifier : [identifier]

  for (const id of ids) {
    const match = String(id).match(/musicbrainz\.org\/release\/([0-9a-fA-F-]{36})/)
    if (match?.[1]) return match[1]
  }
  return null
}

function getCoverArtUrlFromReleaseMbid(
  releaseMbid?: string | null,
  size: 250 | 500 | 1200 = 250
) {
  if (!releaseMbid) return undefined
  return `https://coverartarchive.org/release/${releaseMbid}/front-${size}`
}

function getJspfTracks(lbData: any): any[] {
  const jspf = lbData?.payload?.jspf
  if (!jspf) return []

  const t1 = jspf?.playlist?.track
  if (Array.isArray(t1)) return t1

  const t2 = jspf?.track
  if (Array.isArray(t2)) return t2

  return []
}

async function fetchLbRadio(prompt: string, mode: 'easy' | 'medium' | 'hard' = 'easy') {
  const url =
    `https://api.listenbrainz.org/1/explore/lb-radio` +
    `?prompt=${encodeURIComponent(prompt)}` +
    `&mode=${encodeURIComponent(mode)}`

  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  return res.json()
}

// SERVER

/**
 * 1) Buscar músicas no MusicBrainz
 *    - já devolve cover_url calculada via Cover Art Archive
 */
const searchMusicFn = createServerFn({ method: 'GET' })
  .inputValidator((data: { query: string }) => data)
  .handler(async ({ data }) => {
    const query = data.query?.trim()
    if (!query) return []

    try {
      const response = await fetch(
        `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(
          query,
        )}&fmt=json&limit=5&inc=releases`,
        {
          headers: {
            'User-Agent': MB_USER_AGENT,
            Accept: 'application/json',
          },
        },
      )

      if (!response.ok) throw new Error('Erro MusicBrainz (search)')
      const result = await response.json()

      const recordings = (result.recordings as MBRecording[]) || []

      // Enriquecer cada recording com cover_url (usando o primeiro release, se existir)
      const enriched: MBRecording[] = recordings.map((rec) => {
        const firstReleaseMbid = rec.releases?.[0]?.id
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

/**
 * 2) Gerar Rádio no ListenBrainz via prompt
 *    - continua usando JSPF + release_identifier para pegar a capa
 */
const getRadioFn = createServerFn({ method: 'GET' })
  .inputValidator((data: { recording_mbid: string }) => data)
  .handler(async ({ data }) => {
    const recording_mbid = data.recording_mbid
    if (!recording_mbid) return []

    try {
      // 1) Lookup da recording no MusicBrainz para achar artista seed
      const mbRes = await fetch(
        `https://musicbrainz.org/ws/2/recording/${encodeURIComponent(
          recording_mbid,
        )}?inc=artist-credits&fmt=json`,
        {
          headers: {
            'User-Agent': MB_USER_AGENT,
            Accept: 'application/json',
          },
        },
      )

      if (!mbRes.ok) throw new Error('Erro MusicBrainz (lookup recording)')
      const mbData = await mbRes.json()

      const ac0 = mbData?.['artist-credit']?.[0]
      const seedArtistMbid: string | undefined = ac0?.artist?.id
      const seedArtistName: string | undefined = ac0?.artist?.name ?? ac0?.name

      if (!seedArtistMbid && !seedArtistName) return []

      // 2) Tentar prompts
      const prompts: string[] = []
      if (seedArtistMbid) prompts.push(`artist:(${seedArtistMbid})`)
      if (seedArtistName) prompts.push(`artist:(${seedArtistName})`)

      let tracks: any[] = []

      for (const pr of prompts) {
        const lbData = await fetchLbRadio(pr, 'easy')
        if (!lbData) continue

        const t = getJspfTracks(lbData)
        if (t.length) {
          tracks = t
          break
        }
      }

      // fallback leve de modo (não é fallback de rede para capa)
      if (!tracks.length && prompts[0]) {
        const lbData = await fetchLbRadio(prompts[0], 'medium')
        if (lbData) {
          const t = getJspfTracks(lbData)
          if (t.length) tracks = t
        }
      }

      if (!tracks.length) return []

      // 3) JSPF -> shape simples para UI (com cover_url)
      const recs: LBRecommendation[] = tracks
        .map((t: any) => {
          const mbid = extractRecordingMbidFromIdentifier(t?.identifier)
          if (!mbid) return null

          const track_name =
            typeof t?.title === 'string' && t.title.trim()
              ? t.title
              : 'Faixa desconhecida'

          const artist_name =
            typeof t?.creator === 'string' && t.creator.trim()
              ? t.creator
              : 'Artista desconhecido'

          const release_name =
            typeof t?.album === 'string' && t.album.trim()
              ? t.album
              : undefined

          // Tenta pegar o release_identifier da extensão do JSPF
          const ext = t?.extension?.[JSPF_TRACK_NS]
          const releaseIdentifier = ext?.release_identifier
          const releaseMbid = extractReleaseMbidFromIdentifier(releaseIdentifier)
          const cover_url = getCoverArtUrlFromReleaseMbid(releaseMbid, 250)

          return {
            recording_mbid: mbid,
            track_name,
            artist_name,
            ...(release_name ? { release_name } : {}),
            ...(cover_url ? { cover_url } : {}),
          }
        })
        .filter(Boolean) as LBRecommendation[]

      // remover seed
      return recs.filter((r) => r.recording_mbid !== recording_mbid)
    } catch (error) {
      console.error('Server Error (Radio):', error)
      return []
    }
  })

// FRONTEND

export const Route = createFileRoute('/listenbrainz')({
  component: MusicRadioPage,
})

function MusicRadioPage() {
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<MBRecording[]>([])
  const [searching, setSearching] = useState(false)

  const [selectedTrack, setSelectedTrack] = useState<MBRecording | null>(null)
  const [recommendations, setRecommendations] = useState<LBRecommendation[]>([])
  const [loadingRadio, setLoadingRadio] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const searchMusic = useServerFn(searchMusicFn)
  const getRadio = useServerFn(getRadioFn)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setSearching(true)
    setError(null)
    setSearchResults([])
    setSelectedTrack(null)
    setRecommendations([])

    try {
      const results = await searchMusic({ data: { query: query.trim() } })

      if (results && results.length > 0) {
        setSearchResults(results)
      } else {
        setError('Nenhuma música encontrada com esse nome.')
      }
    } catch (err) {
      console.error(err)
      setError('Falha na busca. Tente novamente.')
    } finally {
      setSearching(false)
    }
  }

  const generateRadio = async (track: MBRecording) => {
    setSelectedTrack(track)
    setLoadingRadio(true)
    setError(null)
    setRecommendations([])

    try {
      const recs = await getRadio({ data: { recording_mbid: track.id } })

      if (!recs || recs.length === 0) {
        setError('Não foram encontradas recomendações suficientes para esta faixa.')
        return
      }

      setRecommendations(recs)
    } catch (err) {
      console.error(err)
      setError('Não foi possível gerar a rádio. Tente novamente.')
    } finally {
      setLoadingRadio(false)
    }
  }

  const getArtistName = (track: MBRecording) => {
    return track['artist-credit']?.[0]?.name || 'Desconhecido'
  }

  const handleReset = () => {
    setRecommendations([])
    setSelectedTrack(null)
    setSearchResults([])
    setQuery('')
    setError(null)
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        py: 8,
        px: 2,
      }}
    >
      <Container maxWidth="md">
        <Paper
          elevation={12}
          sx={{
            p: 4,
            borderRadius: 4,
            background: 'rgba(255, 255, 255, 0.96)',
            backdropFilter: 'blur(12px)',
          }}
        >
          {/* Header */}
          <Box display="flex" flexDirection="column" alignItems="center" mb={4}>
            <Avatar sx={{ bgcolor: '#764ba2', width: 64, height: 64, mb: 2 }}>
              <RadioIcon fontSize="large" />
            </Avatar>
            <Typography
              variant="h3"
              component="h1"
              fontWeight="800"
              sx={{ color: '#2D3436', textAlign: 'center' }}
            >
              Rádio Inteligente
            </Typography>
            <Typography
              variant="body1"
              color="text.secondary"
              sx={{ mt: 1, textAlign: 'center' }}
            >
              Busque uma música e descubra faixas semelhantes via <strong>ListenBrainz</strong>.
            </Typography>
          </Box>

          {/* Search Form */}
          <form onSubmit={handleSearch}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={4}>
              <TextField
                fullWidth
                variant="outlined"
                label="Qual música você quer ouvir?"
                placeholder="Ex: Do I Wanna Know?"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={searching || loadingRadio}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <MusicIcon color="action" />
                    </InputAdornment>
                  ),
                }}
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={searching || !query.trim() || loadingRadio}
                startIcon={
                  searching ? <CircularProgress size={20} color="inherit" /> : <SearchIcon />
                }
                sx={{
                  bgcolor: '#764ba2',
                  '&:hover': { bgcolor: '#5f378a' },
                  minWidth: '140px',
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

          {/* RESULTADOS DA BUSCA (agora com capas) */}
          {searchResults.length > 0 && !recommendations.length && !loadingRadio && (
            <Box mb={4} sx={{ animation: 'fadeIn 0.5s' }}>
              <Typography variant="h6" fontWeight="bold" gutterBottom>
                Selecione a versão correta:
              </Typography>
              <Stack spacing={1}>
                {searchResults.map((track) => (
                  <Card
                    key={track.id}
                    variant="outlined"
                    sx={{ '&:hover': { borderColor: '#764ba2', bgcolor: '#fbfbff' } }}
                  >
                    <CardActionArea onClick={() => generateRadio(track)} sx={{ p: 2 }}>
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
                          sx={{ flexGrow: 1, minWidth: 0 }}
                        >
                          {/* Capa do release (quando existir) */}
                          <Avatar
                            variant="rounded"
                            src={track.cover_url}
                            sx={{
                              width: 56,
                              height: 56,
                              bgcolor: track.cover_url ? '#ffffff' : '#dfe6e9',
                              flexShrink: 0,
                            }}
                            imgProps={{ loading: 'lazy' }}
                          >
                            {/* Fallback: iniciais do artista */}
                            {!track.cover_url
                              ? getArtistName(track)
                                  .split(' ')
                                  .map((p) => p[0])
                                  .join('')
                                  .slice(0, 2)
                              : null}
                          </Avatar>

                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="subtitle1" fontWeight="bold" noWrap>
                              {track.title}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" noWrap>
                              {getArtistName(track)}
                            </Typography>
                          </Box>
                        </Stack>

                        <Chip
                          label="Gerar Rádio"
                          color="primary"
                          size="small"
                          icon={<RadioIcon />}
                          sx={{ bgcolor: '#764ba2', cursor: 'pointer', flexShrink: 0 }}
                        />
                      </Stack>
                    </CardActionArea>
                  </Card>
                ))}
              </Stack>
            </Box>
          )}

          {/* LOADING DA RÁDIO */}
          {loadingRadio && (
            <Box display="flex" flexDirection="column" alignItems="center" py={4}>
              <CircularProgress size={50} sx={{ color: '#764ba2', mb: 2 }} />
              <Typography>Sintonizando frequências...</Typography>
            </Box>
          )}

          {/* RECOMENDAÇÕES (com capas) */}
          {recommendations.length > 0 && selectedTrack && (
            <Box sx={{ animation: 'fadeIn 0.5s' }}>
              <Box
                sx={{
                  bgcolor: '#f0f2f5',
                  p: 2,
                  borderRadius: 2,
                  mb: 3,
                  borderLeft: '5px solid #764ba2',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Rádio baseada em:
                  </Typography>
                  <Typography variant="h6" color="#764ba2" fontWeight="bold">
                    {selectedTrack.title}
                  </Typography>
                  <Typography variant="body2">{getArtistName(selectedTrack)}</Typography>
                </Box>
                <Button size="small" variant="outlined" color="secondary" onClick={handleReset}>
                  Nova Busca
                </Button>
              </Box>

              <Grid container spacing={2}>
                {recommendations.map((rec, index) => (
                  <Grid item xs={12} key={`${rec.recording_mbid}-${index}`}>
                    <Card
                      elevation={2}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        p: 2,
                        transition: '0.2s',
                        '&:hover': { transform: 'scale(1.01)', boxShadow: 4 },
                      }}
                    >
                      {/* Capa (quando existir), senão número do ranking */}
                      <Avatar
                        variant="rounded"
                        src={rec.cover_url}
                        sx={{
                          width: 56,
                          height: 56,
                          mr: 2,
                          bgcolor: rec.cover_url
                            ? '#ffffff'
                            : index < 3
                            ? '#eb5757'
                            : '#a0a0a0',
                          fontWeight: 'bold',
                          flexShrink: 0,
                        }}
                        imgProps={{ loading: 'lazy' }}
                      >
                        {!rec.cover_url ? index + 1 : null}
                      </Avatar>

                      <Box sx={{ flexGrow: 1, overflow: 'hidden', mr: 2 }}>
                        <Typography variant="subtitle1" fontWeight="600" noWrap>
                          {rec.track_name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {rec.artist_name}
                        </Typography>
                        {rec.release_name && (
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {rec.release_name}
                          </Typography>
                        )}
                      </Box>

                      <IconButton
                        color="error"
                        href={`https://www.youtube.com/results?search_query=${encodeURIComponent(
                          `${rec.artist_name} - ${rec.track_name}`,
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Ouvir no YouTube"
                      >
                        <YouTubeIcon />
                      </IconButton>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}
        </Paper>
      </Container>
    </Box>
  )
}

