/**
 * TransNet detector - Detects transitions/crossfades/dissolves
 * Uses server-side scenedetect (AdaptiveDetector) for scene change detection
 */

export async function transnetDetect(videoFile, frameRange, threshold, onProgress) {
  // frameRange = [startFrame, endFrame]
  // threshold = percentage threshold (0-100)

  try {
    const response = await fetch('http://127.0.0.1:8765/detect-transitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frameRange,
        videoFile,
        threshold
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
        message: `TransNet detection failed: ${error.message}`,
        count: 0
      }
    }
  }
}
