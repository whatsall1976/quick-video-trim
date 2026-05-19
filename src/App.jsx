import { useRef, useCallback, useState } from 'react'
import { AppProvider, useApp } from './context/AppContext'
import { useVideoPlayback } from './hooks/useVideoPlayback'
import { useMarkers } from './hooks/useMarkers'
import VideoPlayer from './components/VideoPlayer'
import Timeline from './components/Timeline'
import ControlBar from './components/ControlBar'
import MarkerPanel from './components/MarkerPanel'
import DetectorPanel from './components/DetectorPanel'
import SettingsPanel from './components/SettingsPanel'
import { exportVideo, downloadBlob, createProjectJsonBlob } from './utils/videoExport'

function AppInner() {
  const { state, dispatch, toast } = useApp()
  const { activePanel, video, trimSegments, settings, isExporting, exportProgress, exportMessage, toasts } = state
  const [showExportModal, setShowExportModal] = useState(false)

  const videoRef = useRef(null)
  const canvasRef = useRef(null)

  // Activate playback hook (keyboard shortcuts, RAF loop)
  useVideoPlayback(videoRef)
  useMarkers({ enableShortcuts: true }) // Activate marker keyboard shortcuts

  const togglePanel = useCallback((key) => {
    dispatch({ type: 'SET_ACTIVE_PANEL', payload: key })
  }, [dispatch])

  const closePanel = useCallback(() => {
    dispatch({ type: 'CLOSE_PANEL' })
  }, [dispatch])

  const openExportModal = useCallback(() => {
    if (!video.file) { toast('No video loaded', 'warning'); return }
    setShowExportModal(true)
  }, [video.file, toast])

  const closeExportModal = useCallback(() => {
    if (!isExporting) setShowExportModal(false)
  }, [isExporting])

  const handleExport = useCallback(async ({ includeVideo, includeJson }) => {
    if (!video.file) { toast('No video loaded', 'warning'); return }
    if (!includeVideo && !includeJson) return

    const baseName = video.file.name.replace(/\.[^.]+$/, '')
    setShowExportModal(false)

    if (!includeVideo) {
      const jsonBlob = createProjectJsonBlob(video.file, trimSegments, video, settings.audioMode)
      downloadBlob(jsonBlob, `${baseName}_project.json`)
      toast('Project JSON downloaded.', 'success', 4000)
      return
    }

    dispatch({ type: 'SET_EXPORTING', payload: true })
    dispatch({ type: 'SET_EXPORT_PROGRESS', payload: { progress: 0, message: 'Starting…' } })

    try {
      const { videoBlob, jsonBlob } = await exportVideo(
        video.file,
        trimSegments,
        video,
        settings.audioMode,
        ({ progress, message }) => dispatch({ type: 'SET_EXPORT_PROGRESS', payload: { progress: Math.round(progress * 100), message } })
      )

      downloadBlob(videoBlob, `${baseName}_trimmed.mp4`)
      if (includeJson) downloadBlob(jsonBlob, `${baseName}_project.json`)
      toast(includeJson ? 'Export complete! Files downloaded.' : 'Video export complete.', 'success', 5000)
    } catch (err) {
      console.error(err)
      toast(`Export failed: ${err.message}`, 'error', 8000)
    } finally {
      dispatch({ type: 'SET_EXPORTING', payload: false })
    }
  }, [video, trimSegments, settings, dispatch, toast])

  const PANELS = { V: ControlBar, M: MarkerPanel, D: DetectorPanel, S: SettingsPanel }
  const PANEL_LABELS = { V: 'Controls', M: 'Markers', D: 'Detect', S: 'Settings' }
  const ActivePanel = activePanel ? PANELS[activePanel] : null

  return (
    <div className="app">
      {/* Main area */}
      <div className="main-area">
        {/* Sidebar toggle strip */}
        <div className="sidebar-strip">
          {Object.entries(PANELS).map(([key]) => (
            <button
              key={key}
              className={`strip-btn ${activePanel === key ? 'active' : ''}`}
              onClick={() => togglePanel(key)}
              title={PANEL_LABELS[key]}
              id={`panel-btn-${key.toLowerCase()}`}
            >
              {key}
            </button>
          ))}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Export button at bottom of strip */}
          <button
            className="strip-btn"
            style={{
              background: video.file ? 'var(--accent)' : undefined,
              borderColor: video.file ? 'var(--accent)' : undefined,
              color: video.file ? '#fff' : undefined,
              fontSize: 11, height: 48, width: 40,
              lineHeight: 1.2,
            }}
            onClick={openExportModal}
            disabled={!video.file || isExporting}
            title="Export"
            id="export-btn"
          >
            {isExporting ? '…' : '⬇︎'}
          </button>
        </div>

        {/* Video area with optional panel overlay */}
        <div className="video-area">
          <VideoPlayer videoRef={videoRef} canvasRef={canvasRef} />

          {ActivePanel && (
            <div className="panel-overlay" onClick={(e) => { if (e.target === e.currentTarget) closePanel() }}>
              <div className="panel-modal">
                <ActivePanel
                  videoRef={videoRef}
                  onClose={closePanel}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Timeline */}
      <Timeline />

      {/* Export choice modal */}
      {showExportModal && (
        <div className="export-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeExportModal() }}>
          <div className="export-choice-card" role="dialog" aria-modal="true" aria-labelledby="export-choice-title">
            <div className="export-choice-header">
              <div>
                <div className="export-choice-title" id="export-choice-title">Export</div>
                <div className="export-choice-subtitle">Choose what to download.</div>
              </div>
              <button className="icon-btn" type="button" onClick={closeExportModal} aria-label="Close export options">
                ×
              </button>
            </div>
            <div className="export-choice-actions">
              <button type="button" className="export-choice-btn" onClick={() => handleExport({ includeVideo: false, includeJson: true })}>
                <span className="export-choice-icon">JSON</span>
                <span>
                  <strong>Project JSON</strong>
                  <small>Download trim metadata only.</small>
                </span>
              </button>
              <button type="button" className="export-choice-btn" onClick={() => handleExport({ includeVideo: true, includeJson: false })}>
                <span className="export-choice-icon">MP4</span>
                <span>
                  <strong>Video</strong>
                  <small>Render and download the trimmed video.</small>
                </span>
              </button>
              <button type="button" className="export-choice-btn primary" onClick={() => handleExport({ includeVideo: true, includeJson: true })}>
                <span className="export-choice-icon">ALL</span>
                <span>
                  <strong>Video + JSON</strong>
                  <small>Render video and save project metadata.</small>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export overlay */}
      {isExporting && (
        <div className="export-overlay">
          <div className="export-card">
            <div className="export-title">⏳ Exporting Video…</div>
            <div className="export-msg">{exportMessage}</div>
            <div className="progress-bar-wrap">
              <div className="progress-bar-fill" style={{ width: `${exportProgress}%` }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
              {exportProgress}%
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  )
}
