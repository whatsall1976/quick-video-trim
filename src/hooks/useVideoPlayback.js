import { useEffect, useRef, useCallback } from 'react'
import { useApp } from '../context/AppContext'

const SPEED_STEPS = [1, 2, 4, 6, 8, 10]

// Keep a module-level ref map so tick can read latest values

export function useVideoPlayback(videoRef) {
  const { state, dispatch, toast } = useApp()
  const { video, playback, isDetecting } = state
  const rafRef = useRef(null)
  const shiftStepRef = useRef(1)
  const frameRef = useRef(playback.currentFrame)
  const totalFramesRef = useRef(video.totalFrames)

  // Keep refs in sync with state
  frameRef.current = playback.currentFrame
  totalFramesRef.current = video.totalFrames
  const shiftStepTimerRef = useRef(null)

  // Advance frame by delta, clamp to valid range
  const seekFrame = useCallback((delta) => {
    dispatch({ type: 'SET_FRAME', payload: Math.max(0, Math.min(video.totalFrames - 1, playback.currentFrame + delta)) })
  }, [dispatch, playback.currentFrame, video.totalFrames])

  // Stable refs for RAF (avoids stale closures)
  const fpsRef = useRef(video.fps)
  const speedRef = useRef(playback.playbackSpeed)
  fpsRef.current = video.fps
  speedRef.current = playback.playbackSpeed

  // Sync frame counter to video's actual playback position
  const tick = useCallback(() => {
    const vid = videoRef?.current
    if (!vid) return

    const frameFromVideo = Math.round(vid.currentTime * (fpsRef.current || 30))
    if (frameFromVideo !== frameRef.current && frameFromVideo < totalFramesRef.current) {
      dispatch({ type: 'SET_FRAME', payload: frameFromVideo })
    }

    // Check if reached end
    if (vid.ended) {
      dispatch({ type: 'SET_PLAYING', payload: false })
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [dispatch, videoRef])

  // Start/stop playback and RAF sync loop
  useEffect(() => {
    const vid = videoRef?.current
    if (!vid) return

    if (playback.isPlaying) {
      vid.play().catch(err => console.error('[DEBUG] Failed to play:', err))
      rafRef.current = requestAnimationFrame(tick)
    } else {
      vid.pause()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [playback.isPlaying, tick, videoRef])

  // Sync video element to current frame (only when paused for scrubbing)
  useEffect(() => {
    const vid = videoRef?.current
    if (!vid || !video.fps || playback.isPlaying || isDetecting) return
    const targetTime = playback.currentFrame / video.fps
    if (Math.abs(vid.currentTime - targetTime) > 0.01) {
      vid.currentTime = targetTime
    }
  }, [playback.currentFrame, playback.isPlaying, isDetecting, video.fps, videoRef])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      // Don't steal from inputs
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return
      const { isPlaying, currentFrame, playbackSpeed } = state.playback

      if (e.code === 'Space') {
        e.preventDefault()
        if (!video.file) return
        console.log('[DEBUG] Space pressed, toggling play:', isPlaying, '→', !isPlaying)
        dispatch({ type: 'SET_PLAYING', payload: !isPlaying })
      }

      if (e.code === 'ArrowRight') {
        e.preventDefault()
        if (!video.file) return
        if (isPlaying && e.shiftKey) {
          // Increase speed
          const idx = SPEED_STEPS.indexOf(playbackSpeed)
          const next = SPEED_STEPS[Math.min(idx + 1, SPEED_STEPS.length - 1)]
          dispatch({ type: 'SET_SPEED', payload: next })
          toast(`Speed ${next}x`, 'info', 800)
        } else if (!isPlaying) {
          if (e.shiftKey) {
            dispatch({ type: 'SET_FRAME', payload: Math.min(video.totalFrames - 1, currentFrame + shiftStepRef.current) })
            // Accelerate
            clearTimeout(shiftStepTimerRef.current)
            shiftStepRef.current = Math.min(shiftStepRef.current * 2, 64)
            shiftStepTimerRef.current = setTimeout(() => { shiftStepRef.current = 1 }, 300)
          } else {
            shiftStepRef.current = 1
            dispatch({ type: 'SET_FRAME', payload: Math.min(video.totalFrames - 1, currentFrame + 1) })
          }
        }
      }

      if (e.code === 'ArrowLeft') {
        e.preventDefault()
        if (!video.file) return
        if (isPlaying && e.shiftKey) {
          const idx = SPEED_STEPS.indexOf(playbackSpeed)
          const next = SPEED_STEPS[Math.max(idx - 1, 0)]
          dispatch({ type: 'SET_SPEED', payload: next })
          toast(`Speed ${next}x`, 'info', 800)
        } else if (!isPlaying) {
          if (e.shiftKey) {
            dispatch({ type: 'SET_FRAME', payload: Math.max(0, currentFrame - shiftStepRef.current) })
            clearTimeout(shiftStepTimerRef.current)
            shiftStepRef.current = Math.min(shiftStepRef.current * 2, 64)
            shiftStepTimerRef.current = setTimeout(() => { shiftStepRef.current = 1 }, 300)
          } else {
            shiftStepRef.current = 1
            dispatch({ type: 'SET_FRAME', payload: Math.max(0, currentFrame - 1) })
          }
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.playback, video, dispatch, toast])

  return { seekFrame }
}
