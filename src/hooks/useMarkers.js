import { useEffect, useCallback } from 'react'
import { useApp } from '../context/AppContext'

let markerId = 0

export function useMarkers({ enableShortcuts = false } = {}) {
  const { state, dispatch, toast } = useApp()
  const { video, playback, selectedMarkerId } = state

  const addMarker = useCallback((frameNumber, opts = {}) => {
    if (!video.file) return
    const frame = Math.max(0, Math.min(video.totalFrames - 1, Math.round(frameNumber)))
    // Guard: duplicate frame
    if (state.markers.some(m => m.frameNumber === frame)) {
      toast('Marker already exists at this frame', 'warning')
      return
    }
    const marker = {
      id: `m${++markerId}`,
      frameNumber: frame,
      autoDetected: opts.autoDetected ?? false,
      flagged: opts.flagged ?? false,
      reason: opts.reason ?? null,
      customTrmWin: null,
      customTrmIntv: null,
    }
    dispatch({ type: 'ADD_MARKER', payload: marker })
    dispatch({ type: 'SET_SELECTED_MARKER', payload: marker.id })
    return marker
  }, [video, state.markers, dispatch, toast])

  const removeMarker = useCallback((id) => {
    dispatch({ type: 'REMOVE_MARKER', payload: id })
  }, [dispatch])

  const updateMarker = useCallback((id, changes) => {
    if (changes.frameNumber !== undefined) {
      const frame = Math.round(changes.frameNumber)
      if (frame < 0 || frame >= video.totalFrames) {
        toast('Marker position out of bounds', 'error')
        return
      }
    }
    dispatch({ type: 'UPDATE_MARKER', payload: { id, ...changes } })
  }, [dispatch, video.totalFrames, toast])

  const selectMarker = useCallback((id) => {
    dispatch({ type: 'SET_SELECTED_MARKER', payload: id })
  }, [dispatch])

  // Cmd+Shift+M to add marker at current frame
  useEffect(() => {
    if (!enableShortcuts) return
    const onKey = (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedMarkerId) {
        e.preventDefault()
        removeMarker(selectedMarkerId)
        toast('Marker deleted', 'info', 1200)
        return
      }
      // Debug: log all Shift+M attempts
      if (e.shiftKey && (e.code === 'KeyM' || e.key === 'M' || e.key === 'm')) {
        console.log('[DEBUG] Shift+M detected', { metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, code: e.code, key: e.key })
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyM') {
        e.preventDefault()
        if (!video.file) { toast('No video loaded', 'warning'); return }
        const m = addMarker(playback.currentFrame, { autoDetected: false })
        if (m) toast(`Marker added at frame ${m.frameNumber}`, 'success', 1500)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enableShortcuts, video, playback.currentFrame, addMarker, removeMarker, selectedMarkerId, toast])

  return { addMarker, removeMarker, updateMarker, selectMarker }
}
