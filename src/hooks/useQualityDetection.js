import { useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { useMarkers } from './useMarkers'
import { faceLandmarkerDetect, snapshotFaceParams } from '../utils/qualityDetectors/faceLandmarkerDetector'
import { occlusionDetect } from '../utils/qualityDetectors/occlusionDetector'
import { mergeRejectedRanges } from '../utils/qualityDetectors/ranges'

export function useQualityDetection(videoRef) {
  const { state, dispatch, toast } = useApp()
  const { addMarker } = useMarkers()

  const runDetectionPipeline = useCallback(
    async (runMode = 'test') => {
      const videoEl = videoRef?.current
      if (!videoEl || !state.video.file) {
        toast('No video loaded', 'warning')
        return
      }

      const isTestRun = runMode === 'test'
      const fps = state.video.fps || 30
      const totalFrames = state.video.totalFrames || 0
      const maxFrame = Math.max(0, totalFrames - 1)

      const testStartFrame = Math.min(
        Math.max(0, Math.round(state.settings.detectionTestStartFrame ?? 0)),
        maxFrame
      )
      const defaultTestEndFrame = Math.min(
        maxFrame,
        testStartFrame + Math.max(1, Math.round((state.settings.detectionTestSeconds ?? 10) * fps)) - 1
      )
      const testEndFrame = Number.isFinite(state.settings.detectionTestEndFrame)
        ? Math.min(Math.max(0, Math.round(state.settings.detectionTestEndFrame)), maxFrame)
        : defaultTestEndFrame

      if (isTestRun && testStartFrame > testEndFrame) {
        toast('Test start frame must be before end frame', 'warning', 2200)
        return
      }

      const frameRange = isTestRun ? [testStartFrame, testEndFrame] : [0, maxFrame]

      dispatch({ type: 'SET_DETECTING', payload: true })
      dispatch({ type: 'SET_PLAYING', payload: false })
      dispatch({ type: 'SET_DETECTION_PROGRESS', payload: 0 })

      try {
        // Run detectors SEQUENTIALLY - they share the video element seek position
        const modelRuns = []

        if (state.settings.detectionModels.faceLandmarker) {
          const result = await faceLandmarkerDetect(videoEl, frameRange, {
            maxFaceYaw: state.settings.maxFaceYaw,
            maxFacePitch: state.settings.maxFacePitch,
            maxFaceRoll: state.settings.maxFaceRoll,
            twoFaceSizeRatio: (state.settings.twoFaceSizeRatio ?? 30) / 100,
            faceOverlapRatio: (state.settings.faceOverlapRatio ?? 20) / 100,
          })
          modelRuns.push({ key: 'faceLandmarker', label: 'Face Landmarker', enabled: true, ...result })
        } else {
          modelRuns.push({ key: 'faceLandmarker', label: 'Face Landmarker', enabled: false, rejectedRanges: [], summary: { enabled: false, status: 'ok', count: 0 } })
        }

        if (state.settings.detectionModels.occlusion) {
          const result = await occlusionDetect(videoEl, frameRange, state.settings.occlusionThreshold)
          modelRuns.push({ key: 'occlusion', label: 'Occlusion', enabled: true, ...result })
        } else {
          modelRuns.push({ key: 'occlusion', label: 'Occlusion', enabled: false, rejectedRanges: [], summary: { enabled: false, status: 'ok', count: 0 } })
        }

        const allRanges = []
        for (const run of modelRuns) {
          if (run.rejectedRanges) {
            for (const range of run.rejectedRanges) {
              allRanges.push({ ...range, source: run.key })
            }
          }
        }
        const mergedRejectedRanges = mergeRejectedRanges(allRanges)

        dispatch({ type: 'SET_DETECTION_RESULTS', payload: { frameRange, runMode, modelRuns, rejectedRanges: mergedRejectedRanges } })

        for (const range of mergedRejectedRanges) {
          addMarker(range.startFrame, {
            autoDetected: true,
            flagged: true,
            reason: range.reason || 'Quality issue',
            overlapStartFrame: range.startFrame,
            overlapEndFrame: range.endFrame,
          })
        }

        const flaggedCount = mergedRejectedRanges.length
        const label = isTestRun ? `Test detection (frames ${frameRange[0]}-${frameRange[1]})` : 'Detection'
        toast(`${label} complete: ${flaggedCount} ranges flagged.`, 'success', 5000)
      } catch (err) {
        console.error('[useQualityDetection] Error:', err)
        toast(`Detection failed: ${err.message}`, 'error', 6000)
      } finally {
        dispatch({ type: 'SET_DETECTING', payload: false })
        dispatch({ type: 'SET_DETECTION_PROGRESS', payload: 0 })
      }
    },
    [state.video, state.settings, dispatch, toast, addMarker, videoRef]
  )

  const snapshotCurrentFrame = useCallback(
    async () => {
      const videoEl = videoRef?.current
      if (!videoEl || !videoEl.videoWidth) {
        toast('No video loaded', 'warning')
        return
      }

      const frameNumber = state.playback.currentFrame
      const result = { frameNumber, detectors: {} }

      if (state.settings.detectionModels.faceLandmarker) {
        try {
          result.detectors.faceLandmarker = await snapshotFaceParams(videoEl, frameNumber)
        } catch (err) {
          result.detectors.faceLandmarker = { error: err.message }
        }
      }

      if (state.settings.detectionModels.occlusion) {
        if (!result.detectors.faceLandmarker || result.detectors.faceLandmarker.error) {
          try {
            const snap = await snapshotFaceParams(videoEl, frameNumber)
            result.detectors.occlusion = {
              faceCount: snap.faceCount,
              faces: snap.faces.map(f => ({ index: f.index, visibility: f.visibility })),
            }
          } catch (err) {
            result.detectors.occlusion = { error: err.message }
          }
        } else {
          const snap = result.detectors.faceLandmarker
          result.detectors.occlusion = {
            faceCount: snap.faceCount,
            faces: snap.faces.map(f => ({ index: f.index, visibility: f.visibility })),
          }
        }
      }

      dispatch({ type: 'SET_SNAPSHOT_RESULT', payload: result })
      toast(`Snapshot frame ${frameNumber} complete`, 'success', 3000)
    },
    [state.video, state.playback.currentFrame, state.settings, dispatch, toast, videoRef]
  )

  return { runDetectionPipeline, snapshotCurrentFrame }
}
