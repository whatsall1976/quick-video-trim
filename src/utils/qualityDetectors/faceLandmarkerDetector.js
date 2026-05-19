/**
 * Face Landmarker detector - Detects face pose violations (yaw/pitch/roll)
 * Uses server-side YOLO face detector to check poses
 * Flags frames with:
 * - 0 faces between previously-detected faces (failed detection)
 * - 1 face with yaw/pitch/roll exceeding thresholds
 * - >1 faces (multi-face scenario)
 */

export async function faceLandmarkerDetect(videoFile, frameRange, settings, onProgress) {
  // frameRange = [startFrame, endFrame]
  // settings = {maxFaceYaw, maxFacePitch, maxFaceRoll}

  try {
    const response = await fetch('http://127.0.0.1:8765/detect-face-poses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frameRange,
        videoFile,
        maxFaceYaw: settings.maxFaceYaw,
        maxFacePitch: settings.maxFacePitch,
        maxFaceRoll: settings.maxFaceRoll
      })
    }).catch(() => null)

    if (!response) {
      return {
        rejectedRanges: [],
        summary: {
          enabled: true,
          status: 'missing',
          message: 'Server not reachable at http://127.0.0.1:8765',
          count: 0
        }
      }
    }

    const result = await response.json()

    if (result.status === 'error') {
      return {
        rejectedRanges: [],
        summary: {
          enabled: true,
          status: 'error',
          message: result.message,
          count: 0
        }
      }
    }

    return {
      rejectedRanges: result.rejectedRanges || [],
      summary: {
        enabled: true,
        status: result.status,
        message: result.message,
        count: (result.rejectedRanges || []).length
      }
    }
  } catch (error) {
    return {
      rejectedRanges: [],
      summary: {
        enabled: true,
        status: 'error',
        message: `Face Landmarker detection failed: ${error.message}`,
        count: 0
      }
    }
  }
}
