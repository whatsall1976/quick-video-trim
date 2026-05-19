import { useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { loadModel, runDetection } from '../utils/yoloDetector'

let markerId = 1000

export function useYOLODetection(videoRef) {
  const { state, dispatch, toast } = useApp()

  const runDetectionPipeline = useCallback(async ({ mode = 'full' } = {}) => {
    const videoEl = videoRef?.current
    if (!videoEl || !state.video.file) { toast('No video loaded', 'warning'); return }
    const isTestRun = mode === 'test'
    const fps = state.video.fps || 30
    const totalFrames = state.video.totalFrames || 0
    const maxFrame = Math.max(0, totalFrames - 1)
    const testStart = Math.min(Math.max(0, Math.round(state.settings.detectionTestStartFrame ?? 0)), maxFrame)
    const defaultTestEnd = Math.min(maxFrame, testStart + Math.max(1, Math.round((state.settings.detectionTestSeconds ?? 10) * fps)) - 1)
    const testEnd = Number.isFinite(state.settings.detectionTestEndFrame)
      ? Math.min(Math.max(0, Math.round(state.settings.detectionTestEndFrame)), maxFrame)
      : defaultTestEnd

    if (isTestRun && testStart > testEnd) {
      toast('Test start frame must be before end frame', 'warning', 2200)
      return
    }

    dispatch({ type: 'SET_DETECTING', payload: true })
    dispatch({ type: 'SET_PLAYING', payload: false })
    dispatch({ type: 'SET_DETECTION_PROGRESS', payload: 0 })

    try {
      toast('Connecting to local YOLO server…', 'info', 4000)
      await loadModel()

      const results = await runDetection(
        videoEl,
        state.video,
        state.settings,
        (progress) => dispatch({ type: 'SET_DETECTION_PROGRESS', payload: Math.round(progress * 100) }),
        () => false,
        isTestRun ? { mode, startFrame: testStart, endFrame: testEnd } : { mode }
      )

      dispatch({ type: 'SET_DETECTION_RESULTS', payload: results })
      const total = results.thresholdCrossings.length + results.sizeJumps.length + results.movements.length

      const newMarkers = []
      const addM = (frameNumber, reason, flagged = false, extra = {}) => {
        newMarkers.push({
          id: `auto${++markerId}`,
          frameNumber,
          autoDetected: true,
          flagged,
          reason,
          customTrmWin: null,
          customTrmIntv: null,
          ...extra,
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
        const [startFrame, endFrame] = ov.frameRange
        addM(startFrame, `Overlap ${startFrame}-${endFrame}`, true, { overlapStartFrame: startFrame, overlapEndFrame: endFrame })
      }

      // Merge with existing markers (avoid duplicates by frame)
      const existingFrames = new Set(state.markers.map(m => m.frameNumber))
      const merged = [
        ...state.markers,
        ...newMarkers.filter(m => !existingFrames.has(m.frameNumber)),
      ]
      dispatch({ type: 'SET_MARKERS', payload: merged })

      const label = isTestRun ? `Test detection frames ${testStart}-${testEnd}` : 'Detection'
      toast(`${label} complete. ${total} events found, ${results.overlaps.length} overlaps flagged.`, 'success', 5000)
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
