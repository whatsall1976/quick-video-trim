import { useApp } from '../context/AppContext'
import { useMarkers } from '../hooks/useMarkers'
import { useYOLODetection } from '../hooks/useYOLODetection'

export default function DetectorPanel({ videoRef, onClose }) {
  const { state, dispatch, toast } = useApp()
  const { isDetecting, detectionProgress, detectionResults, markers, video, selectedMarkerId, settings } = state
  const { runDetectionPipeline } = useYOLODetection(videoRef)
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
    toast('Flagged overlap markers removed', 'info', 1500)
  }

  const removeAllAuto = () => {
    dispatch({ type: 'SET_MARKERS', payload: markers.filter(m => !m.autoDetected) })
    toast('Auto-detected markers removed', 'info', 1500)
  }

  const { thresholdCrossings = [], sizeJumps = [], movements = [], overlaps = [] } = detectionResults
  const details = detectionResults.details
  const hasRunResults = Array.isArray(detectionResults.frameRange)
  const hasDetectionResults = hasRunResults || thresholdCrossings.length > 0 || sizeJumps.length > 0 || movements.length > 0 || overlaps.length > 0
  const pct = (value) => Number.isFinite(value) ? `${Math.round(value)}%` : '-'
  const ratioPct = (value) => Number.isFinite(value) ? `${Math.round(value * 100)}%` : '-'
  const goToFrame = (frameNumber) => {
    dispatch({ type: 'SET_FRAME', payload: frameNumber })
    dispatch({ type: 'SET_PLAYING', payload: false })
  }
  const detailRowStyle = {
    fontSize: 11,
    color: 'var(--text-secondary)',
    padding: '6px 8px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    lineHeight: 1.5,
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
            onClick={() => runDetectionPipeline({ mode: 'test' })}
            disabled={!video.file || isDetecting}
            id="test-detection-btn"
          >
            {isDetecting ? `Detecting ${detectionProgress}%` : 'Test Run'}
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => runDetectionPipeline({ mode: 'full' })}
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

        {!isDetecting && thresholdCrossings.length === 0 && sizeJumps.length === 0 && movements.length === 0 && !video.file && (
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
            {details && (
              <>
                <div className="section-divider">Detection Details</div>
                <div style={{ ...detailRowStyle, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>Samples: {detectionResults.scannedFrames}</div>
                  <div>Step: {details.sampleStep} frames</div>
                  <div>Detected: {details.detectedFrames}</div>
                  <div>Missing: {details.missingFrames}</div>
                  <div>Candidate frames: {details.framesWithCandidates}</div>
                  <div>Overlap frames: {details.framesWithOverlaps}</div>
                  <div>Conf min/avg/max: {pct(details.confidence?.min)}/{pct(details.confidence?.avg)}/{pct(details.confidence?.max)}</div>
                  <div>Quality threshold: {pct(details.thresholds?.qualityThreshold)}</div>
                </div>
              </>
            )}

            {thresholdCrossings.length > 0 && (
              <>
                <div className="section-divider">Face Event Frames</div>
                {thresholdCrossings.map((event, index) => (
                  <div key={`${event.type}-${event.frameNumber}-${index}`} style={detailRowStyle}>
                    <button className="icon-btn" style={{ float: 'right' }} onClick={() => goToFrame(event.frameNumber)} title="Jump to frame">⤷</button>
                    Frame {event.frameNumber}: {event.direction} / {event.type}, confidence {pct(event.previousConfidence)} to {pct(event.confidence)}, threshold {pct(event.threshold)}
                  </div>
                ))}
              </>
            )}

            {sizeJumps.length > 0 && (
              <>
                <div className="section-divider">Size Jump Frames</div>
                {sizeJumps.map((jump, index) => (
                  <div key={`${jump.frameNumber}-${index}`} style={detailRowStyle}>
                    <button className="icon-btn" style={{ float: 'right' }} onClick={() => goToFrame(jump.frameNumber)} title="Jump to frame">⤷</button>
                    Frame {jump.frameNumber}: {pct(jump.percentChange)} area change, {jump.previousArea} to {jump.area}, threshold {pct(jump.threshold)}
                  </div>
                ))}
              </>
            )}

            {movements.length > 0 && (
              <>
                <div className="section-divider">Movement Frames</div>
                {movements.map((move, index) => (
                  <div key={`${move.frameNumber}-${index}`} style={detailRowStyle}>
                    <button className="icon-btn" style={{ float: 'right' }} onClick={() => goToFrame(move.frameNumber)} title="Jump to frame">⤷</button>
                    Frame {move.frameNumber}: {pct(move.percentDisplacement)} movement, {move.displacementPixels}px / {move.faceWidth}px face width, threshold {pct(move.threshold)}
                  </div>
                ))}
              </>
            )}

            {overlaps.length > 0 && (
              <>
                <div className="section-divider">Overlap Ranges</div>
                {overlaps.map((overlap, index) => (
                  <div key={`${overlap.frameRange?.[0]}-${index}`} style={detailRowStyle}>
                    <button className="icon-btn" style={{ float: 'right' }} onClick={() => goToFrame(overlap.frameRange[0])} title="Jump to frame">⤷</button>
                    Frames {overlap.frameRange[0]}-{overlap.frameRange[1]}: {overlap.sampleCount ?? overlap.frames?.length ?? 0} samples, max IoU {ratioPct(overlap.maxIou)}, small-face coverage {ratioPct(overlap.maxSmallFaceCoverage)}, center separation {ratioPct(overlap.maxCenterSeparation)}
                  </div>
                ))}
              </>
            )}

            {details?.samples?.length > 0 && (
              <>
                <div className="section-divider">Sample Frames</div>
                <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {details.samples.map(sample => (
                    <div key={sample.frameNumber} style={detailRowStyle}>
                      <button className="icon-btn" style={{ float: 'right' }} onClick={() => goToFrame(sample.frameNumber)} title="Jump to frame">⤷</button>
                      Frame {sample.frameNumber}: conf {pct(sample.confidence)}, faces {sample.detectedFaces}, candidates {sample.candidates}
                      {sample.overlap && `, overlap IoU ${pct(sample.overlapIou)}, coverage ${pct(sample.overlapSmallFaceCoverage)}, separation ${pct(sample.overlapCenterSeparation)}`}
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
