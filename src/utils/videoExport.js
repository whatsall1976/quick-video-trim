import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

let ffmpeg = null
let exportRunId = 0

async function getFFmpeg() {
  if (ffmpeg?.loaded) return ffmpeg
  ffmpeg = new FFmpeg()
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  })
  return ffmpeg
}

/**
 * Export trimmed video with audio processing.
 * @param {File} videoFile
 * @param {Array} trimSegments  [{ startFrame, endFrame }]
 * @param {object} videoMeta    { fps, duration, width, height, totalFrames }
 * @param {string} audioMode    'SYNC' | 'Mute' | 'Separate'
 * @param {function} onProgress ({ progress, message }) => void
 */
export async function exportVideo(videoFile, trimSegments, videoMeta, audioMode, onProgress) {
  const { fps } = videoMeta
  const ff = await getFFmpeg()
  const runId = ++exportRunId
  const inputPath = `input-${runId}.mp4`
  const outputPath = `output-${runId}.mp4`

  onProgress?.({ progress: 0.05, message: 'Loading video…' })
  await ff.writeFile(inputPath, await fetchFile(videoFile))

  try {
    const kept = getKeptSegments(trimSegments, videoMeta)
    const outputDuration = getKeptDuration(kept, fps)

    onProgress?.({
      progress: 0.1,
      message: kept.length > 1 ? `Trimming and stitching ${kept.length} kept sections…` : 'Trimming video…',
    })

    const args = buildExportArgs(inputPath, outputPath, kept, videoMeta, audioMode)
    try {
      await execFFmpeg(ff, args, {
        label: 'Video export',
        startProgress: 0.1,
        endProgress: 0.85,
        outputDuration,
        message: kept.length > 1 ? `Trimming and stitching ${kept.length} kept sections…` : 'Trimming video…',
        onProgress,
      })
    } catch (err) {
      if (audioMode !== 'Mute' && isMissingAudioStreamError(err)) {
        await safeDelete(ff, outputPath)
        onProgress?.({ progress: 0.12, message: 'No audio stream found; exporting muted video…' })
        await execFFmpeg(ff, buildExportArgs(inputPath, outputPath, kept, videoMeta, 'Mute'), {
          label: 'Muted video export',
          startProgress: 0.12,
          endProgress: 0.85,
          outputDuration,
          message: kept.length > 1 ? `Trimming and stitching ${kept.length} kept sections…` : 'Trimming video…',
          onProgress,
        })
      } else {
        throw err
      }
    }

    onProgress?.({ progress: 0.9, message: 'Reading output…' })
    const data = await ff.readFile(outputPath)
    const blob = new Blob([data], { type: 'video/mp4' })

    const jsonBlob = createProjectJsonBlob(videoFile, trimSegments, videoMeta, audioMode)

    onProgress?.({ progress: 1, message: 'Done!' })
    return { videoBlob: blob, jsonBlob }
  } finally {
    await safeDelete(ff, inputPath)
    await safeDelete(ff, outputPath)
  }
}

