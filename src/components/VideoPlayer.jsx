import { useEffect, useRef, useCallback } from 'react'
import { useApp } from '../context/AppContext'

export default function VideoPlayer({ videoRef, canvasRef }) {
  const { state, dispatch, toast } = useApp()
  const { video, playback } = state
  const fileInputRef = useRef(null)
  const isDragRef = useRef(false)

  // Draw current frame onto canvas
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
    if (playback.isPlaying) {
      vid.onseeked = null
      const id = requestAnimationFrame(draw)
      return () => cancelAnimationFrame(id)
    } else {
      draw()
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

    const url = URL.createObjectURL(file)
    const vid = videoRef?.current
    if (!vid) return
    vid.src = url

    await new Promise((res, rej) => {
      vid.onloadedmetadata = res
      vid.onerror = () => rej(new Error('Failed to load video metadata'))
    }).catch(e => { toast(e.message, 'error'); return })

    const fps = await detectFPS(vid)
    const totalFrames = Math.floor(vid.duration * fps)

    if (!fps || !vid.duration) {
      toast('Cannot read video metadata (fps/duration). Cannot proceed.', 'error'); return
    }

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
    toast(`Loaded: ${file.name} (${vid.videoWidth}×${vid.videoHeight}, ${fps}fps, ${vid.duration.toFixed(1)}s)`, 'success', 4000)
  }, [videoRef, dispatch, toast])

  async function detectFPS(vid) {
    // Try to read fps from video track if available
    if ('getVideoPlaybackQuality' in vid) {
      // Attempt heuristic: seek two frames
    }
    // Common fallback: use requestVideoFrameCallback if available
    if ('requestVideoFrameCallback' in vid) {
      return new Promise(res => {
        let count = 0, t0 = null
        const cb = (now, meta) => {
          if (!t0) t0 = meta.mediaTime
          count++
          if (count < 5) { vid.requestVideoFrameCallback(cb); return }
          const elapsed = meta.mediaTime - t0
          res(elapsed > 0 ? Math.round(count / elapsed) : 30)
        }
        vid.requestVideoFrameCallback(cb)
        vid.play().then(() => setTimeout(() => { vid.pause(); res(30) }, 500))
      })
    }
    return 30
  }

  const onDrop = useCallback((e) => {
    e.preventDefault()
    isDragRef.current = false
    const file = e.dataTransfer?.files?.[0]
    if (file) loadFile(file)
  }, [loadFile])

  const onDragOver = (e) => { e.preventDefault(); isDragRef.current = true }
  const onDragLeave = () => { isDragRef.current = false }

  const fmt = (s) => {
    const m = Math.floor(s / 60), sec = (s % 60).toFixed(1)
    return `${m}:${sec.toString().padStart(4, '0')}`
  }

  if (!video.file) {
    return (
      <div
        className="upload-zone"
        onClick={() => fileInputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        role="button"
        tabIndex={0}
        id="upload-zone"
        aria-label="Upload video file"
        onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
      >
        <div className="upload-icon">🎬</div>
        <div>
          <div className="upload-title">Drop a video or click to upload</div>
          <div className="upload-sub">MP4 · MOV · up to 2 GB</div>
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
    )
  }

  return (
    <>
      <canvas ref={canvasRef} className="video-canvas" id="main-canvas" />
      <video ref={videoRef} style={{ display: 'none' }} playsInline muted />
      <div className="video-info-overlay">
        <div>{video.width}×{video.height} · <span>{video.fps}fps</span></div>
        <div>Frame <span>{playback.currentFrame}</span> / {video.totalFrames - 1}</div>
        <div><span>{fmt(playback.currentFrame / video.fps)}</span> / {fmt(video.duration)}</div>
      </div>
    </>
  )
}
