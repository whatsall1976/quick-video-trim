import { useRef, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { useMarkers } from '../hooks/useMarkers'

export default function Timeline() {
  const { state, dispatch } = useApp()
  const { video, playback, markers, trimSegments } = state
  const { updateMarker } = useMarkers()
  const trackRef = useRef(null)
  const draggingRef = useRef(null)

  const toPercent = (frame) => (frame / Math.max(video.totalFrames - 1, 1)) * 100

  const onTrackClick = useCallback((e) => {
    if (!video.file || draggingRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const frame = Math.round((x / rect.width) * (video.totalFrames - 1))
    dispatch({ type: 'SET_FRAME', payload: Math.max(0, Math.min(video.totalFrames - 1, frame)) })
  }, [video, dispatch])

  const onMarkerMouseDown = useCallback((e, markerId) => {
    e.stopPropagation()
    draggingRef.current = markerId
    const rect = trackRef.current.getBoundingClientRect()

    const onMove = (ev) => {
      const x = ev.clientX - rect.left
      const frame = Math.round((x / rect.width) * (video.totalFrames - 1))
      updateMarker(markerId, { frameNumber: Math.max(0, Math.min(video.totalFrames - 1, frame)) })
    }
    const onUp = () => {
      draggingRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [video, updateMarker])

  const fmt = (f) => {
    const s = f / (video.fps || 30)
    const m = Math.floor(s / 60)
    return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`
  }

  return (
    <div className="timeline-area">
      <div className="timeline-time-display">
        <span className="time-current">{fmt(playback.currentFrame)}</span>
        <span className="time-total">/ {fmt(video.totalFrames > 0 ? video.totalFrames - 1 : 0)}</span>
        <span className="frame-display">Frame {playback.currentFrame}</span>
        {trimSegments.length > 0 && (
          <span style={{ color: 'var(--danger)', fontSize: 11, marginLeft: 'auto' }}>
            {trimSegments.length} trim{trimSegments.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div
        ref={trackRef}
        className="timeline-track"
        onClick={onTrackClick}
        role="slider"
        aria-label="Timeline"
        aria-valuenow={playback.currentFrame}
        aria-valuemin={0}
        aria-valuemax={video.totalFrames - 1}
        id="timeline-track"
      >
        {/* Trim segments (red zones) */}
        {trimSegments.map((seg, i) => (
          <div
            key={i}
            className="timeline-segment"
            style={{
              left: `${toPercent(seg.startFrame)}%`,
              width: `${toPercent(seg.endFrame) - toPercent(seg.startFrame)}%`,
            }}
            title={`Trim: frames ${seg.startFrame}–${seg.endFrame}`}
          />
        ))}

        {/* Marker ticks */}
        {markers.map(m => (
          <div
            key={m.id}
            className={`timeline-marker ${m.flagged ? 'flagged' : m.autoDetected ? 'auto' : 'manual'}`}
            style={{ left: `${toPercent(m.frameNumber)}%` }}
            onMouseDown={e => onMarkerMouseDown(e, m.id)}
            title={`${m.autoDetected ? 'Auto' : 'Manual'} marker · Frame ${m.frameNumber}${m.reason ? ` · ${m.reason}` : ''}`}
          />
        ))}

        {/* Playhead */}
        {video.file && (
          <div
            className="timeline-playhead"
            style={{ left: `${toPercent(playback.currentFrame)}%` }}
          />
        )}
      </div>

      <div className="timeline-labels">
        <span>{fmt(0)}</span>
        <span>{fmt(Math.max(0, Math.floor((video.totalFrames - 1) / 4)))}</span>
        <span>{fmt(Math.max(0, Math.floor((video.totalFrames - 1) / 2)))}</span>
        <span>{fmt(Math.max(0, Math.floor((video.totalFrames - 1) * 3 / 4)))}</span>
        <span>{fmt(Math.max(0, video.totalFrames - 1))}</span>
      </div>
    </div>
  )
}
