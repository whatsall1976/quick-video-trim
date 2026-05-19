import { useApp } from '../context/AppContext'

const TRIM_FIELDS = [
  { key: 'trmWin',  label: 'Trim Window (frames, odd)', type: 'number', min: 1 },
  { key: 'trmIntv', label: 'Trim Interval (frames)',    type: 'number', min: 1 },
]

const QUALITY_GATES_FIELDS = [
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
    faceLandmarker: true,
    occlusion: true,
  },
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
        <div className="section-divider">Trim</div>
        {TRIM_FIELDS.map(f => (
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

        <div className="section-divider">Audio</div>
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

        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7, padding: '2px 0' }}>
          {settings.audioMode === 'SYNC' && '▸ Audio synced with video. Fade in/out at segment boundaries to prevent clicks.'}
          {settings.audioMode === 'Mute' && '▸ Output video will have no audio track.'}
          {settings.audioMode === 'Separate' && '▸ Original audio applied to full output video (ignores trim). 5-second fade out at end.'}
        </div>

        <div className="section-divider">Quality Gates</div>

        <div style={{ marginBottom: '8px' }}>
          <div className="form-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.detectionModels?.faceLandmarker ?? true}
                onChange={() => updateDetectionModel('faceLandmarker')}
              />
              <span className="form-label" style={{ margin: 0 }}>Face Landmarker</span>
            </label>
          </div>
          <div className="form-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.detectionModels?.occlusion ?? true}
                onChange={() => updateDetectionModel('occlusion')}
              />
              <span className="form-label" style={{ margin: 0 }}>Occlusion Detector</span>
            </label>
          </div>
        </div>

        {QUALITY_GATES_FIELDS.map(f => (
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
