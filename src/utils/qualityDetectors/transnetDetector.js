/**
 * TransNet detector - Detects transitions/crossfades/dissolves
 * Calls server-side scenedetect (AdaptiveDetector)
 * Uploads video segment for analysis
 */

export async function transnetDetect(videoElement, frameRange, threshold) {
  try {
    if (!videoElement || !videoElement.videoWidth) {
      return {
        rejectedRanges: [],
        summary: { enabled: true, status: 'ok', message: 'No video', count: 0 }
      }
    }

    const [startFrame, endFrame] = frameRange
    const fps = 30

    // Extract frames from video element and send to server
    const canvas = document.createElement('canvas')
    canvas.width = videoElement.videoWidth
    canvas.height = videoElement.videoHeight
    const ctx = canvas.getContext('2d')

    // Collect frames as JPEG blobs
    const frames = []
    const step = 1 // Every frame for accurate transition detection
    for (let f = startFrame; f <= endFrame; f += step) {
      videoElement.currentTime = f / fps
      await new Promise((resolve) => {
        videoElement.addEventListener('seeked', resolve, { once: true })
      })
      ctx.drawImage(videoElement, 0, 0)
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.7))
      frames.push(blob)
    }

    // Send frames to server for TransNetV2 analysis
    console.log(`[TransNet] Extracted ${frames.length} frames, sending to server (threshold=${threshold})`)
    const formData = new FormData()
    formData.append('threshold', threshold)
    formData.append('startFrame', startFrame)
    formData.append('fps', fps)
    for (let i = 0; i < frames.length; i++) {
      formData.append('frames', frames[i], `frame_${startFrame + i * step}.jpg`)
    }

    const response = await fetch('http://127.0.0.1:8765/detect-transitions-frames', {
      method: 'POST',
      body: formData
    }).catch((err) => { console.error('[TransNet] Fetch failed:', err); return null })

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
    console.log('[TransNet] Server response:', JSON.stringify(result, null, 2))

    return {
      rejectedRanges: result.rejectedRanges || [],
      summary: {
        enabled: true,
        status: result.status,
        message: result.message || `Found ${(result.rejectedRanges || []).length} transitions`,
        count: (result.rejectedRanges || []).length
      }
    }
  } catch (error) {
    return {
      rejectedRanges: [],
      summary: {
        enabled: true,
        status: 'error',
        message: error.message,
        count: 0
      }
    }
  }
}
