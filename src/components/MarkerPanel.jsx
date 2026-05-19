import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { useMarkers } from '../hooks/useMarkers'

export default function MarkerPanel({ onClose }) {
  const { state, dispatch, toast } = useApp()
  const { markers, video, settings, selectedMarkerId } = state
  const { removeMarker, updateMarker, addMarker, selectMarker } = useMarkers()
  const [editingId, setEditingId] = useState(null)
  const [newMarkerFrame, setNewMarkerFrame] = useState('')

  const dotClass = (m) => m.flagged ? 'flagged' : m.autoDetected ? 'auto' : 'manual'

  const handleFrameEdit = (m, val) => {
    const frame = parseInt(val, 10)
    if (isNaN(frame)) return
    if (frame < 0 || frame >= video.totalFrames) {
      toast('Marker position out of bounds', 'error', 1800)
      return
    }
    updateMarker(m.id, { frameNumber: frame })
  }

  const handleWinEdit = (m, val) => {
    const v = parseInt(val, 10)
    updateMarker(m.id, { customTrmWin: isNaN(v) || v <= 0 ? null : (v % 2 === 0 ? v + 1 : v) })
  }

  const handleIntvEdit = (m, val) => {
    const v = parseInt(val, 10)
    updateMarker(m.id, { customTrmIntv: isNaN(v) || v <= 0 ? null : v })
  }

  const handleOverlapEdit = (m, key, val) => {
    const frame = parseInt(val, 10)
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
    const changes = { [key]: frame, reason: `Overlap ${startFrame}-${endFrame}` }
    if (key === 'overlapStartFrame') changes.frameNumber = frame
    updateMarker(m.id, changes)
  }

  const goToMarker = (m) => {
    selectMarker(m.id)
    dispatch({ type: 'SET_FRAME', payload: m.frameNumber })
    dispatch({ type: 'SET_PLAYING', payload: false })
  }

  const addMarkerAtFrame = () => {
    const frame = parseInt(newMarkerFrame, 10)
    if (isNaN(frame)) {
      toast('Enter a frame number', 'warning')
      return
    }
    const m = addMarker(frame)
    if (m) {
      selectMarker(m.id)
      setEditingId(m.id)
      setNewMarkerFrame('')
    }
  }

  const loadProject = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const json = JSON.parse(await file.text())
      dispatch({ type: 'LOAD_PROJECT', payload: json })
      toast('Project loaded successfully', 'success')
    } catch {
      toast('Failed to parse project JSON', 'error')
    }
    e.target.value = ''
  }

  return (
    <>
      <div className="panel-header">
        <span className="panel-title">Markers ({markers.length})</span>
        <button className="panel-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="panel-body">
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn"
            style={{ flex: 1, fontSize: 11 }}
            onClick={() => {
              if (video.file) {
                const m = addMarker(state.playback.currentFrame)
                if (m) {
                  selectMarker(m.id)
                  setEditingId(m.id)
                }
              }
            }}
            disabled={!video.file}
            id="marker-add-btn"
          >
            + Add Marker
          </button>
          <label className="btn" style={{ fontSize: 11, cursor: 'pointer' }} title="Load project JSON">
            📂 Load JSON
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={loadProject} />
          </label>
        </div>
        <div className="form-row">
          <span className="form-label">Add at frame</span>
          <input
            className="form-input"
            type="number"
            min={0}
            max={Math.max(0, video.totalFrames - 1)}
            value={newMarkerFrame}
            onChange={e => setNewMarkerFrame(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addMarkerAtFrame() }}
            disabled={!video.file}
          />
          <button
            className="btn"
            style={{ fontSize: 11, padding: '5px 8px' }}
            onClick={addMarkerAtFrame}
            disabled={!video.file}
          >
            Add
          </button>
        </div>

        {markers.length === 0 && (
          <div className="empty-state">
            No markers yet.<br />Use <span className="kbd">⌘ Shift M</span> or Run Detection.
          </div>
        )}

        {markers.map((m) => (
          <div
            key={m.id}
            className={`marker-item ${m.flagged ? 'flagged' : ''} ${selectedMarkerId === m.id ? 'selected' : ''}`}
            id={`marker-${m.id}`}
            onClick={() => selectMarker(m.id)}
          >
            <div className={`marker-dot ${dotClass(m)}`} />
            <div className="marker-info">
              <div className="marker-frame">Frame {m.frameNumber}</div>
              {m.reason && <div className="marker-meta">{m.reason}</div>}
              {m.flagged && <div className="marker-meta" style={{ color: 'var(--warning)' }}>⚠ Overlap flagged</div>}
              {editingId === m.id && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
                  <div className="form-row">
                    <span className="form-label">Frame #</span>
                    <input
                      className="form-input"
                      type="number"
                      defaultValue={m.frameNumber}
                      min={0}
                      max={video.totalFrames - 1}
                      onBlur={e => handleFrameEdit(m, e.target.value)}
                    />
                  </div>
                  {m.flagged && (
                    <>
                      <div className="form-row">
                        <span className="form-label">Overlap start</span>
                        <input
                          className="form-input"
                          type="number"
                          defaultValue={m.overlapStartFrame ?? m.frameNumber}
                          min={0}
                          max={video.totalFrames - 1}
                          onBlur={e => handleOverlapEdit(m, 'overlapStartFrame', e.target.value)}
                        />
                      </div>
                      <div className="form-row">
                        <span className="form-label">Overlap end</span>
                        <input
                          className="form-input"
                          type="number"
                          defaultValue={m.overlapEndFrame ?? m.frameNumber}
                          min={0}
                          max={video.totalFrames - 1}
                          onBlur={e => handleOverlapEdit(m, 'overlapEndFrame', e.target.value)}
                        />
                      </div>
                    </>
                  )}
                  <div className="form-row">
                    <span className="form-label">Trim win override</span>
                    <input
                      className="form-input"
                      type="number"
                      placeholder={settings.trmWin}
                      defaultValue={m.customTrmWin ?? ''}
                      min={1}
                      onBlur={e => handleWinEdit(m, e.target.value)}
                    />
                  </div>
                  <div className="form-row">
                    <span className="form-label">Trim intv override</span>
                    <input
                      className="form-input"
                      type="number"
                      placeholder={settings.trmIntv}
                      defaultValue={m.customTrmIntv ?? ''}
                      min={1}
                      onBlur={e => handleIntvEdit(m, e.target.value)}
                    />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    Leave blank to use global settings
                  </div>
                </div>
              )}
            </div>
            <div className="marker-actions">
              <button
                className="icon-btn"
                title="Jump to frame"
                onClick={() => goToMarker(m)}
                style={{ color: 'var(--accent)' }}
              >
                ⤷
              </button>
              <button
                className="icon-btn"
                title={editingId === m.id ? 'Close edit' : 'Edit'}
                onClick={() => setEditingId(editingId === m.id ? null : m.id)}
                style={{ color: 'var(--text-secondary)' }}
              >
                ✎
              </button>
              <button
                className="icon-btn"
                title="Delete marker"
                onClick={() => { removeMarker(m.id); if (editingId === m.id) setEditingId(null) }}
              >
                ✕
              </button>
            </div>
          </div>
        ))}

        {markers.length > 0 && (
          <button
            className="btn btn-danger"
            style={{ width: '100%', marginTop: 4, fontSize: 11 }}
            onClick={() => { dispatch({ type: 'SET_MARKERS', payload: [] }); toast('All markers cleared', 'info') }}
          >
            Clear All Markers
          </button>
        )}
      </div>
    </>
  )
}
