import { useApp } from '../context/AppContext'

const FIELDS = [
  { key: 'trmWin',               label: 'Trim Window (frames, odd)',   type: 'number', min: 1 },
  { key: 'trmIntv',              label: 'Trim Interval (frames)',       type: 'number', min: 1 },
  { key: 'confidenceThreshold',  label: 'Face Confidence Threshold %', type: 'number', min: 0, max: 100 },
  { key: 'sizeJumpThreshold',    label: 'Size Jump Threshold %',        type: 'number', min: 0, max: 100 },
  { key: 'faceMovementThreshold',label: 'Face Movement Threshold %',   type: 'number', min: 0, max: 100 },
  { key: 'qualityThreshold',     label: 'Quality Drop Threshold %',    type: 'number', min: 0, max: 100 },
]

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
          onClick={() => dispatch({ type: 'UPDATE_SETTINGS', payload: {
            trmWin: 31, trmIntv: 90, confidenceThreshold: 50,
            sizeJumpThreshold: 10, faceMovementThreshold: 30, qualityThreshold: 50,
          }})}
        >
          Reset to Defaults
        </button>
      </div>
    </>
  )
}
