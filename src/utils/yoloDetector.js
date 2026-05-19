const DEFAULT_SERVER_URL = 'http://127.0.0.1:8765'
const serverUrl = (import.meta?.env?.VITE_YOLO_SERVER_URL || DEFAULT_SERVER_URL).replace(/\/+$/, '')

let serverReady = false
let serverModel = null

export async function loadModel() {
  if (serverReady) return { url: serverUrl, model: serverModel }
  const res = await fetch(`${serverUrl}/health`, { method: 'GET' }).catch(() => null)
  if (!res || !res.ok) throw new Error(`YOLO server not reachable at ${serverUrl}`)
  const json = await res.json().catch(() => ({}))
  if (!json.ok) throw new Error(`YOLO server error: ${json.error || 'unknown error'}`)
  serverReady = true
  serverModel = json.model || null
  return { url: serverUrl, model: serverModel }
}

async function canvasToBlob(canvas) {
  return await new Promise((res) => {
    canvas.toBlob((b) => res(b), 'image/jpeg', 0.85)
  })
}

export async function detectFrame(imageSource, { conf = 0.05 } = {}) {
  if (!serverReady) await loadModel()

  const blob = await canvasToBlob(imageSource)
  if (!blob) return []

  const form = new FormData()
  form.append('image', blob, 'frame.jpg')
  const res = await fetch(`${serverUrl}/detect?conf=${encodeURIComponent(conf)}`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(`YOLO detect failed (${res.status})`)
  const json = await res.json()
  return (json.boxes || []).map(b => ({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    confidence: b.confidence,
  }))
}

export async function runDetection(videoEl, videoMeta, settings, onProgress, getAbort) {
  const { fps, totalFrames, width, height } = videoMeta
  const { confidenceThreshold, sizeJumpThreshold, faceMovementThreshold, qualityThreshold } = settings
  const confThresh = confidenceThreshold / 100
  const qualThresh = qualityThreshold / 100
  const serverConf = Math.max(0.001, Math.min(confThresh, qualThresh, 0.25))

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
    try { detected = await detectFrame(offscreen, { conf: serverConf }) } catch { /* skip */ }
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
