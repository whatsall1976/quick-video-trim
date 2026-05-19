const DEFAULT_SERVER_URL = 'http://127.0.0.1:8765'
const serverUrl = (import.meta?.env?.VITE_YOLO_SERVER_URL || DEFAULT_SERVER_URL).replace(/\/+$/, '')
const OVERLAP_NMS_IOU = 0.85
const DUPLICATE_IOU_THRESHOLD = 0.88
const DUPLICATE_CENTER_RATIO = 0.18
const OVERLAP_MIN_IOU = 0.08
const OVERLAP_MIN_SMALLER_AREA = 0.16

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

function boxMetrics(a, b) {
  const ax2 = a.x + a.width
  const ay2 = a.y + a.height
  const bx2 = b.x + b.width
  const by2 = b.y + b.height
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(ax2, bx2)
  const y2 = Math.min(ay2, by2)
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const areaA = Math.max(0, a.width) * Math.max(0, a.height)
  const areaB = Math.max(0, b.width) * Math.max(0, b.height)
  const union = areaA + areaB - intersection
  const smallerArea = Math.min(areaA, areaB)

  return {
    iou: union > 0 ? intersection / union : 0,
    smallerOverlap: smallerArea > 0 ? intersection / smallerArea : 0,
  }
}

function centerDistance(a, b) {
  const ax = a.x + a.width / 2
  const ay = a.y + a.height / 2
  const bx = b.x + b.width / 2
  const by = b.y + b.height / 2
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)
}

function isDuplicateFace(a, b) {
  const { iou, smallerOverlap } = boxMetrics(a, b)
  const centerLimit = Math.min(a.width, a.height, b.width, b.height) * DUPLICATE_CENTER_RATIO
  return iou >= DUPLICATE_IOU_THRESHOLD || ((iou >= 0.65 || smallerOverlap >= 0.8) && centerDistance(a, b) <= centerLimit)
}

function dedupeFaceBoxes(boxes) {
  const kept = []
  for (const box of boxes) {
    if (!kept.some(existing => isDuplicateFace(box, existing))) kept.push(box)
  }
  return kept
}

function findOverlappingFacePair(boxes) {
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const metrics = boxMetrics(boxes[i], boxes[j])
      if (metrics.iou >= OVERLAP_MIN_IOU || metrics.smallerOverlap >= OVERLAP_MIN_SMALLER_AREA) {
        return { boxes: [boxes[i], boxes[j]], ...metrics }
      }
    }
  }
  return null
}

function buildOverlapRanges(frames, sampleStep, totalFrames) {
  const overlaps = []
  let inOverlap = null

  const closeOverlap = () => {
    if (!inOverlap) return
    overlaps.push({
      frameRange: [inOverlap.start, Math.min(totalFrames - 1, inOverlap.last + sampleStep - 1)],
      frames: inOverlap.frames,
    })
    inOverlap = null
  }

  for (const { frameNumber, overlap } of frames) {
    if (overlap) {
      if (!inOverlap) inOverlap = { start: frameNumber, last: frameNumber, frames: [] }
      inOverlap.last = frameNumber
      inOverlap.frames.push(frameNumber)
    } else {
      closeOverlap()
    }
  }
  closeOverlap()

  return overlaps
}

export async function detectFrame(imageSource, { conf = 0.05, iou = null } = {}) {
  if (!serverReady) await loadModel()

  const blob = await canvasToBlob(imageSource)
  if (!blob) return []

  const form = new FormData()
  form.append('image', blob, 'frame.jpg')
  const url = new URL(`${serverUrl}/detect`)
  url.searchParams.set('conf', conf)
  if (Number.isFinite(iou)) url.searchParams.set('iou', iou)
  const res = await fetch(url.toString(), {
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
    try { detected = await detectFrame(offscreen, { conf: serverConf, iou: OVERLAP_NMS_IOU }) } catch { /* skip */ }
    const sortedDetected = detected.sort((a, b) => b.confidence - a.confidence)
    const best = sortedDetected[0] ?? null
    const overlapFaces = dedupeFaceBoxes(sortedDetected)
    faces.push({
      frameNumber: f,
      face: best,
      allFaces: sortedDetected,
      overlap: findOverlappingFacePair(overlapFaces),
    })

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

  const overlaps = buildOverlapRanges(faces, sampleStep, totalFrames)
  onProgress?.(1)

  return {
    faces: faces.filter(f => f.face).map(({ frameNumber, face }) => ({ frameNumber, ...face })),
    overlaps, thresholdCrossings, sizeJumps, movements,
  }
}
