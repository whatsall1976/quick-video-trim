/**
 * Occlusion detector - Detects eyes/nose/lips blockage
 * Uses MediaPipe FaceLandmarker visibility scores
 */
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

let landmarker = null

async function getLandmarker() {
  if (landmarker) return landmarker
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
  )
  landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: '/models/face_landmarker.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false
  })
  return landmarker
}

// MediaPipe Face Landmarker landmark indices for key regions
const LANDMARKS = {
  leftEye: [33, 133, 160, 159, 158, 144, 145, 153],
  rightEye: [362, 263, 387, 386, 385, 373, 374, 380],
  nose: [1, 2, 98, 327, 4, 5, 195],
  lips: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]
}

function regionVisibility(landmarks, indices) {
  // Average visibility of landmark region
  // Lower visibility = likely occluded
  let totalVis = 0
  let count = 0
  for (const idx of indices) {
    if (landmarks[idx]) {
      // MediaPipe landmarks have x, y, z, visibility
      totalVis += (landmarks[idx].visibility ?? 1.0)
      count++
    }
  }
  return count > 0 ? totalVis / count : 0
}

export async function occlusionDetect(videoElement, frameRange, threshold) {
  // threshold = occlusion percentage threshold (0-100)
  // Higher threshold = more tolerant of occlusion

  try {
    if (!videoElement || !videoElement.videoWidth) {
      return {
        rejectedRanges: [],
        summary: { enabled: true, status: 'ok', message: 'No video', count: 0 }
      }
    }

    const fl = await getLandmarker()
    const [startFrame, endFrame] = frameRange
    const fps = 30
    const rejectedRanges = []
    const visThreshold = (threshold || 50) / 100 // Convert to 0-1

    // Sample every 5 frames
    for (let frameNum = startFrame; frameNum <= endFrame; frameNum += 5) {
      const timeMs = (frameNum / fps) * 1000
      videoElement.currentTime = frameNum / fps

      await new Promise((resolve) => {
        const onSeeked = () => { resolve(); videoElement.removeEventListener('seeked', onSeeked) }
        videoElement.addEventListener('seeked', onSeeked, { once: true })
      })

      const result = fl.detectForVideo(videoElement, timeMs)
      if (!result.faceLandmarks?.length) continue

      const landmarks = result.faceLandmarks[0]

      // Check visibility of each key region
      const leftEyeVis = regionVisibility(landmarks, LANDMARKS.leftEye)
      const rightEyeVis = regionVisibility(landmarks, LANDMARKS.rightEye)
      const noseVis = regionVisibility(landmarks, LANDMARKS.nose)
      const lipsVis = regionVisibility(landmarks, LANDMARKS.lips)

      const occluded = []
      if (leftEyeVis < visThreshold) occluded.push('left eye')
      if (rightEyeVis < visThreshold) occluded.push('right eye')
      if (noseVis < visThreshold) occluded.push('nose')
      if (lipsVis < visThreshold) occluded.push('lips')

      if (occluded.length > 0) {
        rejectedRanges.push({
          startFrame: frameNum,
          endFrame: Math.min(endFrame, frameNum + 5),
          score: 0.85,
          reason: `Occluded: ${occluded.join(', ')}`
        })
      }
    }

    return {
      rejectedRanges,
      summary: {
        enabled: true,
        status: 'ok',
        message: `Found ${rejectedRanges.length} occlusion issues`,
        count: rejectedRanges.length
      }
    }
  } catch (error) {
    return {
      rejectedRanges: [],
      summary: {
        enabled: true,
        status: 'error',
        message: error.message,
        count: 0
      }
    }
  }
}
