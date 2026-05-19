# Changelog

## [Unreleased]

### Added

#### Browser-side face quality detection (MediaPipe FaceLandmarker)
- **Face Landmarker detector**: Detects extreme yaw/pitch/roll, 0 faces, >1 faces
- **Occlusion detector**: Detects blocked eyes/nose/lips via landmark visibility scores
- **Shared MediaPipe singleton**: Both detectors share one FaceLandmarker instance (numFaces: 3, IMAGE mode, GPU delegate)
- **Snapshot tool**: Inspect raw face parameters at current frame for threshold calibration
- **Sequential detection pipeline**: Detectors run sequentially to avoid video element seek race conditions
- **Files**: `src/utils/qualityDetectors/faceLandmarkerDetector.js`, `occlusionDetector.js`, `sharedLandmarker.js`, `ranges.js`

### Removed

#### Server-side detection infrastructure
- **Removed**: `server/` directory (main.py, requirements.txt), `.venv`, all Python dependencies
- **Removed**: TransNetV2 transition detector — cannot detect mid-dissolve frames (only detects boundaries)
- **Removed**: Dissolve detector (linear blend reconstruction) — cannot detect static double-exposure content
- **Removed**: YOLO face detection server — replaced by browser-side MediaPipe
- **Impact**: No Python/server required. All detection runs in browser via MediaPipe WASM

### Fixed

#### Issue #1: Cmd+Shift+M Keyboard Shortcut Not Working
- **Problem:** Marker shortcut failed to trigger due to case-sensitive `e.key === 'M'` check
- **Solution:** Changed to `e.code === 'KeyM'` for reliable key detection
- **File:** `src/hooks/useMarkers.js:50`
- **Impact:** Keyboard shortcut now works reliably on all platforms

#### Issue #2: Playback & Scrubbing Not Responsive
- **Problem:** Canvas rendering relied on unreliable `onseeked` event, causing delayed redraws on scrubbing
- **Solution:** Refactored VideoPlayer to use continuous RAF loop for both playback and paused modes
- **File:** `src/components/VideoPlayer.jsx:10-38`
- **Details:**
  - Removed `onseeked` callback dependency
  - Video element sync happens in RAF loop
  - Added 100ms fallback interval for large files
- **Impact:** Video scrubbing now shows frame changes in real-time

#### Issue #3: Red Trim Segments at Wrong Position
- **Problem:** Critical property name mismatch - `calcTrimSegments` created `start`/`end` but all other code expected `startFrame`/`endFrame`, resulting in undefined values and NaN positioning
- **Solution:** Renamed properties in `calcTrimSegments` to use `startFrame`/`endFrame` consistently
- **File:** `src/context/AppContext.jsx:34-56`
- **Impact:** Trim segments now render at correct positions on timeline

### Technical Details

All three issues resulted from implementation gaps discovered during systematic testing:

1. **Keyboard Event Handling:** `e.code` property is more reliable than `e.key` as it represents physical key location independent of modifiers and keyboard layouts
2. **Canvas Rendering:** Continuous RAF ensures responsive feedback during both playback and user scrubbing, eliminating seek latency
3. **Data Consistency:** Synchronized property names across all components (AppContext, Timeline, VideoExport, AudioProcessor, SettingsPanel)
