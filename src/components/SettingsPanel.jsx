import { useApp } from '../context/AppContext'

const TRIM_FIELDS = [
  { key: 'trmWin',  label: 'Trim Window (frames, odd)', type: 'number', min: 1 },
  { key: 'trmIntv', label: 'Trim Interval (frames)',    type: 'number', min: 1 },
]

const QUALITY_GATES_FIELDS = [
  { key: 'transnetThreshold',  label: 'TransNet Threshold %', type: 'number', min: 0, max: 100 },
  { key: 'maxFaceYaw',         label: 'Max Face Yaw (degrees)', type: 'number', min: 0 },
  { key: 'maxFacePitch',       label: 'Max Face Pitch (degrees)', type: 'number', min: 0 },
  { key: 'maxFaceRoll',        label: 'Max Face Roll (degrees)', type: 'number', min: 0 },
  { key: 'occlusionThreshold', label: 'Occlusion Threshold %', type: 'number', min: 0, max: 100 },
]

const DEFAULT_SETTINGS = {
  trmWin: 31,
  trmIntv: 90,
  detectionTestSeconds: 10,
  detectionTestStartFrame: 0,
  detectionTestEndFrame: null,
  detectionModels: {
    transnetv2: true,
    faceLandmarker: true,
    occlusion: true,
  },
  transnetThreshold: 50,
  maxFaceYaw: 30,
  maxFacePitch: 20,
  maxFaceRoll: 20,
  occlusionThreshold: 50,
  audioMode: 'SYNC',
}

export default function SettingsPanel({ onClose }) {
  const { state, dispatch } = useApp()
  const { settings, trimSegments } = state

  const update = (key, raw) => {
    let val = raw
    if (key === 'trmWin') {
      val = parseInt(raw, 10)
      if (isNaN(val) || val < 1) return
      if (val % 2 === 0) val += 1 // enforce odd
    } else if (key !== 'audioMode') {
      val = parseFloat(raw)
      if (isNaN(val)) return
    }
    dispatch({ type: 'UPDATE_SETTINGS', payload: { [key]: val } })
  }

  const updateDetectionModel = (model) => {
    const currentModels = settings.detectionModels || {}
    dispatch({
      type: 'UPDATE_SETTINGS',
      payload: {
        detectionModels: { ...currentModels, [model]: !currentModels[model] }
      }
    })
  }

  return (
    <>
      <div className="panel-header">
        <span className="panel-title">Settings</span>
        <button className="panel-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="panel-body">
        <div className="section-divider">Trim Parameters</div>
        {FIELDS.slice(0, 2).map(f => (
          <div key={f.key} className="form-row">
            <label className="form-label" htmlFor={`setting-${f.key}`}>{f.label}</label>
            <input
              id={`setting-${f.key}`}
              className="form-input"
              type="number"
              value={settings[f.key]}
              min={f.min}
              max={f.max}
              onChange={e => update(f.key, e.target.value)}
            />
          </div>
        ))}

        <div className="section-divider">Detection Thresholds</div>
        {FIELDS.slice(2).map(f => (
          <div key={f.key} className="form-row">
            <label className="form-label" htmlFor={`setting-${f.key}`}>{f.label}</label>
            <input
              id={`setting-${f.key}`}
              className="form-input"
              type="number"
              value={settings[f.key]}
              min={f.min}
              max={f.max}
              onChange={e => update(f.key, e.target.value)}
            />
          </div>
        ))}

        <div className="section-divider">Overlap Detection</div>
        {OVERLAP_FIELDS.map(f => (
          <div key={f.key} className="form-row">
            <label className="form-label" htmlFor={`setting-${f.key}`}>{f.label}</label>
            <input
              id={`setting-${f.key}`}
              className="form-input"
              type="number"
              value={settings[f.key]}
              min={f.min}
              max={f.max}
              onChange={e => update(f.key, e.target.value)}
            />
          </div>
        ))}
        <button
          className="btn"
          style={{ width: '100%', fontSize: 11 }}
          onClick={snapshotOverlapSettings}
          disabled={!video.file || !selectedMarker || isDetecting}
          title={selectedMarker ? `Use selected marker at frame ${selectedMarker.frameNumber}` : 'Select or add an overlap marker first'}
        >
          {isDetecting && snapshotProgress > 0
            ? `Snapshotting ${snapshotProgress}%`
            : `Snapshot From ${selectedMarker ? `Frame ${selectedMarker.frameNumber}` : 'Selected Marker'}`}
        </button>
        {lastSnapshot && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
            <div>Snapshot frames {lastSnapshot.frameRange[0]}-{lastSnapshot.frameRange[1]}, {lastSnapshot.samples.length}/{lastSnapshot.scannedFrames} overlap samples.</div>
            {lastSnapshot.metrics && (
              <div>
                IoU {pct(lastSnapshot.metrics.minIou)}-{pct(lastSnapshot.metrics.maxIou)}, coverage {pct(lastSnapshot.metrics.minSmallFaceCoverage)}-{pct(lastSnapshot.metrics.maxSmallFaceCoverage)}, separation {pct(lastSnapshot.metrics.minCenterSeparation)}-{pct(lastSnapshot.metrics.maxCenterSeparation)}.
              </div>
            )}
          </div>
        )}

        <div className="section-divider">Audio Mode</div>
        <div className="form-row">
          <label className="form-label" htmlFor="setting-audioMode">Audio Mode</label>
          <select
            id="setting-audioMode"
            className="form-select"
            value={settings.audioMode}
            onChange={e => update('audioMode', e.target.value)}
          >
            <option value="SYNC">SYNC (fades)</option>
            <option value="Mute">Mute</option>
            <option value="Separate">Separate (music)</option>
          </select>
        </div>

        {/* Mode descriptions */}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7, padding: '2px 0' }}>
          {settings.audioMode === 'SYNC' && '▸ Audio synced with video. Fade in/out at segment boundaries to prevent clicks.'}
          {settings.audioMode === 'Mute' && '▸ Output video will have no audio track.'}
          {settings.audioMode === 'Separate' && '▸ Original audio applied to full output video (ignores trim). 5-second fade out at end.'}
        </div>

        {/* Live trim summary */}
        {trimSegments.length > 0 && (
          <>
            <div className="section-divider">Active Trim Segments ({trimSegments.length})</div>
            {trimSegments.map((seg, i) => (
              <div key={i} style={{
                fontSize: 11, color: 'var(--text-secondary)',
                display: 'flex', justifyContent: 'space-between',
                padding: '3px 6px', background: 'var(--bg-elevated)',
                borderRadius: 'var(--radius-sm)', border: '1px solid var(--danger-dim)',
              }}>
                <span style={{ color: 'var(--danger)' }}>■</span>
                <span>Frames {seg.startFrame}–{seg.endFrame}</span>
                <span style={{ color: 'var(--text-muted)' }}>{seg.endFrame - seg.startFrame + 1} fr</span>
              </div>
            ))}
          </>
        )}

        <button
          className="btn"
          style={{ width: '100%', marginTop: 4, fontSize: 11 }}
          onClick={() => dispatch({ type: 'UPDATE_SETTINGS', payload: DEFAULT_SETTINGS })}
        >
          Reset to Defaults
        </button>
      </div>
    </>
  )
}
