# Changelog

## [Unreleased]

### Added

#### Task #5: Add POST /detect-transitions Endpoint
- **Endpoint:** `POST /detect-transitions`
- **Purpose:** Detect video transitions and crossfades using TransNetV2
- **File:** `server/main.py:232-348`
- **Request Body:** `frameRange`, `videoFile`, `threshold`
- **Response:** Returns `status` (ok/missing/error) with `rejectedRanges` containing detected transitions
- **Features:**
  - Graceful handling when TransNetV2 not installed (returns `status: "missing"`)
  - Frame extraction and RGB conversion from video file
  - Transition detection with score-based filtering
  - Range expansion to collect adjacent frames in transitions
  - Overlap detection to avoid duplicate ranges
  - Comprehensive error handling with descriptive messages
- **Dependencies:** cv2 (OpenCV), torch, transnetv2

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
