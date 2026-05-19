import { useApp } from '../context/AppContext'
import { useMarkers } from '../hooks/useMarkers'
import { useQualityDetection } from '../hooks/useQualityDetection'

export default function DetectorPanel({ videoRef, onClose }) {
  const { state, dispatch, toast } = useApp()
  const { isDetecting, detectionProgress, detectionResults, markers, video, selectedMarkerId, settings } = state
  const { runDetectionPipeline } = useQualityDetection(videoRef)
  const { updateMarker, selectMarker } = useMarkers()

  const flagged = markers.filter(m => m.flagged)
  const auto = markers.filter(m => m.autoDetected)
  const maxFrame = Math.max(0, (video.totalFrames || 0) - 1)
  const testStartFrame = Number.isFinite(settings.detectionTestStartFrame) ? settings.detectionTestStartFrame : 0
  const defaultTestEndFrame = Math.min(
    maxFrame,
    testStartFrame + Math.max(1, Math.round((settings.detectionTestSeconds ?? 10) * (video.fps || 30))) - 1
  )
  const testEndFrame = Number.isFinite(settings.detectionTestEndFrame) ? settings.detectionTestEndFrame : defaultTestEndFrame

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

  const updateTestFrame = (key, value) => {
    if (value === '' && key === 'detectionTestEndFrame') {
      dispatch({ type: 'UPDATE_SETTINGS', payload: { [key]: null } })
      return
    }

    const frame = parseInt(value, 10)
    if (isNaN(frame)) return
    if (frame < 0 || frame > maxFrame) {
      toast('Test frame out of bounds', 'error', 1800)
      return
    }
    dispatch({ type: 'UPDATE_SETTINGS', payload: { [key]: frame } })
  }

  const setTestEndToDefault = () => {
    dispatch({ type: 'UPDATE_SETTINGS', payload: { detectionTestEndFrame: defaultTestEndFrame } })
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
    toast('Flagged markers removed', 'info', 1500)
  }

  const removeAllAuto = () => {
    dispatch({ type: 'SET_MARKERS', payload: markers.filter(m => !m.autoDetected) })
    toast('Auto-detected markers removed', 'info', 1500)
  }

  const { modelRuns = [], rejectedRanges = [] } = detectionResults
  const hasRunResults = Array.isArray(detectionResults.frameRange)
  const hasDetectionResults = hasRunResults || rejectedRanges.length > 0
  const goToFrame = (frameNumber) => {
    dispatch({ type: 'SET_FRAME', payload: frameNumber })
    dispatch({ type: 'SET_PLAYING', payload: false })
  }
  const statusColor = (status) => {
    if (status === 'ok') return 'var(--success)'
    if (status === 'missing') return 'var(--warning)'
    if (status === 'error') return 'var(--danger)'
    return 'var(--text-secondary)'
  }
  const rangeRowStyle = {
    fontSize: 11,
    color: 'var(--text-secondary)',
    padding: '8px 10px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    transition: 'all 0.2s',
  }

  return (
    <>
      <div className="panel-header">
        <span className="panel-title">Face Detection</span>
        <button className="panel-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="panel-body">
        <div className="section-divider">Test Run Range</div>
        <div className="form-row">
          <label className="form-label" htmlFor="test-start-frame">Start frame</label>
          <input
            id="test-start-frame"
            className="form-input"
            type="number"
            min={0}
            max={maxFrame}
            value={testStartFrame}
            onChange={e => updateTestFrame('detectionTestStartFrame', e.target.value)}
            disabled={!video.file || isDetecting}
          />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="test-end-frame">End frame</label>
          <input
            id="test-end-frame"
            className="form-input"
            type="number"
            min={0}
            max={maxFrame}
            value={testEndFrame}
            onChange={e => updateTestFrame('detectionTestEndFrame', e.target.value)}
            disabled={!video.file || isDetecting}
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn"
            style={{ flex: 1, fontSize: 11 }}
            onClick={setTestEndToDefault}
            disabled={!video.file || isDetecting}
          >
            Default 10s End
          </button>
          <button
            className="btn"
            style={{ flex: 1, fontSize: 11 }}
            onClick={() => dispatch({
              type: 'UPDATE_SETTINGS',
              payload: { detectionTestStartFrame: Math.min(state.playback.currentFrame, maxFrame), detectionTestEndFrame: null },
            })}
            disabled={!video.file || isDetecting}
          >
            Start at Current
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn"
            style={{ flex: 1 }}
            onClick={() => runDetectionPipeline('test')}
            disabled={!video.file || isDetecting}
            id="test-detection-btn"
          >
            {isDetecting ? `Detecting ${detectionProgress}%` : 'Test Run'}
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => runDetectionPipeline('full')}
            disabled={!video.file || isDetecting}
            id="run-detection-btn"
          >
            {isDetecting ? `Detecting ${detectionProgress}%` : 'Real Run'}
          </button>
        </div>

        {isDetecting && (
          <div>
            <div className="progress-bar-wrap">
              <div className="progress-bar-fill" style={{ width: `${detectionProgress}%` }} />
            </div>
            <div className="detection-status">{detectionProgress}% complete</div>
          </div>
        )}

        {!isDetecting && rejectedRanges.length === 0 && !video.file && (
          <div className="empty-state">Load a video then click Run Detection to auto-place markers.</div>
        )}

        {hasDetectionResults && (
          <>
            <div className="section-divider">Detection Results</div>
            {Array.isArray(detectionResults.frameRange) && (
              <div className="detection-status">
                {detectionResults.runMode === 'test' ? 'Test' : 'Real'} run frames {detectionResults.frameRange[0]}-{detectionResults.frameRange[1]}
              </div>
            )}

            {/* Model Status Cards */}
            {modelRuns.length > 0 && (
              <>
                <div className="section-divider">Model Status</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {modelRuns.map((model) => {
                    const rangeCount = (model.rejectedRanges || []).length
                    const status = model.summary?.status || 'ok'
                    return (
                      <div
                        key={model.key}
                        style={{
                          padding: '8px 10px',
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={model.enabled}
                          disabled={true}
                          style={{ cursor: 'default' }}
                        />
                        <div style={{ flex: 1, fontSize: 12 }}>
                          <div style={{ fontWeight: 500 }}>{model.label}</div>
                          <div style={{ fontSize: 10, color: statusColor(status), fontWeight: 500 }}>
                            {status.toUpperCase()}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {rangeCount} {rangeCount === 1 ? 'range' : 'ranges'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {/* Rejected Ranges List */}
            {rejectedRanges.length > 0 && (
              <>
                <div className="section-divider">Rejected Ranges ({rejectedRanges.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                  {rejectedRanges.map((range, idx) => (
                    <div
                      key={`${range.startFrame}-${range.endFrame}-${idx}`}
                      style={{
                        ...rangeRowStyle,
                        '&:hover': { background: 'var(--bg-elevated)', opacity: 0.8 },
                      }}
                      onClick={() => goToFrame(range.startFrame)}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--bg-hover)'
                        e.currentTarget.style.borderColor = 'var(--border-active)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--bg-elevated)'
                        e.currentTarget.style.borderColor = 'var(--border)'
                      }}
                    >
                      <button
                        className="icon-btn"
                        style={{ float: 'right', fontSize: 12 }}
                        onClick={(e) => {
                          e.stopPropagation()
                          goToFrame(range.startFrame)
                        }}
                        title="Jump to frame"
                      >
                        ⤷
                      </button>
                      <div style={{ fontSize: 11, fontWeight: 500 }}>
                        Frame {range.startFrame}-{range.endFrame}
                      </div>
                      <div style={{ fontSize: 10, marginTop: 3 }}>
                        {range.reason}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                        source: {range.source} {Number.isFinite(range.score) ? `[${range.score.toFixed(2)}]` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
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

        {/* Flagged marker review */}
        {flagged.length > 0 && (
          <>
            <div className="section-divider" style={{ color: 'var(--warning)' }}>
              ⚠ Flagged Markers ({flagged.length})
            </div>
            <button
              className="btn btn-danger"
              style={{ width: '100%', fontSize: 11 }}
              onClick={removeAllFlagged}
            >
              Remove All Flagged Markers
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
                  <div className="marker-meta">{m.reason ?? 'Quality issue detected'}</div>
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
                    Keep
                  </button>
                  <button
                    className="btn"
                    style={{ fontSize: 11, padding: '3px 8px', color: 'var(--danger)', borderColor: 'var(--danger)' }}
                    onClick={() => { removeMarker(m.id); toast(`Marker removed`, 'info', 1200) }}
                    title="Remove marker"
                  >
                    Remove
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
