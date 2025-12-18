// RadioPlayerCard.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import Hls from 'hls.js'

import AudioPlayer, { RHAP_UI } from 'react-h5-audio-player'
import 'react-h5-audio-player/lib/styles.css'

import {
  Box,
  Card,
  Chip,
  Divider,
  GlobalStyles,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Switch,
  Typography,
  keyframes,
} from '@mui/material'

import { Check as CheckIcon, Equalizer as EqualizerIcon, Settings as SettingsIcon } from '@mui/icons-material'

import type { AzuraNowPlaying, AzuraSong } from '@/hooks/azuraNowPlaying'

/** SUA URL HLS FIXA */
const HLS_STREAM_URL = 'https://webradio.dpdns.org/hls/j/live.m3u8'

// Seus parâmetros de servidor
const HLS_SEGMENT_DURATION_SECONDS = 2
const HLS_PLAYLIST_SEGMENTS = 30

/** HELPERS */
function getAzuraSongText(song?: AzuraSong | null) {
  if (!song) return ''
  if (song.text) return song.text
  if (song.artist || song.title) return [song.artist, song.title].filter(Boolean).join(' - ')
  return ''
}

/** UI */
const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`

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

type RadioPlayerCardProps = {
  azura?: AzuraNowPlaying | null
}

export default function RadioPlayerCard({ azura }: RadioPlayerCardProps) {
  const currentSong = azura?.now_playing?.song ?? null
  const isOnline = !!azura?.is_online
  const listeners = azura?.listeners
  const mounts = azura?.station?.mounts ?? []

  // --- Menu Config ---
  const [settingsAnchorEl, setSettingsAnchorEl] = useState<null | HTMLElement>(null)
  const isSettingsOpen = Boolean(settingsAnchorEl)
  const handleSettingsOpen = (event: React.MouseEvent<HTMLElement>) => setSettingsAnchorEl(event.currentTarget)
  const handleSettingsClose = () => setSettingsAnchorEl(null)

  const [selectedMountId, setSelectedMountId] = useState<string>('hls')

  // --- Audio / HLS / KeepAlive ---
  const playerRef = useRef<any>(null)

  const [keepAliveEnabled, setKeepAliveEnabled] = useState(true)
  const keepAliveRef = useRef(true)
  useEffect(() => {
    keepAliveRef.current = keepAliveEnabled
  }, [keepAliveEnabled])

  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const autoplayBlockedRef = useRef(false)
  useEffect(() => {
    autoplayBlockedRef.current = autoplayBlocked
  }, [autoplayBlocked])

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
      if (!usingHlsJsRef.current) audio.load()
      await audio.play()
      setAutoplayBlocked(false)
      return true
    } catch {
      setAutoplayBlocked(true)
      return false
    }
  }, [])

  const streamSrc = useMemo(() => {
    if (selectedMountId === 'hls') return HLS_STREAM_URL
    if (selectedMountId === 'hls-azura' && azura?.station?.hls_url) return azura.station.hls_url

    if (!azura) return undefined

    if (selectedMountId !== 'auto') {
      const chosen = mounts.find((m) => String(m.id) === selectedMountId)
      if (chosen?.url) return chosen.url
    }

    if (azura.station.listen_url) return azura.station.listen_url
    return mounts[0]?.url
  }, [azura, mounts, selectedMountId])

  const effectiveStreamSrc = useMemo(() => {
    if (!streamSrc) return undefined
    const sep = streamSrc.includes('?') ? '&' : '?'
    return `${streamSrc}${sep}_t=${streamBuster}`
  }, [streamSrc, streamBuster])

  const isHlsUrl = useMemo(() => (effectiveStreamSrc ?? '').includes('.m3u8'), [effectiveStreamSrc])

  useEffect(() => {
    const audio = playerRef.current?.audio?.current as HTMLAudioElement | undefined
    if (!audio) return

    if (hlsRef.current) {
      try {
        hlsRef.current.destroy()
      } catch {}
      hlsRef.current = null
    }
    usingHlsJsRef.current = false

    const url = effectiveStreamSrc
    if (!url) return

    if (!isHlsUrl) {
      audio.src = url
      return
    }

    const canNativeHls = !!audio.canPlayType('application/vnd.apple.mpegurl')
    if (canNativeHls) {
      audio.src = url
      usingHlsJsRef.current = false
      return
    }

    if (!Hls.isSupported()) {
      audio.src = url
      usingHlsJsRef.current = false
      return
    }

    audio.removeAttribute('src')
    audio.load()

    const playlistWindowSeconds = HLS_SEGMENT_DURATION_SECONDS * HLS_PLAYLIST_SEGMENTS

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
      if (autoplayBlockedRef.current) return
      await tryPlay()
    }

    const onError = (_event: string, data: any) => {
      if (!data?.fatal) return

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        try {
          hls.startLoad()
        } catch {
          setStreamBuster((v) => v + 1)
        }
        return
      }

      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        try {
          hls.recoverMediaError()
        } catch {
          setStreamBuster((v) => v + 1)
        }
        return
      }

      try {
        hls.destroy()
      } catch {}
      hlsRef.current = null
      usingHlsJsRef.current = false
      setStreamBuster((v) => v + 1)
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
  }, [effectiveStreamSrc, isHlsUrl, tryPlay])

  const scheduleRetry = useCallback(
    (_reason: string) => {
      if (manualPausedRef.current) return
      if (!keepAliveRef.current || !isOnline) return
      if (autoplayBlockedRef.current) return

      clearRetry()
      const delay = backoffRef.current

      retryTimerRef.current = window.setTimeout(async () => {
        if (manualPausedRef.current) return
        if (!keepAliveRef.current || !isOnline) return
        if (autoplayBlockedRef.current) return

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
    [clearRetry, isOnline, tryPlay]
  )

  useEffect(() => {
    if (!keepAliveEnabled) return
    if (!isOnline) {
      clearRetry()
      return
    }
    if (manualPausedRef.current) return
    scheduleRetry('online-or-src-change')
  }, [keepAliveEnabled, isOnline, effectiveStreamSrc, scheduleRetry, clearRetry])

  useEffect(() => {
    if (!keepAliveEnabled) return
    const id = window.setInterval(() => {
      if (!keepAliveRef.current || !isOnline) return
      if (manualPausedRef.current) return
      if (autoplayBlockedRef.current) return
      const audio = playerRef.current?.audio?.current as HTMLAudioElement | undefined
      if (audio?.paused) scheduleRetry('watchdog-paused')
    }, 12000)
    return () => window.clearInterval(id)
  }, [isOnline, keepAliveEnabled, scheduleRetry])

  useEffect(() => {
    const audio = playerRef.current?.audio?.current as HTMLAudioElement | undefined
    if (!audio) return
    const onStalled = () => scheduleRetry('stalled')
    audio.addEventListener('stalled', onStalled)
    return () => audio.removeEventListener('stalled', onStalled)
  }, [scheduleRetry])

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
        }}
      />

      <GlassCard sx={{ mb: 6, position: 'relative', overflow: 'hidden' }}>
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
          <Box sx={{ position: 'relative', width: { xs: 240, sm: 280 }, height: { xs: 240, sm: 280 }, flexShrink: 0 }}>
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
                src={isHlsUrl ? undefined : (effectiveStreamSrc ?? undefined)}
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
    </>
  )
}
