import { useApp } from '../context/AppContext'
import { useYOLODetection } from '../hooks/useYOLODetection'

export default function DetectorPanel({ videoRef, onClose }) {
  const { state, dispatch, toast } = useApp()
  const { isDetecting, detectionProgress, detectionResults, markers, video } = state
  const { runDetectionPipeline } = useYOLODetection(videoRef)

  const flagged = markers.filter(m => m.flagged)
  const auto = markers.filter(m => m.autoDetected)

  const keepMarker = (id) => {
    dispatch({ type: 'UPDATE_MARKER', payload: { id, flagged: false } })
  }

  const removeMarker = (id) => {
    dispatch({ type: 'REMOVE_MARKER', payload: id })
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
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {auto.length} markers auto-placed. Review in the Markers panel (M).
            </div>
          </>
        )}

        {/* Flagged overlap review */}
        {flagged.length > 0 && (
          <>
            <div className="section-divider" style={{ color: 'var(--warning)' }}>
              ⚠ Flagged Overlaps ({flagged.length})
            </div>
            {flagged.map(m => (
              <div key={m.id} className="marker-item flagged" id={`flagged-${m.id}`}>
                <div className="marker-dot flagged" />
                <div className="marker-info">
                  <div className="marker-frame">Frame {m.frameNumber}</div>
                  <div className="marker-meta">{m.reason ?? 'Multiple faces detected'}</div>
                </div>
                <div className="marker-actions">
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
