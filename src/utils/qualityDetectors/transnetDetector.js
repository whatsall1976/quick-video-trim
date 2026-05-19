/**
 * TransNet detector - Detects transitions/crossfades/dissolves
 * Uses brightness analysis to find scene changes
 */

export async function transnetDetect(videoElement, frameRange, threshold) {
  // frameRange = [startFrame, endFrame]
  // threshold = percentage threshold (0-100, where lower = more sensitive)

  try {
    if (!videoElement || !videoElement.videoWidth) {
      return {
        rejectedRanges: [],
        summary: { enabled: true, status: 'ok', message: 'Ready', count: 0 }
      }
    }

    const [startFrame, endFrame] = frameRange
    const fps = videoElement.playbackRate ? 30 : 30 // Fallback to 30 fps
    const rejectedRanges = []
    const sensitivity = (100 - threshold) / 100 // Higher threshold = lower sensitivity
    const brightnessDiffThreshold = sensitivity * 30 // 0-30 range

    // Create canvas for frame extraction
    const canvas = document.createElement('canvas')
    canvas.width = videoElement.videoWidth
    canvas.height = videoElement.videoHeight
    const ctx = canvas.getContext('2d')

    let lastBrightness = null
    let transitionStart = null

    // Sample every 5 frames for performance
    for (let frameNum = startFrame; frameNum <= endFrame; frameNum += 5) {
      try {
        // Seek and wait for frame
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

        // Calculate brightness (average luminance)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = imageData.data
        let brightness = 0

        for (let i = 0; i < data.length; i += 4) {
          // Y = 0.299R + 0.587G + 0.114B
          brightness += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        }
        brightness /= (canvas.width * canvas.height)

        // Detect brightness change (scene transition)
        if (lastBrightness !== null) {
          const diff = Math.abs(brightness - lastBrightness)

          if (diff > brightnessDiffThreshold) {
            // Transition detected
            if (transitionStart === null) {
              transitionStart = frameNum - 5
            }
          } else if (transitionStart !== null) {
            // Transition ended
            rejectedRanges.push({
              startFrame: Math.max(startFrame, transitionStart),
              endFrame: Math.min(endFrame, frameNum),
              score: Math.min(1, diff / 30),
              reason: 'Transition / scene change'
            })
            transitionStart = null
          }
        }

        lastBrightness = brightness
      } catch (e) {
        // Skip frames that error
        continue
      }
    }

    // Close any open transition
    if (transitionStart !== null) {
      rejectedRanges.push({
        startFrame: Math.max(startFrame, transitionStart),
        endFrame: endFrame,
        score: 0.8,
        reason: 'Transition / scene change'
      })
    }

    return {
      rejectedRanges,
      summary: {
        enabled: true,
        status: 'ok',
        message: `Found ${rejectedRanges.length} transitions`,
        count: rejectedRanges.length
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
