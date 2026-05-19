import { useApp } from '../context/AppContext'
import { useMarkers } from '../hooks/useMarkers'

export default function ControlBar({ onClose }) {
  const { state, dispatch } = useApp()
  const { playback, video } = state
  const { addMarker } = useMarkers()

  const SPEEDS = [1, 2, 4, 6, 8, 10]
  const speedIdx = SPEEDS.indexOf(playback.playbackSpeed)

  const setSpeed = (spd) => dispatch({ type: 'SET_SPEED', payload: spd })
  const togglePlay = () => dispatch({ type: 'SET_PLAYING', payload: !playback.isPlaying })

  return (
    <>
      <div className="panel-header">
        <span className="panel-title">Playback Controls</span>
        <button className="panel-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="panel-body">
        {/* Play/Pause */}
        <div className="ctrl-row">
          <button
            className="btn btn-primary"
            onClick={togglePlay}
            disabled={!video.file}
            id="play-pause-btn"
            style={{ flex: 1 }}
          >
            {playback.isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>
          <span className="speed-badge">{playback.playbackSpeed}×</span>
        </div>

        {/* Speed Selector */}
        <div className="section-divider">Speed</div>
        <div className="ctrl-row" style={{ flexWrap: 'wrap' }}>
          {SPEEDS.map(s => (
            <button
              key={s}
              className={`btn ${playback.playbackSpeed === s ? 'btn-primary' : ''}`}
              style={{ flex: '1 0 30%', fontSize: 12 }}
              onClick={() => setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>

        {/* Add Marker */}
        <div className="section-divider">Markers</div>
        <button
          className="btn"
          onClick={() => {
            if (video.file) addMarker(playback.currentFrame)
          }}
          disabled={!video.file}
          id="add-marker-btn"
          style={{ width: '100%' }}
        >
          + Add Marker at Frame {playback.currentFrame}
        </button>

        {/* Keyboard reference */}
        <div className="section-divider">Keyboard Shortcuts</div>
        <table className="kbd-table">
          <tbody>
            {[
              ['Play / Pause', 'Space'],
              ['Next frame', '→'],
              ['Prev frame', '←'],
              ['Jump fwd (accel)', 'Shift + →'],
              ['Jump back (accel)', 'Shift + ←'],
              ['Speed up (playing)', 'Shift + →'],
              ['Slow down (playing)', 'Shift + ←'],
              ['Add marker', '⌘ Shift M'],
            ].map(([label, key]) => (
              <tr key={label}>
                <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{label}</td>
                <td style={{ textAlign: 'right' }}><span className="kbd">{key}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
