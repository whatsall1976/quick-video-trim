import { useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { loadModel, runDetection } from '../utils/yoloDetector'

let markerId = 1000

export function useYOLODetection(videoRef) {
  const { state, dispatch, toast } = useApp()

  const runDetectionPipeline = useCallback(async () => {
    const videoEl = videoRef?.current
    if (!videoEl || !state.video.file) { toast('No video loaded', 'warning'); return }

    dispatch({ type: 'SET_DETECTING', payload: true })
    dispatch({ type: 'SET_DETECTION_PROGRESS', payload: 0 })

    try {
      toast('Connecting to local YOLO server…', 'info', 4000)
      await loadModel()

      const results = await runDetection(
        videoEl,
        state.video,
        state.settings,
        (progress) => dispatch({ type: 'SET_DETECTION_PROGRESS', payload: Math.round(progress * 100) }),
        () => false
      )

      dispatch({ type: 'SET_DETECTION_RESULTS', payload: results })

      // Build auto-markers from all event types
      const newMarkers = []
      const addM = (frameNumber, reason, flagged = false) => {
        newMarkers.push({
          id: `auto${++markerId}`,
          frameNumber,
          autoDetected: true,
          flagged,
          reason,
          customTrmWin: null,
          customTrmIntv: null,
        })
      }

      for (const tc of results.thresholdCrossings)
        addM(tc.frameNumber, `Face ${tc.direction} (${tc.type})`)
      for (const sj of results.sizeJumps)
        addM(sj.frameNumber, `Size jump ${sj.percentChange}%`)
      for (const mv of results.movements)
        addM(mv.frameNumber, `Movement ${mv.percentDisplacement}%`)

      // Flag overlap markers
      for (const ov of results.overlaps) {
        addM(ov.frameRange[0], `Overlap ${ov.frameRange[0]}-${ov.frameRange[1]}`, true)
      }

      // Merge with existing markers (avoid duplicates by frame)
      const existingFrames = new Set(state.markers.map(m => m.frameNumber))
      const merged = [
        ...state.markers,
        ...newMarkers.filter(m => !existingFrames.has(m.frameNumber)),
      ]
      dispatch({ type: 'SET_MARKERS', payload: merged })

      const total = results.thresholdCrossings.length + results.sizeJumps.length + results.movements.length
      toast(`Detection complete. ${total} events found, ${results.overlaps.length} overlaps flagged.`, 'success', 5000)
    } catch (err) {
      console.error(err)
      toast(`Detection failed: ${err.message}`, 'error', 6000)
    } finally {
      dispatch({ type: 'SET_DETECTING', payload: false })
      dispatch({ type: 'SET_DETECTION_PROGRESS', payload: 0 })
    }
  }, [state.video, state.settings, state.markers, videoRef, dispatch, toast])

  return { runDetectionPipeline }
}
