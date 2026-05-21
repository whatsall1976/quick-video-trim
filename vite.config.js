import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'configure-response-headers',
      configureServer: (server) => {
        server.middlewares.use('/api/export-native', nativeExportMiddleware)
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
          next()
        })
      },
    },
  ],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})

async function nativeExportMiddleware(req, res, next) {
  if (req.method !== 'POST') {
    next()
    return
  }

  let workDir = null
  try {
    const metaHeader = req.headers['x-export-meta']
    if (!metaHeader || Array.isArray(metaHeader)) throw new Error('Missing export metadata')

    const { trimSegments, videoMeta, audioMode } = JSON.parse(decodeURIComponent(metaHeader))
    const kept = getKeptSegments(trimSegments, videoMeta)
    workDir = await mkdtemp(join(tmpdir(), 'quick-video-trim-'))

    const inputPath = join(workDir, 'input.mp4')
    const outputPath = join(workDir, 'output.mp4')
    await pipeline(req, createWriteStream(inputPath))

    try {
      await runFFmpeg(buildNativeExportArgs(inputPath, outputPath, kept, videoMeta, audioMode))
    } catch (err) {
      if (audioMode !== 'Mute' && isMissingAudioStreamError(err)) {
        await runFFmpeg(buildNativeExportArgs(inputPath, outputPath, kept, videoMeta, 'Mute'))
      } else {
        throw err
      }
    }

    const output = await readFile(outputPath)
    res.statusCode = 200
    res.setHeader('Content-Type', 'video/mp4')
    res.setHeader('Content-Length', output.length)
    res.setHeader('X-Export-Engine', 'native-ffmpeg')
    res.end(output)
  } catch (err) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: err.message || 'Native export failed' }))
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true })
  }
}

function buildNativeExportArgs(inputPath, outputPath, kept, videoMeta, audioMode) {
  const { fps } = videoMeta
  const wantsAudio = audioMode !== 'Mute'
  const { filter, maps } = buildExportFilter(kept, fps, audioMode)

  return [
    '-hide_banner',
    '-y',
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

function getKeptSegments(trimSegments, videoMeta) {
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

function getKeptDuration(kept, fps) {
  return kept.reduce((sum, seg) => sum + (seg.endFrame - seg.startFrame + 1) / fps, 0)
}

function fmtTime(value) {
  return Math.max(0, value).toFixed(6)
}

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args)
    const logs = []

    child.stderr.on('data', chunk => {
      const text = chunk.toString()
      logs.push(text)
      console.error(`[native ffmpeg] ${text}`)
    })

    child.on('error', err => {
      if (err.code === 'ENOENT') {
        reject(new Error('Native ffmpeg was not found. Install ffmpeg and make sure it is on PATH.'))
      } else {
        reject(err)
      }
    })

    child.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        const err = new Error(`Native ffmpeg failed: ${summarizeFFmpegError(logs)}`)
        err.code = code
        err.logs = logs
        reject(err)
      }
    })
  })
}

function summarizeFFmpegError(logs) {
  const detail = logs
    .join('\n')
    .split('\n')
    .reverse()
    .find(line => /error|failed|invalid|unable|no such|matches no streams/i.test(line))
  return detail || 'ffmpeg exited with an error'
}

function isMissingAudioStreamError(err) {
  const text = err.logs?.join('\n') || err.message || ''
  return /stream specifier.*:a|matches no streams|no such stream|audio.*stream.*not found/i.test(text)
}
