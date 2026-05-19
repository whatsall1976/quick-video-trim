/**
 * Range utilities - Merge adjacent/overlapping rejected ranges
 * Consolidates detection results from multiple detectors
 */

/**
 * Merge adjacent and overlapping rejected ranges with tolerance
 * @param {Array<{startFrame: number, endFrame: number, reason: string, score: number, source: string}>} allRanges - Array of rejected ranges
 * @param {number} tolerance - Frame gap below which ranges are merged (default: 5)
 * @returns {Array<{startFrame: number, endFrame: number, reason: string, score: number, source: string}>} Merged ranges
 *
 * Example:
 * Input: [{startFrame:10, endFrame:20}, {startFrame:18, endFrame:30}, {startFrame:100, endFrame:110}], tolerance=5
 * Output: [{startFrame:10, endFrame:30, reason:'merged'}, {startFrame:100, endFrame:110}]
 */
export function mergeRejectedRanges(allRanges, tolerance = 5) {
  // Handle empty input
  if (!allRanges || allRanges.length === 0) {
    return [];
  }

  // Sort by startFrame
  const sorted = [...allRanges].sort((a, b) => a.startFrame - b.startFrame);

  // Merge overlapping and adjacent ranges
  const merged = [];
  let current = {
    startFrame: sorted[0].startFrame,
    endFrame: sorted[0].endFrame,
    reason: sorted[0].reason,
    score: sorted[0].score,
    source: sorted[0].source,
    sourceCount: 1
  };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];

    // Check if ranges should be merged (overlapping or within tolerance)
    if (next.startFrame <= current.endFrame + tolerance) {
      // Merge: extend end frame, update reason to reflect merge
      current.endFrame = Math.max(current.endFrame, next.endFrame);
      current.reason = 'merged';
      current.score = Math.max(current.score, next.score);
      current.sourceCount++;
    } else {
      // No merge needed: push current and start new
      merged.push(current);
      current = {
        startFrame: next.startFrame,
        endFrame: next.endFrame,
        reason: next.reason,
        score: next.score,
        source: next.source,
        sourceCount: 1
      };
    }
  }

  // Don't forget the last range
  merged.push(current);

  return merged;
}

/**
 * Filter ranges by score threshold
 * @param {Array<{startFrame: number, endFrame: number, score: number}>} ranges - Ranges to filter
 * @param {number} scoreThreshold - Minimum score to keep (0-1)
 * @returns {Array<{startFrame: number, endFrame: number, score: number}>} Filtered ranges
 */
export function filterRangesByScore(ranges, scoreThreshold = 0.5) {
  return ranges.filter(range => range.score >= scoreThreshold);
}

/**
 * Get total frame coverage from ranges
 * @param {Array<{startFrame: number, endFrame: number}>} ranges - Ranges to analyze
 * @returns {number} Total number of frames covered
 */
export function getTotalCoverage(ranges) {
  return ranges.reduce((total, range) => {
    return total + (range.endFrame - range.startFrame);
  }, 0);
}
