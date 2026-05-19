import { useApp } from '../context/AppContext'
import { useMarkers } from '../hooks/useMarkers'
import { useYOLODetection } from '../hooks/useYOLODetection'

export default function DetectorPanel({ videoRef, onClose }) {
  const { state, dispatch, toast } = useApp()
  const { isDetecting, detectionProgress, detectionResults, markers, video, selectedMarkerId } = state
  const { runDetectionPipeline } = useYOLODetection(videoRef)
  const { updateMarker, selectMarker } = useMarkers()

  const flagged = markers.filter(m => m.flagged)
  const auto = markers.filter(m => m.autoDetected)

  const keepMarker = (id) => {
    dispatch({ type: 'UPDATE_MARKER', payload: { id, flagged: false } })
  }

  const removeMarker = (id) => {
    dispatch({ type: 'REMOVE_MARKER', payload: id })
  }

  const goToMarker = (m) => {
    selectMarker(m.id)
    dispatch({ type: 'SET_FRAME', payload: m.frameNumber })
    dispatch({ type: 'SET_PLAYING', payload: false })
  }

  const updateOverlapFrame = (m, key, value) => {
    const frame = parseInt(value, 10)
    if (isNaN(frame)) return
    if (frame < 0 || frame >= video.totalFrames) {
      toast('Overlap frame out of bounds', 'error', 1800)
      return
    }

    const startFrame = key === 'overlapStartFrame' ? frame : (m.overlapStartFrame ?? m.frameNumber)
    const endFrame = key === 'overlapEndFrame' ? frame : (m.overlapEndFrame ?? m.frameNumber)
    if (startFrame > endFrame) {
      toast('Overlap start must be before end', 'warning', 1800)
      return
    }

    const changes = {
      [key]: frame,
      reason: `Overlap ${startFrame}-${endFrame}`,
    }
    if (key === 'overlapStartFrame') changes.frameNumber = frame
    updateMarker(m.id, changes)
  }

  const removeAllFlagged = () => {
    dispatch({ type: 'SET_MARKERS', payload: markers.filter(m => !m.flagged) })
    toast('Flagged overlap markers removed', 'info', 1500)
  }

  const removeAllAuto = () => {
    dispatch({ type: 'SET_MARKERS', payload: markers.filter(m => !m.autoDetected) })
    toast('Auto-detected markers removed', 'info', 1500)
  }

  const { thresholdCrossings = [], sizeJumps = [], movements = [], overlaps = [] } = detectionResults

  return (
    <>
      <div className="panel-header">
        <span className="panel-title">Face Detection</span>
        <button className="panel-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="panel-body">
        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={runDetectionPipeline}
          disabled={!video.file || isDetecting}
          id="run-detection-btn"
        >
          {isDetecting ? `⏳ Detecting… ${detectionProgress}%` : '🔍 Run Detection'}
        </button>

        {isDetecting && (
          <div>
            <div className="progress-bar-wrap">
              <div className="progress-bar-fill" style={{ width: `${detectionProgress}%` }} />
            </div>
            <div className="detection-status">{detectionProgress}% complete</div>
          </div>
        )}

        {!isDetecting && thresholdCrossings.length === 0 && sizeJumps.length === 0 && movements.length === 0 && !video.file && (
          <div className="empty-state">Load a video then click Run Detection to auto-place markers.</div>
        )}

        {(thresholdCrossings.length > 0 || sizeJumps.length > 0 || movements.length > 0) && (
          <>
            <div className="section-divider">Detection Results</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { label: 'Face events', count: thresholdCrossings.length, color: 'var(--accent)' },
                { label: 'Size jumps', count: sizeJumps.length, color: 'var(--warning)' },
                { label: 'Movements', count: movements.length, color: 'var(--success)' },
                { label: 'Overlaps', count: overlaps.length, color: 'var(--danger)' },
              ].map(({ label, count, color }) => (
                <div key={label} style={{
                  flex: '1 0 40%', background: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-sm)', padding: '8px 10px',
                  border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color }}>{count}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Auto markers summary */}
        {auto.length > 0 && (
          <>
            <div className="section-divider">Auto Markers ({auto.length})</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="btn btn-danger"
                style={{ flex: 1, fontSize: 11 }}
                onClick={removeAllAuto}
              >
                Remove Auto Markers
              </button>
            </div>
          </>
        )}

        {/* Flagged overlap review */}
        {flagged.length > 0 && (
          <>
            <div className="section-divider" style={{ color: 'var(--warning)' }}>
              ⚠ Flagged Overlaps ({flagged.length})
            </div>
            <button
              className="btn btn-danger"
              style={{ width: '100%', fontSize: 11 }}
              onClick={removeAllFlagged}
            >
              Remove All Overlap Markers
            </button>
            {flagged.map(m => (
              <div
                key={m.id}
                className={`marker-item flagged ${selectedMarkerId === m.id ? 'selected' : ''}`}
                id={`flagged-${m.id}`}
                onClick={() => selectMarker(m.id)}
              >
                <div className="marker-dot flagged" />
                <div className="marker-info">
                  <div className="marker-frame">Frame {m.frameNumber}</div>
                  <div className="marker-meta">{m.reason ?? 'Multiple faces detected'}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
                    <div className="form-row">
                      <span className="form-label">Overlap start</span>
                      <input
                        className="form-input"
                        type="number"
                        min={0}
                        max={Math.max(0, video.totalFrames - 1)}
                        defaultValue={m.overlapStartFrame ?? m.frameNumber}
                        onBlur={e => updateOverlapFrame(m, 'overlapStartFrame', e.target.value)}
                      />
                    </div>
                    <div className="form-row">
                      <span className="form-label">Overlap end</span>
                      <input
                        className="form-input"
                        type="number"
                        min={0}
                        max={Math.max(0, video.totalFrames - 1)}
                        defaultValue={m.overlapEndFrame ?? m.frameNumber}
                        onBlur={e => updateOverlapFrame(m, 'overlapEndFrame', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <div className="marker-actions">
                  <button
                    className="icon-btn"
                    onClick={() => goToMarker(m)}
                    title="Jump to frame"
                    style={{ color: 'var(--accent)' }}
                  >
                    ⤷
                  </button>
                  <button
                    className="btn"
                    style={{ fontSize: 11, padding: '3px 8px', color: 'var(--success)', borderColor: 'var(--success)' }}
                    onClick={() => { keepMarker(m.id); toast(`Marker ${m.id} accepted`, 'success', 1500) }}
                    title="Keep marker"
                  >
                    ✓
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => { removeMarker(m.id); toast(`Marker removed`, 'info', 1200) }}
                    title="Remove marker"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  )
}
