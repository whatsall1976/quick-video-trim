import { useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { useMarkers } from './useMarkers'
import { transnetDetect } from '../utils/qualityDetectors/transnetDetector'
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

      // 1. Compute frame range
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
        // 2. Read enabled detectors from settings
        const enabledDetectors = []
        if (state.settings.detectionModels.transnetv2) enabledDetectors.push('transnetv2')
        if (state.settings.detectionModels.faceLandmarker) enabledDetectors.push('faceLandmarker')
        if (state.settings.detectionModels.occlusion) enabledDetectors.push('occlusion')

        // 3. Dispatch detectors in parallel
        const detectorPromises = []

        if (state.settings.detectionModels.transnetv2) {
          detectorPromises.push(
            transnetDetect(videoEl, frameRange, state.settings.transnetThreshold).then((result) => ({
              key: 'transnetv2',
              label: 'TransNetV2',
              enabled: true,
              ...result,
            }))
          )
        } else {
          detectorPromises.push(
            Promise.resolve({
              key: 'transnetv2',
              label: 'TransNetV2',
              enabled: false,
              rejectedRanges: [],
              summary: { enabled: false, status: 'ok', count: 0 },
            })
          )
        }

        if (state.settings.detectionModels.faceLandmarker) {
          detectorPromises.push(
            faceLandmarkerDetect(videoEl, frameRange, {
              maxFaceYaw: state.settings.maxFaceYaw,
              maxFacePitch: state.settings.maxFacePitch,
              maxFaceRoll: state.settings.maxFaceRoll,
            }).then((result) => ({
              key: 'faceLandmarker',
              label: 'Face Landmarker',
              enabled: true,
              ...result,
            }))
          )
        } else {
          detectorPromises.push(
            Promise.resolve({
              key: 'faceLandmarker',
              label: 'Face Landmarker',
              enabled: false,
              rejectedRanges: [],
              summary: { enabled: false, status: 'ok', count: 0 },
            })
          )
        }

        if (state.settings.detectionModels.occlusion) {
          detectorPromises.push(
            occlusionDetect(videoEl, frameRange, state.settings.occlusionThreshold).then((result) => ({
              key: 'occlusion',
              label: 'Occlusion',
              enabled: true,
              ...result,
            }))
          )
        } else {
          detectorPromises.push(
            Promise.resolve({
              key: 'occlusion',
              label: 'Occlusion',
              enabled: false,
              rejectedRanges: [],
              summary: { enabled: false, status: 'ok', count: 0 },
            })
          )
        }

        const modelRuns = await Promise.all(detectorPromises)

        // 4. Merge rejected ranges
        const allRanges = []
        for (const run of modelRuns) {
          if (run.rejectedRanges) {
            for (const range of run.rejectedRanges) {
              allRanges.push({
                ...range,
                source: run.key,
              })
            }
          }
        }
        const mergedRejectedRanges = mergeRejectedRanges(allRanges)

        // 5. Dispatch SET_DETECTION_RESULTS
        const results = {
          frameRange,
          runMode,
          modelRuns,
          rejectedRanges: mergedRejectedRanges,
        }
        dispatch({ type: 'SET_DETECTION_RESULTS', payload: results })

        // 6. Convert rejectedRanges to flagged markers
        for (const range of mergedRejectedRanges) {
          addMarker(range.startFrame, {
            autoDetected: true,
            flagged: true,
            reason: range.reason || 'Quality issue',
            overlapStartFrame: range.startFrame,
            overlapEndFrame: range.endFrame,
          })
        }

        // 7. Toast summary
        const flaggedCount = mergedRejectedRanges.length
        const label = isTestRun ? `Test detection (frames ${frameRange[0]}-${frameRange[1]})` : 'Detection'
        toast(
          `${label} complete: ${flaggedCount} ranges flagged.`,
          'success',
          5000
        )
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

      // Face Landmarker snapshot (yaw/pitch/roll + face count)
      if (state.settings.detectionModels.faceLandmarker) {
        try {
          const snap = await snapshotFaceParams(videoEl, frameNumber)
          result.detectors.faceLandmarker = snap
        } catch (err) {
          result.detectors.faceLandmarker = { error: err.message }
        }
      }

      // Occlusion snapshot (visibility scores) - reuses face landmarker data
      if (state.settings.detectionModels.occlusion) {
        // snapshotFaceParams already includes visibility data,
        // but if faceLandmarker is disabled we still need to run it for occlusion
        if (!result.detectors.faceLandmarker || result.detectors.faceLandmarker.error) {
          try {
            const snap = await snapshotFaceParams(videoEl, frameNumber)
            result.detectors.occlusion = {
              faceCount: snap.faceCount,
              faces: snap.faces.map(f => ({
                index: f.index,
                visibility: f.visibility,
              })),
            }
          } catch (err) {
            result.detectors.occlusion = { error: err.message }
          }
        } else {
          // Extract visibility from the already-run faceLandmarker snapshot
          const snap = result.detectors.faceLandmarker
          result.detectors.occlusion = {
            faceCount: snap.faceCount,
            faces: snap.faces.map(f => ({
              index: f.index,
              visibility: f.visibility,
            })),
          }
        }
      }

      // TransNetV2 - N/A for single frame (needs frame sequence)
      if (state.settings.detectionModels.transnetv2) {
        result.detectors.transnetv2 = { note: 'TransNetV2 requires frame sequence, not applicable for single-frame snapshot' }
      }

      dispatch({ type: 'SET_SNAPSHOT_RESULT', payload: result })
      toast(`Snapshot frame ${frameNumber} complete`, 'success', 3000)
    },
    [state.video, state.playback.currentFrame, state.settings, dispatch, toast, videoRef]
  )

  return { runDetectionPipeline, snapshotCurrentFrame }
}
