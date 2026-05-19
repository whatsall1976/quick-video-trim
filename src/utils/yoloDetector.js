import * as tf from '@tensorflow/tfjs'

let model = null

export async function loadModel() {
  if (model) return model
  const blazeface = await import('@tensorflow-models/blazeface')
  model = await blazeface.load()
  return model
}

export async function detectFrame(imageSource) {
  if (!model) throw new Error('Model not loaded')
  const predictions = await model.estimateFaces(imageSource, false)
  return predictions.map(p => {
    const [x1, y1] = p.topLeft
    const [x2, y2] = p.bottomRight
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1, confidence: p.probability?.[0] ?? 1 }
  })
}

export async function runDetection(videoEl, videoMeta, settings, onProgress, getAbort) {
  const { fps, totalFrames, width, height } = videoMeta
  const { confidenceThreshold, sizeJumpThreshold, faceMovementThreshold, qualityThreshold } = settings
  const confThresh = confidenceThreshold / 100
  const qualThresh = qualityThreshold / 100

  const offscreen = document.createElement('canvas')
  offscreen.width = width || 640
  offscreen.height = height || 360
  const ctx = offscreen.getContext('2d')

  const faces = []
  const thresholdCrossings = []
  const sizeJumps = []
  const movements = []
  let prevArea = null, prevCx = null, prevCy = null, prevW = null
  let wasAbove = null, wasAboveQual = null
  const sampleStep = Math.max(1, Math.floor(fps / 15))

  for (let f = 0; f < totalFrames; f += sampleStep) {
    if (getAbort?.()) break
    onProgress?.(f / totalFrames)
    videoEl.currentTime = f / fps
    await new Promise(res => { videoEl.onseeked = res })
    ctx.drawImage(videoEl, 0, 0, offscreen.width, offscreen.height)

    let detected = []
    try { detected = await detectFrame(offscreen) } catch { /* skip */ }
    const best = detected.sort((a, b) => b.confidence - a.confidence)[0] ?? null
    faces.push({ frameNumber: f, face: best, allFaces: detected })

    const conf = best?.confidence ?? 0
    const isAbove = conf > confThresh
    const isAboveQual = conf > qualThresh

    if (wasAbove !== null && isAbove !== wasAbove)
      thresholdCrossings.push({ type: 'onoff', direction: isAbove ? 'appear' : 'disappear', frameNumber: f })
    wasAbove = isAbove

    if (wasAboveQual !== null && isAboveQual !== wasAboveQual)
      thresholdCrossings.push({ type: 'confidence', direction: isAboveQual ? 'recovery' : 'drop', frameNumber: f })
    wasAboveQual = isAboveQual

    if (best) {
      const area = best.width * best.height
      const cx = best.x + best.width / 2
      const cy = best.y + best.height / 2
      if (prevArea !== null) {
        const pct = Math.abs(area - prevArea) / prevArea * 100
        if (pct > sizeJumpThreshold) sizeJumps.push({ frameNumber: f, percentChange: Math.round(pct) })
      }
      prevArea = area
      if (prevCx !== null && prevW) {
        const disp = Math.sqrt((cx - prevCx) ** 2 + (cy - prevCy) ** 2)
        const pct = (disp / prevW) * 100
        if (pct > faceMovementThreshold) movements.push({ frameNumber: f, percentDisplacement: Math.round(pct) })
      }
      prevCx = cx; prevCy = cy; prevW = best.width
    } else { prevArea = null; prevCx = null; prevCy = null; prevW = null }
  }

  const overlaps = []
  let inOverlap = null
  for (const { frameNumber, allFaces } of faces) {
    if (allFaces.length > 1) {
      if (!inOverlap) inOverlap = { start: frameNumber, frames: [] }
      inOverlap.frames.push(frameNumber)
    } else if (inOverlap) {
      overlaps.push({ frameRange: [inOverlap.start, frameNumber], frames: inOverlap.frames })
      inOverlap = null
    }
  }
  if (inOverlap) overlaps.push({ frameRange: [inOverlap.start, totalFrames - 1], frames: inOverlap.frames })
  onProgress?.(1)

  return {
    faces: faces.filter(f => f.face).map(({ frameNumber, face }) => ({ frameNumber, ...face })),
    overlaps, thresholdCrossings, sizeJumps, movements,
  }
}
