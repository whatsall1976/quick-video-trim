/**
 * Face Landmarker detector - Uses MediaPipe FaceLandmarker
 * Detects: yaw/pitch/roll violations, 0 faces, overlapping/similar-sized multi-faces
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

/** Compute bounding box from MediaPipe normalized landmarks (0-1) */
function landmarksBBox(landmarks) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0
  for (const lm of landmarks) {
    if (lm.x < minX) minX = lm.x
    if (lm.x > maxX) maxX = lm.x
    if (lm.y < minY) minY = lm.y
    if (lm.y > maxY) maxY = lm.y
  }
  const w = maxX - minX
  const h = maxY - minY
  return { x: minX, y: minY, w, h, area: w * h }
}

/** Compute intersection-over-smaller-area between two bounding boxes */
function bboxOverlapRatio(a, b) {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  if (x2 <= x1 || y2 <= y1) return 0
  const intersection = (x2 - x1) * (y2 - y1)
  const smallerArea = Math.min(a.area, b.area)
  return smallerArea > 0 ? intersection / smallerArea : 0
}

/**
 * Analyze multi-face results. Returns { primaryIdx, reason } or null if OK.
 * - Two faces with similar size AND overlapping bboxes → dissolve
 * - Two faces with similar size, no overlap → multiple people in frame
 * - Big face + small background face → ignore small face, return primaryIdx
 */
function analyzeMultiFace(faceLandmarks, settings) {
  const boxes = faceLandmarks.map(lm => landmarksBBox(lm))
  const sizeRatioThreshold = settings.twoFaceSizeRatio ?? 0.3
  const overlapThreshold = settings.faceOverlapRatio ?? 0.2

  // Sort by area descending - index 0 is the biggest face
  const sorted = boxes.map((b, i) => ({ ...b, idx: i })).sort((a, b) => b.area - a.area)
  const biggest = sorted[0]

  // Check each secondary face against the biggest
  for (let i = 1; i < sorted.length; i++) {
    const other = sorted[i]
    const sizeRatio = other.area / biggest.area

    if (sizeRatio < sizeRatioThreshold) {
      // Small background face - ignore it
      continue
    }

    // Similar-sized face - check overlap
    const overlap = bboxOverlapRatio(biggest, other)
    if (overlap > overlapThreshold) {
      return {
        primaryIdx: biggest.idx,
        reason: `Overlapping faces (sizeRatio=${Math.round(sizeRatio * 100)}%, overlap=${Math.round(overlap * 100)}%)`
      }
    }

    // Similar-sized, non-overlapping
    return {
      primaryIdx: biggest.idx,
      reason: `Multiple similar-sized faces (sizeRatio=${Math.round(sizeRatio * 100)}%)`
    }
  }

  // All secondary faces are small background faces - treat as single subject
  return { primaryIdx: biggest.idx, reason: null }
}

/**
 * Snapshot a single frame and return raw parameter values
 * for calibration / reverse engineering thresholds
 */
export async function snapshotFaceParams(videoElement, frameNumber) {
  const fl = await getSharedLandmarker()
  const fps = 30

  videoElement.currentTime = frameNumber / fps
  await new Promise((resolve) => {
    videoElement.addEventListener('seeked', resolve, { once: true })
  })

  const result = fl.detect(videoElement)
  const faceCount = result.faceLandmarks?.length || 0

  const snapshot = {
    frameNumber,
    faceCount,
    faces: []
  }

  for (let i = 0; i < faceCount; i++) {
    const face = { index: i }

    // Bounding box from landmarks
    const bbox = landmarksBBox(result.faceLandmarks[i])
    face.bbox = {
      x: Math.round(bbox.x * 1000) / 1000,
      y: Math.round(bbox.y * 1000) / 1000,
      w: Math.round(bbox.w * 1000) / 1000,
      h: Math.round(bbox.h * 1000) / 1000,
      area: Math.round(bbox.area * 10000) / 10000,
    }

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

  // Multi-face analysis
  if (faceCount > 1) {
    const boxes = result.faceLandmarks.map(lm => landmarksBBox(lm))
    const sorted = boxes.map((b, i) => ({ ...b, idx: i })).sort((a, b) => b.area - a.area)
    for (let i = 1; i < sorted.length; i++) {
      const sizeRatio = Math.round((sorted[i].area / sorted[0].area) * 100)
      const overlap = Math.round(bboxOverlapRatio(sorted[0], sorted[i]) * 100)
      snapshot.faces[sorted[i].idx].sizeRatioToPrimary = sizeRatio + '%'
      snapshot.faces[sorted[i].idx].overlapWithPrimary = overlap + '%'
    }
    snapshot.faces[sorted[0].idx].isPrimary = true
  }

  return snapshot
}

export async function faceLandmarkerDetect(videoElement, frameRange, settings) {
  // settings = {maxFaceYaw, maxFacePitch, maxFaceRoll, twoFaceSizeRatio, faceOverlapRatio}

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
      videoElement.currentTime = frameNum / fps

      await new Promise((resolve) => {
        const onSeeked = () => { resolve(); videoElement.removeEventListener('seeked', onSeeked) }
        videoElement.addEventListener('seeked', onSeeked, { once: true })
      })

      const result = fl.detect(videoElement)
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

      // Determine which face index to check angles on
      let primaryIdx = 0

      if (faceCount > 1) {
        const analysis = analyzeMultiFace(result.faceLandmarks, settings)
        primaryIdx = analysis.primaryIdx

        if (analysis.reason) {
          // Similar-sized or overlapping faces → flag
          rejectedRanges.push({
            startFrame: frameNum,
            endFrame: Math.min(endFrame, frameNum + 3),
            score: 0.85,
            reason: analysis.reason
          })
          continue
        }
        // Small background face(s) ignored — fall through to angle check on primary
      }

      // Check pose angles on primary face
      if (result.facialTransformationMatrixes?.[primaryIdx]) {
        const angles = matrixToAngles(result.facialTransformationMatrixes[primaryIdx])

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
