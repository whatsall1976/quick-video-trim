const DEFAULT_SERVER_URL = 'http://127.0.0.1:8765'
const serverUrl = (import.meta?.env?.VITE_YOLO_SERVER_URL || DEFAULT_SERVER_URL).replace(/\/+$/, '')
const DEFAULT_OVERLAP_NMS_IOU = 0.55
const DUPLICATE_IOU_THRESHOLD = 0.42
const DUPLICATE_CENTER_RATIO = 0.45
const DUPLICATE_CONTAINMENT_THRESHOLD = 0.65
const DEFAULT_DISTINCT_CENTER_RATIO = 0.35
const DEFAULT_OVERLAP_MIN_IOU = 0.12
const DEFAULT_OVERLAP_MIN_SMALLER_AREA = 0.25
const DEFAULT_MIN_OVERLAP_SAMPLES = 2
const CALIBRATION_NMS_IOU = 0.95

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

async function seekVideo(videoEl, time) {
  if (Math.abs(videoEl.currentTime - time) < 0.0005 && videoEl.readyState >= 2) return
  await new Promise((res) => {
    const done = () => res()
    videoEl.addEventListener('seeked', done, { once: true })
    videoEl.currentTime = time
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

function minFaceSide(a, b) {
  return Math.max(1, Math.min(a.width, a.height, b.width, b.height))
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function percentSetting(value, fallback, max = 100) {
  return Number.isFinite(value) ? clamp(value, 0, max) / 100 : fallback
}

function overlapConfig(settings) {
  return {
    nmsIou: percentSetting(settings.overlapNmsIou, DEFAULT_OVERLAP_NMS_IOU),
    minIou: percentSetting(settings.overlapIoUThreshold, DEFAULT_OVERLAP_MIN_IOU),
    minSmallerArea: percentSetting(settings.overlapSmallFaceCoverage, DEFAULT_OVERLAP_MIN_SMALLER_AREA),
    distinctCenterRatio: percentSetting(settings.overlapCenterSeparation, DEFAULT_DISTINCT_CENTER_RATIO, 200),
    minSamples: Number.isFinite(settings.overlapMinSamples)
      ? Math.max(1, Math.round(settings.overlapMinSamples))
      : DEFAULT_MIN_OVERLAP_SAMPLES,
  }
}

function isDuplicateFace(a, b) {
  const { iou, smallerOverlap } = boxMetrics(a, b)
  const closeCenters = centerDistance(a, b) <= minFaceSide(a, b) * DUPLICATE_CENTER_RATIO
  return iou >= DUPLICATE_IOU_THRESHOLD || (smallerOverlap >= DUPLICATE_CONTAINMENT_THRESHOLD && closeCenters)
}

function dedupeFaceBoxes(boxes) {
  const kept = []
  for (const box of boxes) {
    if (!kept.some(existing => isDuplicateFace(box, existing))) kept.push(box)
  }
  return kept
}

function findOverlappingFacePair(boxes, config) {
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const metrics = boxMetrics(boxes[i], boxes[j])
      const centerSeparationRatio = centerDistance(boxes[i], boxes[j]) / minFaceSide(boxes[i], boxes[j])
      const distinctCenters = centerSeparationRatio >= config.distinctCenterRatio
      if (distinctCenters && metrics.iou >= config.minIou && metrics.smallerOverlap >= config.minSmallerArea) {
        return { boxes: [boxes[i], boxes[j]], centerSeparationRatio, ...metrics }
      }
    }
  }
  return null
}

function buildOverlapRanges(frames, sampleStep, maxFrame, config) {
  const overlaps = []
  let inOverlap = null

  const closeOverlap = () => {
    if (!inOverlap) return
    if (inOverlap.frames.length >= config.minSamples) {
      overlaps.push({
        frameRange: [inOverlap.start, Math.min(maxFrame, inOverlap.last + sampleStep - 1)],
        frames: inOverlap.frames,
        sampleCount: inOverlap.frames.length,
        maxIou: inOverlap.maxIou,
        maxSmallFaceCoverage: inOverlap.maxSmallFaceCoverage,
        maxCenterSeparation: inOverlap.maxCenterSeparation,
        samples: inOverlap.samples,
      })
    }
    inOverlap = null
  }

  for (const { frameNumber, overlap } of frames) {
    if (overlap) {
      if (!inOverlap) {
        inOverlap = {
          start: frameNumber,
          last: frameNumber,
          frames: [],
          samples: [],
          maxIou: 0,
          maxSmallFaceCoverage: 0,
          maxCenterSeparation: 0,
        }
      }
      inOverlap.last = frameNumber
      inOverlap.frames.push(frameNumber)
      inOverlap.samples.push({
        frameNumber,
        iou: overlap.iou,
        smallFaceCoverage: overlap.smallerOverlap,
        centerSeparation: overlap.centerSeparationRatio,
      })
      inOverlap.maxIou = Math.max(inOverlap.maxIou, overlap.iou)
      inOverlap.maxSmallFaceCoverage = Math.max(inOverlap.maxSmallFaceCoverage, overlap.smallerOverlap)
      inOverlap.maxCenterSeparation = Math.max(inOverlap.maxCenterSeparation, overlap.centerSeparationRatio)
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

function clampFrame(frame, totalFrames) {
  return clamp(Math.round(frame), 0, Math.max(0, totalFrames - 1))
}

function roundPercent(value) {
  return Math.round(value * 100)
}

function confidenceStats(faces) {
  const values = faces.map(({ face }) => face?.confidence).filter(Number.isFinite)
  if (!values.length) return { min: 0, max: 0, avg: 0 }
  const sum = values.reduce((total, value) => total + value, 0)
  return {
    min: roundPercent(Math.min(...values)),
    max: roundPercent(Math.max(...values)),
    avg: roundPercent(sum / values.length),
  }
}

export async function runDetection(videoEl, videoMeta, settings, onProgress, getAbort, options = {}) {
  const { fps, totalFrames, width, height } = videoMeta
  const { confidenceThreshold, sizeJumpThreshold, faceMovementThreshold, qualityThreshold } = settings
  const confThresh = confidenceThreshold / 100
  const qualThresh = qualityThreshold / 100
  const serverConf = Math.max(0.001, Math.min(confThresh, qualThresh, 0.25))
  const overlap = overlapConfig(settings)
  const startFrame = Number.isFinite(options.startFrame) ? clampFrame(options.startFrame, totalFrames) : 0
  const endFrame = Number.isFinite(options.endFrame) ? clampFrame(options.endFrame, totalFrames) : Math.max(0, totalFrames - 1)
  const scanStartFrame = Math.min(startFrame, endFrame)
  const scanEndFrame = Math.max(startFrame, endFrame)

  const offscreen = document.createElement('canvas')
  offscreen.width = width || 640
  offscreen.height = height || 360
  const ctx = offscreen.getContext('2d')

  const faces = []
  const thresholdCrossings = []
  const sizeJumps = []
  const movements = []
  const sampleDetails = []
  const collectSampleDetails = options.mode === 'test'
  let prevArea = null, prevCx = null, prevCy = null, prevW = null
  let wasAbove = null, wasAboveQual = null, prevConf = null
  const sampleStep = Math.max(1, Math.floor(fps / 15))
  const scanFrameCount = Math.max(1, scanEndFrame - scanStartFrame + 1)

  for (let f = scanStartFrame; f <= scanEndFrame; f += sampleStep) {
    if (getAbort?.()) break
    onProgress?.((f - scanStartFrame) / scanFrameCount)
    await seekVideo(videoEl, f / fps)
    ctx.drawImage(videoEl, 0, 0, offscreen.width, offscreen.height)

    let detected = []
    try { detected = await detectFrame(offscreen, { conf: serverConf, iou: overlap.nmsIou }) } catch { /* skip */ }
    const sortedDetected = detected.sort((a, b) => b.confidence - a.confidence)
    const best = sortedDetected[0] ?? null
    const overlapFaces = dedupeFaceBoxes(sortedDetected)
    const overlapPair = findOverlappingFacePair(overlapFaces, overlap)
    faces.push({
      frameNumber: f,
      face: best,
      allFaces: sortedDetected,
      overlap: overlapPair,
    })

    const conf = best?.confidence ?? 0
    const isAbove = conf > confThresh
    const isAboveQual = conf > qualThresh
    if (collectSampleDetails) {
      sampleDetails.push({
        frameNumber: f,
        confidence: roundPercent(conf),
        detectedFaces: overlapFaces.length,
        candidates: sortedDetected.length,
        overlap: Boolean(overlapPair),
        overlapIou: overlapPair ? roundPercent(overlapPair.iou) : null,
        overlapSmallFaceCoverage: overlapPair ? roundPercent(overlapPair.smallerOverlap) : null,
        overlapCenterSeparation: overlapPair ? roundPercent(overlapPair.centerSeparationRatio) : null,
        box: best ? {
          x: Math.round(best.x),
          y: Math.round(best.y),
          width: Math.round(best.width),
          height: Math.round(best.height),
        } : null,
      })
    }

    if (wasAbove !== null && isAbove !== wasAbove) {
      thresholdCrossings.push({
        type: 'onoff',
        direction: isAbove ? 'appear' : 'disappear',
        frameNumber: f,
        confidence: roundPercent(conf),
        previousConfidence: roundPercent(prevConf ?? 0),
        threshold: confidenceThreshold,
      })
    }
    wasAbove = isAbove

    if (wasAboveQual !== null && isAboveQual !== wasAboveQual) {
      thresholdCrossings.push({
        type: 'confidence',
        direction: isAboveQual ? 'recovery' : 'drop',
        frameNumber: f,
        confidence: roundPercent(conf),
        previousConfidence: roundPercent(prevConf ?? 0),
        threshold: qualityThreshold,
      })
    }
    wasAboveQual = isAboveQual
    prevConf = conf

    if (best) {
      const area = best.width * best.height
      const cx = best.x + best.width / 2
      const cy = best.y + best.height / 2
      if (prevArea !== null) {
        const pct = Math.abs(area - prevArea) / prevArea * 100
        if (pct > sizeJumpThreshold) {
          sizeJumps.push({
            frameNumber: f,
            percentChange: Math.round(pct),
            previousArea: Math.round(prevArea),
            area: Math.round(area),
            threshold: sizeJumpThreshold,
          })
        }
      }
      prevArea = area
      if (prevCx !== null && prevW) {
        const disp = Math.sqrt((cx - prevCx) ** 2 + (cy - prevCy) ** 2)
        const pct = (disp / prevW) * 100
        if (pct > faceMovementThreshold) {
          movements.push({
            frameNumber: f,
            percentDisplacement: Math.round(pct),
            displacementPixels: Math.round(disp),
            faceWidth: Math.round(prevW),
            threshold: faceMovementThreshold,
          })
        }
      }
      prevCx = cx; prevCy = cy; prevW = best.width
    } else { prevArea = null; prevCx = null; prevCy = null; prevW = null }
  }

  const overlaps = buildOverlapRanges(faces, sampleStep, scanEndFrame, overlap)
  const detectedFrames = faces.filter(({ face }) => face).length
  const stats = confidenceStats(faces)
  onProgress?.(1)

  return {
    faces: faces.filter(f => f.face).map(({ frameNumber, face }) => ({ frameNumber, ...face })),
    overlaps,
    thresholdCrossings,
    sizeJumps,
    movements,
    frameRange: [scanStartFrame, scanEndFrame],
    scannedFrames: faces.length,
    runMode: options.mode ?? 'full',
    details: {
      sampleStep,
      detectedFrames,
      missingFrames: faces.length - detectedFrames,
      framesWithCandidates: faces.filter(({ allFaces }) => allFaces.length > 1).length,
      framesWithOverlaps: faces.filter(({ overlap }) => overlap).length,
      confidence: stats,
      thresholds: {
        confidenceThreshold,
        qualityThreshold,
        sizeJumpThreshold,
        faceMovementThreshold,
        overlapNmsIou: roundPercent(overlap.nmsIou),
        overlapIoUThreshold: roundPercent(overlap.minIou),
        overlapSmallFaceCoverage: roundPercent(overlap.minSmallerArea),
        overlapCenterSeparation: roundPercent(overlap.distinctCenterRatio),
        overlapMinSamples: overlap.minSamples,
      },
      samples: sampleDetails,
    },
  }
}