function buildExportArgs(inputPath, outputPath, kept, videoMeta, audioMode) {
  const { fps } = videoMeta
  const wantsAudio = audioMode !== 'Mute'
  const { filter, maps } = buildExportFilter(kept, fps, audioMode)

  return [
    '-i', inputPath,
    '-filter_complex', filter,
    ...maps,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    ...(wantsAudio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']),
    '-movflags', '+faststart',
    outputPath,
  ]
}

function buildExportFilter(kept, fps, audioMode) {
  if (audioMode === 'SYNC') return buildSyncedAudioFilter(kept, fps)

  const parts = buildVideoOnlyFilterParts(kept)
  if (audioMode === 'Separate') {
    const outputDuration = getKeptDuration(kept, fps)
    const fadeDuration = Math.min(5, outputDuration)
    const fadeStart = Math.max(0, outputDuration - fadeDuration)
    parts.push(
      `[0:a]apad,atrim=duration=${fmtTime(outputDuration)},asetpts=PTS-STARTPTS,` +
      `afade=t=out:st=${fmtTime(fadeStart)}:d=${fmtTime(fadeDuration)}[aout]`
    )
    return { filter: parts.join(';'), maps: ['-map', '[vout]', '-map', '[aout]'] }
  }

  return { filter: parts.join(';'), maps: ['-map', '[vout]'] }
}

function buildSyncedAudioFilter(kept, fps) {
  const parts = []

  if (kept.length === 1) {
    const seg = kept[0]
    parts.push(videoTrimFilter(seg, 'vout'))
    parts.push(audioTrimFilter(seg, fps, 'aout'))
    return { filter: parts.join(';'), maps: ['-map', '[vout]', '-map', '[aout]'] }
  }

  for (let i = 0; i < kept.length; i++) {
    parts.push(videoTrimFilter(kept[i], `v${i}`))
    parts.push(audioTrimFilter(kept[i], fps, `a${i}`))
  }

  const concatInputs = kept.map((_, i) => `[v${i}][a${i}]`).join('')
  parts.push(`${concatInputs}concat=n=${kept.length}:v=1:a=1[vout][aout]`)

  return { filter: parts.join(';'), maps: ['-map', '[vout]', '-map', '[aout]'] }
}

function buildVideoOnlyFilterParts(kept) {
  if (kept.length === 1) return [videoTrimFilter(kept[0], 'vout')]

  const parts = kept.map((seg, i) => videoTrimFilter(seg, `v${i}`))
  const concatInputs = kept.map((_, i) => `[v${i}]`).join('')
  parts.push(`${concatInputs}concat=n=${kept.length}:v=1:a=0[vout]`)
  return parts
}

function videoTrimFilter(seg, outLabel) {
  return `[0:v]trim=start_frame=${seg.startFrame}:end_frame=${seg.endFrame + 1},setpts=PTS-STARTPTS[${outLabel}]`
}

function audioTrimFilter(seg, fps, outLabel) {
  const start = seg.startFrame / fps
  const duration = (seg.endFrame - seg.startFrame + 1) / fps
  return `[0:a]atrim=start=${fmtTime(start)}:duration=${fmtTime(duration)},asetpts=PTS-STARTPTS[${outLabel}]`
}

function getKeptDuration(kept, fps) {
  return kept.reduce((sum, seg) => sum + (seg.endFrame - seg.startFrame + 1) / fps, 0)
}

function fmtTime(value) {
  return Math.max(0, value).toFixed(6)
}

async function execFFmpeg(ff, args, { label, startProgress, endProgress, outputDuration, message, onProgress }) {
  const logs = []
  const logHandler = ({ message: logMessage }) => {
    logs.push(logMessage)
    console.log('[ffmpeg]', logMessage)
  }
  const progressHandler = ({ progress, time }) => {
    const progressFromTime = outputDuration > 0 && Number.isFinite(time) ? time / 1000000 / outputDuration : 0
    const ratio = clamp01(Math.max(progress || 0, progressFromTime || 0))
    onProgress?.({
      progress: startProgress + (endProgress - startProgress) * ratio,
      message,
    })
  }

  ff.on('log', logHandler)
  ff.on('progress', progressHandler)
  try {
    const code = await ff.exec(args)
    if (code !== 0) {
      const err = new Error(`${label} failed: ${summarizeFFmpegError(logs)}`)
      err.code = code
      err.logs = logs
      throw err
    }
  } finally {
    ff.off('log', logHandler)
    ff.off('progress', progressHandler)
  }
}

function summarizeFFmpegError(logs) {
  const detail = logs
    .slice()
    .reverse()
    .find(line => /error|failed|invalid|unable|no such|matches no streams/i.test(line))
  return detail || 'ffmpeg exited with an error'
}

function isMissingAudioStreamError(err) {
  const text = err.logs?.join('\n') || err.message || ''
  return /stream specifier.*:a|matches no streams|no such stream|audio.*stream.*not found/i.test(text)
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

async function safeDelete(ff, path) {
  try {
    await ff.deleteFile(path)
  } catch {
    // The file may not exist if ffmpeg failed before creating it.
  }
}

export function getKeptSegments(trimSegments, videoMeta) {
  const { totalFrames } = videoMeta
  const kept = []
  let cursor = 0
  const sorted = [...trimSegments].sort((a, b) => a.startFrame - b.startFrame)
  for (const seg of sorted) {
    const start = Math.max(0, Math.min(totalFrames, Math.round(seg.startFrame)))
    const end = Math.max(-1, Math.min(totalFrames - 1, Math.round(seg.endFrame)))
    if (start > end || end < cursor) continue
    if (cursor < start) kept.push({ startFrame: cursor, endFrame: start - 1 })
    cursor = Math.max(cursor, end + 1)
  }
  if (cursor < totalFrames) kept.push({ startFrame: cursor, endFrame: totalFrames - 1 })
  if (!kept.length) kept.push({ startFrame: 0, endFrame: totalFrames - 1 })
  return kept
}

export function createProjectJsonBlob(videoFile, trimSegments, videoMeta, audioMode) {
  const { fps, duration } = videoMeta
  const jsonMeta = {
    videoFile: videoFile.name,
    duration,
    fps,
    exportedAt: new Date().toISOString(),
    keptSegments: getKeptSegments(trimSegments, videoMeta),
    audioMode,
  }
  return new Blob([JSON.stringify(jsonMeta, null, 2)], { type: 'application/json' })
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
