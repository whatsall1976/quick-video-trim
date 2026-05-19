/**
 * Face Landmarker detector - Detects face quality issues
 * Uses histogram analysis and edge detection to evaluate face presence
 * Flags frames with:
 * - Low face sharpness (blurry faces)
 * - Dark/underexposed faces (poor lighting)
 * - Overlapping/multiple faces (poor framing)
 * - Inconsistent face detection (flickering detection)
 */

export async function faceLandmarkerDetect(videoElement, frameRange) {
  // frameRange = [startFrame, endFrame]

  try {
    if (!videoElement || !videoElement.videoWidth) {
      return {
        rejectedRanges: [],
        summary: { enabled: true, status: 'ok', message: 'Ready', count: 0 }
      }
    }

    const [startFrame, endFrame] = frameRange
    const fps = 30
    const rejectedRanges = []

    // Create canvas for frame analysis
    const canvas = document.createElement('canvas')
    canvas.width = videoElement.videoWidth
    canvas.height = videoElement.videoHeight
    const ctx = canvas.getContext('2d')

    let lastHadFace = false

    // Sample every 10 frames for performance
    for (let frameNum = startFrame; frameNum <= endFrame; frameNum += 10) {
      try {
        // Seek to frame
        videoElement.currentTime = frameNum / fps

        await new Promise((resolve) => {
          const checkReady = () => {
            if (videoElement.readyState >= 2) {
              resolve()
              videoElement.removeEventListener('seeked', checkReady)
            } else {
              setTimeout(checkReady, 10)
            }
          }
          checkReady()
        })

        // Draw frame to canvas
        ctx.drawImage(videoElement, 0, 0)

        // Get image data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = imageData.data

        // Analyze frame for face quality issues
        let brightness = 0
        let sharpness = 0
        let edgeVariance = 0
        const edgeMap = new Uint8Array((canvas.height - 2) * (canvas.width - 2))
        let edgeIdx = 0

        // First pass: brightness and edge detection
        for (let y = 1; y < canvas.height - 1; y++) {
          for (let x = 1; x < canvas.width - 1; x++) {
            const idx = (y * canvas.width + x) * 4
            const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
            brightness += gray

            // Sobel edge detection
            const left = 0.299 * data[idx - 4] + 0.587 * data[idx - 3] + 0.114 * data[idx - 2]
            const right = 0.299 * data[idx + 4] + 0.587 * data[idx + 5] + 0.114 * data[idx + 6]
            const top = 0.299 * data[idx - canvas.width * 4] + 0.587 * data[idx - canvas.width * 4 + 1] + 0.114 * data[idx - canvas.width * 4 + 2]
            const bottom = 0.299 * data[idx + canvas.width * 4] + 0.587 * data[idx + canvas.width * 4 + 1] + 0.114 * data[idx + canvas.width * 4 + 2]

            const edge = Math.sqrt(((right - left) ** 2 + (bottom - top) ** 2) / 2)
            edgeMap[edgeIdx++] = Math.min(255, edge)
            sharpness += edge
          }
        }

        brightness /= (canvas.width * canvas.height)
        sharpness /= ((canvas.height - 2) * (canvas.width - 2))

        // Calculate edge variance (detect overlapping faces via edge clustering)
        const meanEdge = sharpness
        for (let i = 0; i < edgeMap.length; i++) {
          edgeVariance += (edgeMap[i] - meanEdge) ** 2
        }
        edgeVariance = Math.sqrt(edgeVariance / edgeMap.length)

        // Detect face presence by edge density in center region
        let centerEdges = 0
        const centerY = Math.floor(canvas.height / 4)
        const centerH = Math.floor(canvas.height / 2)
        const centerX = Math.floor(canvas.width / 4)
        const centerW = Math.floor(canvas.width / 2)

        for (let y = centerY; y < centerY + centerH && y < canvas.height - 1; y++) {
          for (let x = centerX; x < centerX + centerW && x < canvas.width - 1; x++) {
            const idx = ((y - 1) * (canvas.width - 2) + (x - 1))
            if (idx < edgeMap.length && edgeMap[idx] > 20) {
              centerEdges++
            }
          }
        }

        const hasFace = centerEdges > (centerW * centerH * 0.05) // At least 5% edge pixels
        const isTooDark = brightness < 80
        const isTooBlurry = sharpness < 3
        const hasOverlap = edgeVariance > 50 && centerEdges > (centerW * centerH * 0.15) // High variance + high edges = overlapping faces
        const hasFlicker = lastHadFace !== hasFace // Face detection inconsistency

        let flagFrame = false
        let reason = ''

        if (isTooDark && isTooBlurry) {
          reason = 'Poor face quality: dark & blurry'
          flagFrame = true
        } else if (isTooDark) {
          reason = 'Poor face quality: underexposed'
          flagFrame = true
        } else if (isTooBlurry) {
          reason = 'Poor face quality: blurry'
          flagFrame = true
        } else if (hasOverlap && hasFace) {
          reason = 'Overlapping/multiple faces detected'
          flagFrame = true
        } else if (hasFlicker) {
          reason = 'Face detection inconsistent'
          flagFrame = true
        }

        if (flagFrame) {
          rejectedRanges.push({
            startFrame: Math.max(startFrame, frameNum - 5),
            endFrame: Math.min(endFrame, frameNum + 5),
            score: hasOverlap ? 0.85 : isTooDark && isTooBlurry ? 0.9 : 0.7,
            reason
          })
        }

        lastHadFace = hasFace
      } catch (e) {
        // Skip frames that error
        continue
      }
    }

    return {
      rejectedRanges,
      summary: {
        enabled: true,
        status: 'ok',
        message: `Found ${rejectedRanges.length} low-quality frames`,
        count: rejectedRanges.length
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
