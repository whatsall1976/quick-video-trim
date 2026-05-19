import { useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { useMarkers } from './useMarkers'
import { transnetDetect } from '../utils/qualityDetectors/transnetDetector'
import { faceLandmarkerDetect } from '../utils/qualityDetectors/faceLandmarkerDetector'
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
            transnetDetect(state.video.file, frameRange, state.settings.transnetThreshold, (progress) =>
              dispatch({ type: 'SET_DETECTION_PROGRESS', payload: Math.round(progress * 100) })
            ).then((result) => ({
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
            faceLandmarkerDetect(
              state.video.file,
              frameRange,
              {
                maxFaceYaw: state.settings.maxFaceYaw,
                maxFacePitch: state.settings.maxFacePitch,
                maxFaceRoll: state.settings.maxFaceRoll,
              },
              (progress) => dispatch({ type: 'SET_DETECTION_PROGRESS', payload: Math.round(progress * 100) })
            ).then((result) => ({
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
            occlusionDetect(state.video.file, frameRange, state.settings.occlusionThreshold, (progress) =>
              dispatch({ type: 'SET_DETECTION_PROGRESS', payload: Math.round(progress * 100) })
            ).then((result) => ({
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

  return { runDetectionPipeline }
}
