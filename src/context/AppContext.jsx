import { createContext, useContext, useReducer, useCallback, useRef } from 'react'

const AppContext = createContext(null)

const initialState = {
  video: { file: null, duration: 0, fps: 30, width: 0, height: 0, totalFrames: 0 },
  playback: { currentFrame: 0, isPlaying: false, playbackSpeed: 1 },
  markers: [],
  detectionResults: { faces: [], overlaps: [], thresholdCrossings: [], sizeJumps: [], movements: [] },
  settings: {
    trmWin: 31,
    trmIntv: 90,
    confidenceThreshold: 50,
    sizeJumpThreshold: 10,
    faceMovementThreshold: 30,
    qualityThreshold: 50,
    audioMode: 'SYNC',
  },
  trimSegments: [],
  activePanel: null, // 'V' | 'M' | 'D' | 'S' | null
  toasts: [],
  isExporting: false,
  exportProgress: 0,
  exportMessage: '',
  detectionProgress: 0,
  isDetecting: false,
}

function calcTrimSegments(markers, settings) {
  if (!markers.length) return []
  const { trmWin, trmIntv } = settings
  const half = Math.floor(trmWin / 2)

  // Build raw windows per marker
  const windows = markers
    .map(m => {
      const w = m.customTrmWin ?? trmWin
      const h = Math.floor(w / 2)
      return { startFrame: m.frameNumber - h, endFrame: m.frameNumber + h, markerId: m.id, reason: 'marker' }
    })
    .sort((a, b) => a.startFrame - b.startFrame)

  // Merge based on trmIntv gaps
  const merged = []
  for (const win of windows) {
    if (!merged.length) { merged.push({ ...win }); continue }
    const prev = merged[merged.length - 1]
    const gap = win.startFrame - prev.endFrame
    const intv = prev.customTrmIntv ?? trmIntv
    if (gap < intv) {
      prev.endFrame = Math.max(prev.endFrame, win.endFrame)
    } else {
      merged.push({ ...win })
    }
  }
  return merged
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_VIDEO':
      return { ...state, video: { ...state.video, ...action.payload }, markers: [], trimSegments: [], playback: { ...state.playback, currentFrame: 0, isPlaying: false } }

    case 'SET_FRAME':
      return { ...state, playback: { ...state.playback, currentFrame: action.payload } }

    case 'SET_PLAYING':
      return { ...state, playback: { ...state.playback, isPlaying: action.payload } }

    case 'SET_SPEED':
      return { ...state, playback: { ...state.playback, playbackSpeed: action.payload } }

    case 'ADD_MARKER': {
      const markers = [...state.markers, action.payload].sort((a, b) => a.frameNumber - b.frameNumber)
      return { ...state, markers, trimSegments: calcTrimSegments(markers, state.settings) }
    }

    case 'REMOVE_MARKER': {
      const markers = state.markers.filter(m => m.id !== action.payload)
      return { ...state, markers, trimSegments: calcTrimSegments(markers, state.settings) }
    }

    case 'UPDATE_MARKER': {
      const markers = state.markers.map(m => m.id === action.payload.id ? { ...m, ...action.payload } : m)
        .sort((a, b) => a.frameNumber - b.frameNumber)
      return { ...state, markers, trimSegments: calcTrimSegments(markers, state.settings) }
    }

    case 'SET_MARKERS': {
      const markers = [...action.payload].sort((a, b) => a.frameNumber - b.frameNumber)
      return { ...state, markers, trimSegments: calcTrimSegments(markers, state.settings) }
    }

    case 'UPDATE_SETTINGS': {
      const settings = { ...state.settings, ...action.payload }
      return { ...state, settings, trimSegments: calcTrimSegments(state.markers, settings) }
    }

    case 'SET_DETECTION_RESULTS':
      return { ...state, detectionResults: action.payload }

    case 'SET_ACTIVE_PANEL':
      return { ...state, activePanel: state.activePanel === action.payload ? null : action.payload }

    case 'CLOSE_PANEL':
      return { ...state, activePanel: null }

    case 'ADD_TOAST':
      return { ...state, toasts: [...state.toasts, action.payload] }

    case 'REMOVE_TOAST':
      return { ...state, toasts: state.toasts.filter(t => t.id !== action.payload) }

    case 'SET_EXPORTING':
      return { ...state, isExporting: action.payload }

    case 'SET_EXPORT_PROGRESS':
      return { ...state, exportProgress: action.payload.progress, exportMessage: action.payload.message ?? state.exportMessage }

    case 'SET_DETECTING':
      return { ...state, isDetecting: action.payload }

    case 'SET_DETECTION_PROGRESS':
      return { ...state, detectionProgress: action.payload }

    case 'LOAD_PROJECT': {
      const { markers, settings, video } = action.payload
      const merged = { ...state.settings, ...settings }
      return { ...state, video: { ...state.video, ...video }, markers, settings: merged, trimSegments: calcTrimSegments(markers, merged) }
    }

    default:
      return state
  }
}

let toastId = 0

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const toastTimers = useRef({})

  const toast = useCallback((message, type = 'info', duration = 3000) => {
    const id = `t${++toastId}`
    dispatch({ type: 'ADD_TOAST', payload: { id, message, type } })
    toastTimers.current[id] = setTimeout(() => {
      dispatch({ type: 'REMOVE_TOAST', payload: id })
      delete toastTimers.current[id]
    }, duration)
  }, [])

  return (
    <AppContext.Provider value={{ state, dispatch, toast }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
