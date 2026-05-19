import { useEffect, useRef, useCallback } from 'react'
import { useApp } from '../context/AppContext'

const SPEED_STEPS = [1, 2, 4, 6, 8, 10]

export function useVideoPlayback(videoRef) {
  const { state, dispatch, toast } = useApp()
  const { video, playback } = state
  const rafRef = useRef(null)
  const lastTimestampRef = useRef(null)
  const shiftStepRef = useRef(1)
  const shiftStepTimerRef = useRef(null)

  // Advance frame by delta, clamp to valid range
  const seekFrame = useCallback((delta) => {
    dispatch({ type: 'SET_FRAME', payload: Math.max(0, Math.min(video.totalFrames - 1, playback.currentFrame + delta)) })
  }, [dispatch, playback.currentFrame, video.totalFrames])

  // RAF playback loop
  const tick = useCallback((timestamp) => {
    if (!lastTimestampRef.current) lastTimestampRef.current = timestamp
    const elapsed = timestamp - lastTimestampRef.current
    const frameDuration = 1000 / (video.fps * playback.playbackSpeed)

    if (elapsed >= frameDuration) {
      lastTimestampRef.current = timestamp
      dispatch(prev => {
        const next = prev.playback.currentFrame + 1
        if (next >= prev.video.totalFrames) {
          return { type: 'SET_PLAYING', payload: false }
        }
        return { type: 'SET_FRAME', payload: next }
      })
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [video.fps, playback.playbackSpeed, dispatch])

  // Start/stop RAF
  useEffect(() => {
    if (playback.isPlaying) {
      lastTimestampRef.current = null
      rafRef.current = requestAnimationFrame(tick)
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [playback.isPlaying, tick])

  // Sync video element to current frame
  useEffect(() => {
    const vid = videoRef?.current
    if (!vid || !video.fps) return
    const targetTime = playback.currentFrame / video.fps
    // Only seek when paused (avoid fighting with natural playback)
    if (!playback.isPlaying && Math.abs(vid.currentTime - targetTime) > 0.001) {
      vid.currentTime = targetTime
    }
  }, [playback.currentFrame, playback.isPlaying, video.fps, videoRef])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      // Don't steal from inputs
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return
      const { isPlaying, currentFrame, playbackSpeed } = state.playback

      if (e.code === 'Space') {
        e.preventDefault()
        if (!video.file) return
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
