/**
 * Face Landmarker detector - Uses MediaPipe FaceLandmarker
 * Detects: yaw/pitch/roll violations, 0 faces, >1 faces
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
    numFaces: 3,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true
  })
  return landmarker
}

function matrixToAngles(matrix) {
  // 4x4 transformation matrix -> yaw/pitch/roll in degrees
  const m = matrix.data
  const pitch = Math.asin(-m[6]) * (180 / Math.PI)
  const yaw = Math.atan2(m[2], m[10]) * (180 / Math.PI)
  const roll = Math.atan2(m[4], m[5]) * (180 / Math.PI)
  return { yaw, pitch, roll }
}

export async function faceLandmarkerDetect(videoElement, frameRange, settings) {
  // settings = {maxFaceYaw, maxFacePitch, maxFaceRoll}

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
    const maxYaw = settings.maxFaceYaw || 30
    const maxPitch = settings.maxFacePitch || 20
    const maxRoll = settings.maxFaceRoll || 20

    // Sample every 3 frames for accuracy
    for (let frameNum = startFrame; frameNum <= endFrame; frameNum += 3) {
      const timeMs = (frameNum / fps) * 1000
      videoElement.currentTime = frameNum / fps

      await new Promise((resolve) => {
        const onSeeked = () => { resolve(); videoElement.removeEventListener('seeked', onSeeked) }
        videoElement.addEventListener('seeked', onSeeked, { once: true })
      })

      const result = fl.detectForVideo(videoElement, timeMs)
      const faceCount = result.faceLandmarks?.length || 0

      if (faceCount === 0) {
        rejectedRanges.push({
          startFrame: frameNum,
          endFrame: Math.min(endFrame, frameNum + 3),
          score: 0.9,
          reason: 'No face detected'
        })
        continue
      }

      if (faceCount > 1) {
        rejectedRanges.push({
          startFrame: frameNum,
          endFrame: Math.min(endFrame, frameNum + 3),
          score: 0.85,
          reason: `Multiple faces detected (${faceCount})`
        })
        continue
      }

      // Single face - check pose angles from transformation matrix
      if (result.facialTransformationMatrixes?.length > 0) {
        const angles = matrixToAngles(result.facialTransformationMatrixes[0])

        const yawExceeded = Math.abs(angles.yaw) > maxYaw
        const pitchExceeded = Math.abs(angles.pitch) > maxPitch
        const rollExceeded = Math.abs(angles.roll) > maxRoll

        if (yawExceeded || pitchExceeded || rollExceeded) {
          const violations = []
          if (yawExceeded) violations.push(`yaw ${Math.round(angles.yaw)}°`)
          if (pitchExceeded) violations.push(`pitch ${Math.round(angles.pitch)}°`)
          if (rollExceeded) violations.push(`roll ${Math.round(angles.roll)}°`)

          rejectedRanges.push({
            startFrame: frameNum,
            endFrame: Math.min(endFrame, frameNum + 3),
            score: 0.8,
            reason: `Extreme angle: ${violations.join(', ')}`
          })
        }
      }
    }

    return {
      rejectedRanges,
      summary: {
        enabled: true,
        status: 'ok',
        message: `Found ${rejectedRanges.length} face issues`,
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
