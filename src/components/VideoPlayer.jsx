import { useEffect, useRef, useCallback } from 'react'
import { useApp } from '../context/AppContext'

export default function VideoPlayer({ videoRef, canvasRef }) {
  const { state, dispatch, toast } = useApp()
  const { video, playback } = state
  const fileInputRef = useRef(null)

  // Draw current frame onto canvas continuously via RAF (for responsive scrubbing)
  useEffect(() => {
    const vid = videoRef?.current
    const canvas = canvasRef?.current
    if (!vid || !canvas || !video.file) return
    const ctx = canvas.getContext('2d')

    const draw = () => {
      canvas.width = video.width || vid.videoWidth || 640
      canvas.height = video.height || vid.videoHeight || 360
      ctx.drawImage(vid, 0, 0, canvas.width, canvas.height)
    }

    // Always draw via RAF for responsiveness
    let rafId
    let timeoutId
    const loop = () => {
      const targetTime = playback.currentFrame / (video.fps || 30)
      // Keep seeking video element in sync with current frame
      if (Math.abs(vid.currentTime - targetTime) > 0.001) {
        vid.currentTime = targetTime
      }
      draw()
      rafId = requestAnimationFrame(loop)
    }

    rafId = requestAnimationFrame(loop)

    // Fallback: force redraw if RAF stalls (for very large files)
    timeoutId = setInterval(draw, 100)

    return () => {
      cancelAnimationFrame(rafId)
      clearInterval(timeoutId)
    }
  }, [playback.currentFrame, playback.isPlaying, video, videoRef, canvasRef])

  const loadFile = useCallback(async (file) => {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['mp4', 'mov'].includes(ext)) {
      toast('Only MP4 and MOV files are supported', 'error'); return
    }
    if (file.size > 2 * 1024 * 1024 * 1024) {
      toast('File exceeds 2 GB — canvas rendering may be slow', 'warning')
    }

    const vid = videoRef?.current
    if (!vid) { toast('Internal error: video element not ready', 'error'); return }

    const url = URL.createObjectURL(file)
    vid.src = url

    const ok = await new Promise((res) => {
      vid.onloadedmetadata = () => res(true)
      vid.onerror = () => res(false)
      vid.load()
    })

    if (!ok || !vid.duration) {
      toast('Failed to load video metadata. File may be corrupted.', 'error')
      vid.src = ''
      return
    }

    // Detect FPS: prefer requestVideoFrameCallback, else fall back to 30
    const fps = await detectFPS(vid).catch(() => 30)
    const totalFrames = Math.floor(vid.duration * fps)

    dispatch({
      type: 'SET_VIDEO',
      payload: {
        file,
        duration: vid.duration,
        fps,
        width: vid.videoWidth,
        height: vid.videoHeight,
        totalFrames,
      }
    })
    toast(`Loaded: ${file.name} · ${vid.videoWidth}×${vid.videoHeight} · ${fps}fps · ${vid.duration.toFixed(1)}s`, 'success', 4000)
  }, [videoRef, dispatch, toast])

  async function detectFPS(vid) {
    if ('requestVideoFrameCallback' in vid) {
      return new Promise((res) => {
        const timestamps = []
        const cb = (now, meta) => {
          timestamps.push(meta.mediaTime)
          if (timestamps.length < 6) {
            vid.requestVideoFrameCallback(cb)
          } else {
            vid.pause()
            const deltas = []
            for (let i = 1; i < timestamps.length; i++)
              deltas.push(timestamps[i] - timestamps[i - 1])
            const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length
            res(avgDelta > 0 ? Math.round(1 / avgDelta) : 30)
          }
        }
        vid.currentTime = 0
        vid.requestVideoFrameCallback(cb)
        vid.play().catch(() => res(30))
        setTimeout(() => { vid.pause(); res(30) }, 2000)
      })
    }
    return 30
  }

  const onDrop = useCallback((e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (file) loadFile(file)
  }, [loadFile])

  const fmt = (s) => {
    if (!s || isNaN(s)) return '0:00.0'
    const m = Math.floor(s / 60)
    const sec = (s % 60).toFixed(1)
    return `${m}:${sec.padStart(4, '0')}`
  }

  return (
    // Always render — both upload zone AND hidden video element
    <>
      {/* Hidden video element always mounted so videoRef is never null */}
      <video
        ref={videoRef}
        style={{ display: 'none' }}
        playsInline
        muted
        preload="metadata"
      />

      {!video.file ? (
        <div
          className="upload-zone"
          onClick={() => fileInputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          onDragLeave={() => {}}
          role="button"
          tabIndex={0}
          id="upload-zone"
          aria-label="Upload video file"
          onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
        >
          <div className="upload-icon">🎬</div>
          <div>
            <div className="upload-title">Drop a video or click to upload</div>
            <div className="upload-sub">MP4 · MOV · H.264 · up to 2 GB</div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,.mov,video/mp4,video/quicktime"
            style={{ display: 'none' }}
            onChange={e => loadFile(e.target.files?.[0])}
            id="file-input"
          />
        </div>
      ) : (
        <>
          <canvas ref={canvasRef} className="video-canvas" id="main-canvas" />
          <div className="video-info-overlay">
            <div>{video.width}×{video.height} · <span>{video.fps}fps</span></div>
            <div>Frame <span>{playback.currentFrame}</span> / {video.totalFrames - 1}</div>
            <div><span>{fmt(playback.currentFrame / video.fps)}</span> / {fmt(video.duration)}</div>
          </div>
        </>
      )}
    </>
  )
}
