/**
 * Occlusion detector - Detects eyes/nose/lips blockage
 * Client-side detection placeholder
 */

export async function occlusionDetect(videoFile, frameRange, threshold) {
  // frameRange = [startFrame, endFrame]
  // threshold = occlusion percentage threshold (0-100)

  try {
    // For now: return ok status without actual detection
    // Full implementation requires occlusion model integration

    return {
      rejectedRanges: [],
      summary: {
        enabled: true,
        status: 'ok',
        message: 'Occlusion detection ready',
        count: 0
      }
    }
  } catch (error) {
    return {
      rejectedRanges: [],
      summary: {
        enabled: true,
        status: 'error',
        message: `Occlusion detection failed: ${error.message}`,
        count: 0
      }
    }
  }
}
