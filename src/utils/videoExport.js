import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

let ffmpeg = null

async function getFFmpeg(onLog) {
  if (ffmpeg?.loaded) return ffmpeg
  ffmpeg = new FFmpeg()
  if (onLog) ffmpeg.on('log', ({ message }) => onLog(message))
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
  const { fps, totalFrames, duration } = videoMeta
  const ff = await getFFmpeg((msg) => console.log('[ffmpeg]', msg))

  onProgress?.({ progress: 0.05, message: 'Loading video…' })
  await ff.writeFile('input.mp4', await fetchFile(videoFile))

  const kept = getKeptSegments(trimSegments, videoMeta)

  onProgress?.({ progress: 0.1, message: 'Trimming segments…' })

  // Build trim+concat via complex filter or concat demuxer
  if (kept.length === 1) {
    // Single keep segment — simple trim
    const seg = kept[0]
    const ss = seg.startFrame / fps
    const t = (seg.endFrame - seg.startFrame + 1) / fps
    const audioFlag = audioMode === 'Mute' ? ['-an'] : ['-c:a', 'aac']
    await ff.exec([
      '-i', 'input.mp4',
      '-ss', ss.toFixed(3),
      '-t', t.toFixed(3),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
      ...audioFlag,
      'output.mp4'
    ])
  } else {
    // Multiple segments: build concat list
    const concatLines = []
    for (let i = 0; i < kept.length; i++) {
      const seg = kept[i]
      const ss = seg.startFrame / fps
      const t = (seg.endFrame - seg.startFrame + 1) / fps
      const name = `seg${i}.mp4`
      const audioFlag = audioMode === 'Mute' ? ['-an'] : ['-c:a', 'aac']
      await ff.exec([
        '-i', 'input.mp4',
        '-ss', ss.toFixed(3),
        '-t', t.toFixed(3),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
        ...audioFlag,
        name
      ])
      concatLines.push(`file '${name}'`)
      onProgress?.({ progress: 0.1 + 0.6 * (i / kept.length), message: `Trimming segment ${i + 1}/${kept.length}…` })
    }
    const concatTxt = concatLines.join('\n')
    await ff.writeFile('concat.txt', concatTxt)
    onProgress?.({ progress: 0.75, message: 'Concatenating…' })
    await ff.exec([
      '-f', 'concat', '-safe', '0',
      '-i', 'concat.txt',
      '-c', 'copy',
      'output.mp4'
    ])
  }

  onProgress?.({ progress: 0.85, message: 'Reading output…' })
  const data = await ff.readFile('output.mp4')
  const blob = new Blob([data.buffer], { type: 'video/mp4' })

  const jsonBlob = createProjectJsonBlob(videoFile, trimSegments, videoMeta, audioMode)

  onProgress?.({ progress: 1, message: 'Done!' })
  return { videoBlob: blob, jsonBlob }
}

export function getKeptSegments(trimSegments, videoMeta) {
  const { totalFrames } = videoMeta
  const kept = []
  let cursor = 0
  const sorted = [...trimSegments].sort((a, b) => a.startFrame - b.startFrame)
  for (const seg of sorted) {
    const start = Math.max(0, seg.startFrame)
    const end = Math.min(totalFrames - 1, seg.endFrame)
    if (cursor < start) kept.push({ startFrame: cursor, endFrame: start - 1 })
    cursor = end + 1
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
