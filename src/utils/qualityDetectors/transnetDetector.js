/**
 * TransNet detector - Detects transitions/crossfades/dissolves
 * Currently returns placeholder status as TransNetV2 is not yet integrated
 */

export async function transnetDetect(videoFile, frameRange, threshold, onProgress) {
  // frameRange = [startFrame, endFrame]
  // threshold = percentage threshold (0-100)
  // onProgress = callback for progress updates (optional)

  try {
    // Placeholder implementation - TransNetV2 not yet available
    return {
      rejectedRanges: [],
      summary: {
        enabled: true,
        status: 'missing',
        message: 'TransNetV2 not available',
        count: 0
      }
    };
  } catch (error) {
    return {
      rejectedRanges: [],
      summary: {
        enabled: true,
        status: 'error',
        message: `TransNet detection failed: ${error.message}`,
        count: 0
      }
    };
  }
}
