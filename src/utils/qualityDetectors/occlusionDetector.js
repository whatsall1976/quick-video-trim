/**
 * Occlusion detector - Detects eyes/nose/lips blockage
 * Currently returns placeholder status as occlusion model selection is pending
 */

export async function occlusionDetect(videoFile, frameRange, threshold, onProgress) {
  // frameRange = [startFrame, endFrame]
  // threshold = occlusion percentage threshold (0-100)
  // onProgress = callback for progress updates (optional)

  try {
    // Placeholder implementation - occlusion model selection pending
    return {
      rejectedRanges: [],
      summary: {
        enabled: true,
        status: 'missing',
        message: 'Occlusion detector not available',
        count: 0
      }
    };
  } catch (error) {
    return {
      rejectedRanges: [],
      summary: {
        enabled: true,
        status: 'error',
        message: `Occlusion detection failed: ${error.message}`,
        count: 0
      }
    };
  }
}
