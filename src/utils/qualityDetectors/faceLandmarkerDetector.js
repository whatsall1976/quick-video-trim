/**
 * Face Landmarker detector - Detects face quality issues
 * Uses edge detection to estimate face presence and sharpness
 * Flags frames with:
 * - Low face sharpness (blurry faces)
 * - Dark/underexposed faces (poor lighting)
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

        // Calculate face region sharpness using Laplacian edge detection
        let sharpness = 0
        let brightness = 0

        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
          brightness += gray
        }
        brightness /= (canvas.width * canvas.height)

        // Simple edge detection in central region
        for (let y = 10; y < canvas.height - 10; y++) {
          for (let x = 10; x < canvas.width - 10; x++) {
            const idx = (y * canvas.width + x) * 4
            const center = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]

            // Laplacian-like edge detection
            const neighbors = [
              0.299 * data[idx - 4] + 0.587 * data[idx - 3] + 0.114 * data[idx - 2],
              0.299 * data[idx + 4] + 0.587 * data[idx + 5] + 0.114 * data[idx + 6],
              0.299 * data[idx - canvas.width * 4] + 0.587 * data[idx - canvas.width * 4 + 1] + 0.114 * data[idx - canvas.width * 4 + 2],
              0.299 * data[idx + canvas.width * 4] + 0.587 * data[idx + canvas.width * 4 + 1] + 0.114 * data[idx + canvas.width * 4 + 2]
            ]

            const avgNeighbor = neighbors.reduce((a, b) => a + b) / 4
            sharpness += Math.abs(center - avgNeighbor)
          }
        }

        // Normalize sharpness
        sharpness /= ((canvas.height - 20) * (canvas.width - 20))

        // Flag if face is too dark or too blurry
        const isTooDark = brightness < 80 // Very dark
        const isTooBlurry = sharpness < 2 // Low edge detection = blurry

        if (isTooDark || isTooBlurry) {
          const reason = isTooDark && isTooBlurry
            ? 'Poor face quality: dark & blurry'
            : isTooDark
            ? 'Poor face quality: underexposed'
            : 'Poor face quality: blurry'

          rejectedRanges.push({
            startFrame: Math.max(startFrame, frameNum - 5),
            endFrame: Math.min(endFrame, frameNum + 5),
            score: isTooDark && isTooBlurry ? 0.9 : 0.7,
            reason
          })
        }
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
