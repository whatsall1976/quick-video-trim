/**
 * Face Landmarker detector - Uses MediaPipe FaceLandmarker
 * Detects: yaw/pitch/roll violations, 0 faces, >1 faces
 */
import { getSharedLandmarker } from './sharedLandmarker'

function matrixToAngles(matrix) {
  // 4x4 transformation matrix -> yaw/pitch/roll in degrees
  const m = matrix.data
  const pitch = Math.asin(-m[6]) * (180 / Math.PI)
  const yaw = Math.atan2(m[2], m[10]) * (180 / Math.PI)
  const roll = Math.atan2(m[4], m[5]) * (180 / Math.PI)
  return { yaw, pitch, roll }
}

/**
 * Snapshot a single frame and return raw parameter values
 * for calibration / reverse engineering thresholds
 */
export async function snapshotFaceParams(videoElement, frameNumber) {
  const fl = await getSharedLandmarker()
  const fps = 30
  const timeMs = (frameNumber / fps) * 1000

  videoElement.currentTime = frameNumber / fps
  await new Promise((resolve) => {
    videoElement.addEventListener('seeked', resolve, { once: true })
  })

  const result = fl.detectForVideo(videoElement, timeMs)
  const faceCount = result.faceLandmarks?.length || 0

  const snapshot = {
    frameNumber,
    faceCount,
    faces: []
  }

  for (let i = 0; i < faceCount; i++) {
    const face = { index: i }

    // Pose angles
    if (result.facialTransformationMatrixes?.[i]) {
      const angles = matrixToAngles(result.facialTransformationMatrixes[i])
      face.yaw = Math.round(angles.yaw * 10) / 10
      face.pitch = Math.round(angles.pitch * 10) / 10
      face.roll = Math.round(angles.roll * 10) / 10
    }

    // Landmark visibility for occlusion
    const lm = result.faceLandmarks[i]
    const REGIONS = {
      leftEye: [33, 133, 160, 159, 158, 144, 145, 153],
      rightEye: [362, 263, 387, 386, 385, 373, 374, 380],
      nose: [1, 2, 98, 327, 4, 5, 195],
      lips: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]
    }

    face.visibility = {}
    for (const [region, indices] of Object.entries(REGIONS)) {
      let total = 0
      let count = 0
      for (const idx of indices) {
        if (lm[idx]) {
          total += (lm[idx].visibility ?? 1.0)
          count++
        }
      }
      face.visibility[region] = count > 0 ? Math.round((total / count) * 100) / 100 : 0
    }

    snapshot.faces.push(face)
  }

  return snapshot
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

    const fl = await getSharedLandmarker()
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
