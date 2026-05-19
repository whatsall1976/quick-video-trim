/**
 * Dissolve/crossfade detector
 *
 * Uses the linear blend reconstruction test:
 * During a dissolve from scene A to B, frame(t) ≈ α·frame(t-d) + (1-α)·frame(t+d)
 * We find the best α, compute reconstruction error. Low error = dissolve.
 * Normal single-shot motion does NOT create linear blending, so few false positives.
 *
 * All client-side, no server needed.
 */

/**
 * Grab a downscaled frame from the video element as ImageData
 */
async function grabFrame(videoElement, frameNumber, fps, canvas, ctx, w, h) {
  videoElement.currentTime = frameNumber / fps
  await new Promise((resolve) => {
    videoElement.addEventListener('seeked', resolve, { once: true })
  })
  ctx.drawImage(videoElement, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/**
 * Compute how well midFrame can be reconstructed as a blend of frameA and frameB.
 * Returns a score 0-1 where lower = better reconstruction = more likely dissolve.
 */
function blendReconstructionError(frameA, frameB, midFrame) {
  const a = frameA.data
  const b = frameB.data
  const m = midFrame.data
  const n = a.length

  // Find optimal alpha by least-squares:
  // mid ≈ (1-α)·a + α·b = a + α·(b - a)
  // minimize Σ (m[i] - a[i] - α·(b[i] - a[i]))²
  // d/dα = 0 → α = Σ (m[i]-a[i])·(b[i]-a[i]) / Σ (b[i]-a[i])²
  let num = 0
  let den = 0
  for (let i = 0; i < n; i += 4) { // skip alpha channel
    for (let c = 0; c < 3; c++) {
      const diff_ba = b[i + c] - a[i + c]
      const diff_ma = m[i + c] - a[i + c]
      num += diff_ma * diff_ba
      den += diff_ba * diff_ba
    }
  }

  // If frameA ≈ frameB (no scene change), den is tiny → not a dissolve
  if (den < 1000) return 1.0

  const alpha = Math.max(0, Math.min(1, num / den))

  // Compute reconstruction error with optimal alpha
  let totalErr = 0
  let pixelCount = 0
  for (let i = 0; i < n; i += 4) {
    for (let c = 0; c < 3; c++) {
      const reconstructed = a[i + c] + alpha * (b[i + c] - a[i + c])
      const err = m[i + c] - reconstructed
      totalErr += err * err
      pixelCount++
    }
  }

  // Normalized RMSE (0-255 range)
  const rmse = Math.sqrt(totalErr / pixelCount)
  // Normalize to 0-1 (255 = max possible error)
  return rmse / 255
}

/**
 * Snapshot: check if current frame is in a dissolve
 */
export async function snapshotDissolve(videoElement, frameNumber, fps, totalFrames) {
  const d = Math.round(fps * 0.5) // half-second gap
  const prevFrame = Math.max(0, frameNumber - d)
  const nextFrame = Math.min(totalFrames - 1, frameNumber + d)

  if (nextFrame - prevFrame < d) {
    return { isDissolve: false, error: 1.0, alpha: 0, note: 'Too close to video boundary' }
  }

  // Downscale for speed
  const w = 160
  const h = 90
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')

  const fA = await grabFrame(videoElement, prevFrame, fps, canvas, ctx, w, h)
  const fMid = await grabFrame(videoElement, frameNumber, fps, canvas, ctx, w, h)
  const fB = await grabFrame(videoElement, nextFrame, fps, canvas, ctx, w, h)

  const reconError = blendReconstructionError(fA, fB, fMid)

  // Also compute direct difference between A and B to confirm scene change
  let diffAB = 0
  const a = fA.data, b = fB.data
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d2 = a[i + c] - b[i + c]
      diffAB += d2 * d2
    }
  }
  const rmseAB = Math.sqrt(diffAB / (a.length * 3 / 4)) / 255

  return {
    reconError: Math.round(reconError * 1000) / 1000,
    sceneChange: Math.round(rmseAB * 1000) / 1000,
    isDissolve: reconError < 0.06 && rmseAB > 0.08,
    frameRange: [prevFrame, nextFrame],
  }
}

/**
 * Full detection: scan frame range for dissolve zones
 */
export async function dissolveDetect(videoElement, frameRange, threshold) {
  try {
    if (!videoElement || !videoElement.videoWidth) {
      return {
        rejectedRanges: [],
        summary: { enabled: true, status: 'ok', message: 'No video', count: 0 }
      }
    }

    const [startFrame, endFrame] = frameRange
    const fps = 30
    const d = Math.round(fps * 0.5) // half-second gap for blend test
    const sampleStep = 3 // check every 3 frames

    // Downscale for speed
    const w = 160
    const h = 90
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')

    // Pre-grab frames in a sliding window approach
    // For each frame t, we need frames at t-d, t, t+d
    const rejectedRanges = []
    const dissolveThreshold = (threshold || 50) / 1000 // 50 → 0.05 reconError
    const sceneChangeMin = 0.08 // A and B must be different enough

    // Cache grabbed frames to avoid re-seeking
    const frameCache = new Map()

    async function getFrame(fn) {
      if (frameCache.has(fn)) return frameCache.get(fn)
      const frame = await grabFrame(videoElement, fn, fps, canvas, ctx, w, h)
      frameCache.set(fn, frame)
      // Keep cache bounded
      if (frameCache.size > 50) {
        const oldest = frameCache.keys().next().value
        frameCache.delete(oldest)
      }
      return frame
    }

    for (let t = startFrame + d; t <= endFrame - d; t += sampleStep) {
      const fA = await getFrame(t - d)
      const fMid = await getFrame(t)
      const fB = await getFrame(t + d)

      const reconError = blendReconstructionError(fA, fB, fMid)

      // Check that A and B are actually different scenes
      let diffAB = 0
      const a = fA.data, b = fB.data
      for (let i = 0; i < a.length; i += 4) {
        for (let c2 = 0; c2 < 3; c2++) {
          const dd = a[i + c2] - b[i + c2]
          diffAB += dd * dd
        }
      }
      const rmseAB = Math.sqrt(diffAB / (a.length * 3 / 4)) / 255

      if (reconError < dissolveThreshold && rmseAB > sceneChangeMin) {
        rejectedRanges.push({
          startFrame: t,
          endFrame: Math.min(endFrame, t + sampleStep),
          score: 1 - reconError, // higher = more confident
          reason: `Dissolve (reconErr=${reconError.toFixed(3)}, sceneΔ=${rmseAB.toFixed(3)})`,
        })
      }
    }

    return {
      rejectedRanges,
      summary: {
        enabled: true,
        status: 'ok',
        message: `Found ${rejectedRanges.length} dissolve frames`,
        count: rejectedRanges.length,
      }
    }
  } catch (error) {
    return {
      rejectedRanges: [],
      summary: {
        enabled: true,
        status: 'error',
        message: error.message,
        count: 0,
      }
    }
  }
}
