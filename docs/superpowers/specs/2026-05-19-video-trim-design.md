# Quick Video Trim - Design Specification

## TLDR
A lightweight browser-based video editor for frame-level trimming with automatic face detection. Upload video, add markers (manually or via YOLO), adjust trim windows, preview red segments on timeline, export trimmed video with audio fades.

---

## Overview

**Project:** Quick Video Trim
**Purpose:** Lightweight local web app for precise video trimming with face-detection-assisted marker placement
**Tech Stack:** React 18 + Vite, Canvas API, Web Audio API, TensorFlow.js + YOLO, FFmpeg.js
**Scope:** Single-face videos only; multiple overlapping faces flagged for user review

---

## Architecture

### Directory Structure
```
src/
  components/
    VideoPlayer.jsx      # Canvas rendering + frame extraction
    Timeline.jsx         # Red segment visualization + marker positions
    MarkerPanel.jsx      # Manual marker CRUD + list UI
    ControlBar.jsx       # Playback controls, speed display
    DetectorPanel.jsx    # YOLO detection orchestration + results
    SettingsPanel.jsx    # Tunable threshold inputs
  hooks/
    useVideoPlayback.js  # Playback state + keyboard shortcuts
    useMarkers.js        # Marker CRUD, trim segment calculation
    useYOLODetection.js  # Face detection pipeline
    useAudioFades.js     # Audio fade envelope generation
  utils/
    yoloDetector.js      # YOLO inference + result parsing
    videoExport.js       # FFmpeg.js wrapper for export
    audioProcessor.js    # Web Audio fade generation
  App.jsx               # Main + context provider
  index.css
```

### State Management (React Context)
```javascript
{
  // Video metadata
  video: {
    file,           // File object
    duration,       // Seconds
    fps,            // Frames per second
    width,          // Pixels
    height,         // Pixels
    totalFrames     // Calculated
  },

  // Playback
  playback: {
    currentFrame,   // 0 to totalFrames
    isPlaying,      // Boolean
    playbackSpeed   // 1, 2, 4, 6, 8, 10... (x multiplier)
  },

  // Markers (manual + auto-detected)
  markers: [
    {
      id,           // Unique string
      frameNumber,  // Position
      autoDetected, // Boolean
      flagged,      // Boolean (overlaps)
      customTrmWin, // Null or override value
      customTrmIntv // Null or override value
    }
  ],

  // YOLO detection results
  detectionResults: {
    faces: [
      { frameNumber, confidence, x, y, width, height }
    ],
    overlaps: [
      { frameRange: [start, end], frames: [...] }
    ],
    thresholdCrossings: [
      { type: 'confidence', direction: 'drop', frameNumber }
    ],
    sizeJumps: [
      { frameNumber, percentChange }
    ],
    movements: [
      { frameNumber, percentDisplacement }
    ]
  },

  // Global settings
  settings: {
    trmWin: 31,              // Odd number, trim window size (default 31)
    trmIntv: 90,             // Frames tolerated between trims (default 90)
    confidenceThreshold: 50, // % (default 50)
    sizeJumpThreshold: 10,   // % (default 10)
    faceMovementThreshold: 30, // % of face width (default 30)
    qualityThreshold: 50     // % confidence flag threshold (default 50)
  },

  // Calculated trim segments
  trimmedSegments: [
    { startFrame, endFrame, reason, markerId }
  ]
}
```

---

## UI Layout

**Default View:**
```
┌──────────────────────────────────────────────────┐
│ [V] [M] [D] [S]  │  VideoPlayer (full width)    │
│ toggle buttons   │  (canvas + video metadata)    │
├──────────────────────────────────────────────────┤
│ Timeline with red trim segments (full width)     │
│ (markers visible, clickable, draggable)          │
└──────────────────────────────────────────────────┘
```

**Panel Behavior:**
- Toggle buttons (V/M/D/S) on left side
- Click button → modal overlay slides in over video
- Click outside modal or button again → closes
- Only one panel visible at a time
- Keyboard shortcuts always active

**Panels:**
- **V** = ControlBar: Play/pause button, speed display, keyboard hints
- **M** = MarkerPanel: List of markers (manual + auto), add/remove/reposition, edit custom trim values
- **D** = DetectorPanel: "Run Detection" button, detection progress, flagged overlaps, auto-marker review
- **S** = SettingsPanel: 6 tunable threshold inputs (trmWin, trmIntv, confidenceThreshold, sizeJump, faceMovement, qualityThreshold)

---

## Features

### Feature 1: Video Upload & Frame Navigation
**Input:** MP4 or MOV files
**Playback Control:**
- **Space:** Play/pause
- **Left/Right arrows (paused):** ±1 frame
- **Shift+Left/Right (paused):** ±N frames with acceleration (2, 4, 6, 8, 10...)
- **Shift+Right (playing):** Increase playback speed (x2 → x4 → x6 → x8 → x10...)
- **Shift+Left (playing):** Decrease playback speed (reverse of above)

**Canvas Rendering:**
- VideoPlayer component decodes video frame at `currentFrame`
- Updates on manual scrub or playback tick
- Syncs with marker positions for visual reference

---

### Feature 2: Manual Markers
**Shortcut:** Cmd+Shift+M
**Behavior:**
- Creates marker at current frame with `autoDetected=false`
- Marker stored in state with unique ID
- MarkerPanel displays list, allows:
  - Delete marker
  - Drag to reposition (frame number updates)
  - View/edit custom $trmWin override (Mode 2)
  - View/edit custom $trmIntv overrides for adjacent intervals (Mode 2)

---

### Feature 3: Auto-Trim Mode 1 (Global Settings)
**Algorithm:**
1. User sets $trmWin (odd, default 31) and $trmIntv (default 90) in SettingsPanel
2. For each marker at frame X:
   - Trim range: `[X - floor($trmWin/2), X + floor($trmWin/2)]`
   - Example: X=150, $trmWin=31 → trim [135, 165]
3. For adjacent markers: if gap between trim end and next trim start < $trmIntv, merge into single segment
4. Timeline updates to show all merged red segments in real-time

**Visual Feedback:**
- Red segments on Timeline show exact frames to be removed
- Segment boundaries are clear and clickable to edit (Mode 2)

---

### Feature 4: Auto-Trim Mode 2 (Fine-Tuning)
**Entry:** After Mode 1 setup (all global markers/segments in place)
**Capabilities:**
- Click on marker → override its $trmWin for that marker only
- Click on interval between two segments → override its $trmIntv
- Each override stored as `customTrmWin` or `customTrmIntv` on marker/interval
- Trim segments recalculate on-the-fly
- Global settings still apply to unmarked regions

**Use Case:** Fine-tune specific problem areas without resetting global settings

---

### Feature 5: YOLO Auto-Detection
**Trigger:** User clicks "Run Detection" in DetectorPanel
**Pipeline:**
1. Load YOLO face detection model (one-time, cached)
2. Iterate through all video frames, infer face boxes
3. Parse results for four detection types:

   **Type 1: Face On/Off**
   - Frame where confidence changes from 0 → >threshold (face appears)
   - Frame where confidence changes from >threshold → 0 (face disappears)
   - Auto-generate marker at transition frame

   **Type 2: Confidence Threshold Crossing**
   - Marker when confidence drops below $qualityThreshold (50% default)
   - Marker when confidence rises back above threshold
   - Reason: "Quality drop/recovery"

   **Type 3: Size Jump**
   - Calculate face bounding box area frame-to-frame
   - If change > $sizeJumpThreshold (10% default), create marker
   - Reason: "Size change (zoom/movement)"

   **Type 4: Face Movement**
   - Calculate centroid displacement frame-to-frame
   - If displacement > $faceMovementThreshold% of face width (30% default), create marker
   - Reason: "Movement detected"

4. **Overlap Detection:**
   - If multiple faces detected in same frame (due to crossfade or artifacts), flag all markers in that range
   - User reviews flagged markers in DetectorPanel, can keep/delete/adjust

5. **Result:** Auto-generated markers appear in MarkerPanel with `autoDetected=true`, user can accept/reject

---

### Feature 6: Audio Fades on Export
**When:** During video export
**Algorithm:**
1. For each trim segment to be removed:
   - First frame: fade in (gain envelope 0 → 1 over 1 frame duration)
   - Last frame: fade out (gain envelope 1 → 0 over 1 frame duration)
2. Use Web Audio API GainNode with exponential ramp curves
3. Apply fade as new audio track in output file

**Benefit:** Prevents audio click artifacts at segment boundaries

---

## Video Processing & Export

### Upload & Metadata
- User selects file → extract duration, fps, dimensions via `<video>` element
- Calculate totalFrames = duration × fps
- Store in state.video

### Export Workflow
**Input:** Current markers + settings
**Steps:**
1. Calculate trim segments from markers + $trmWin + $trmIntv
2. Invert to find **keep segments** (all non-trimmed ranges)
3. Use FFmpeg.js to:
   - Decode input video
   - Extract keep segments in order
   - Concatenate seamlessly
   - Encode to H.264 MP4
4. Simultaneously generate audio fades via Web Audio API and apply to output
5. Export two files:
   - `output.mp4` - trimmed video
   - `output.json` - project metadata

### Project JSON Format
```json
{
  "videoFile": "original_name.mp4",
  "duration": 120,
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "markers": [
    { "id": "m1", "frameNumber": 150, "autoDetected": false },
    { "id": "m2", "frameNumber": 300, "autoDetected": true, "customTrmWin": 25 }
  ],
  "settings": {
    "trmWin": 31,
    "trmIntv": 90,
    "confidenceThreshold": 50,
    "sizeJumpThreshold": 10,
    "faceMovementThreshold": 30,
    "qualityThreshold": 50
  },
  "trimSegments": [
    { "startFrame": 135, "endFrame": 165, "reason": "marker_m1" }
  ]
}
```

### Project Reload
- User uploads JSON + original video (or re-upload)
- Parse JSON, reconstruct state
- Markers + settings restore, user can export again or adjust further

---

## Data Flow

```
Upload Video
    ↓
Extract metadata (duration, fps, dimensions)
    ↓
Render video on canvas at currentFrame
    ↓
User Actions:
  - Playback (space, arrows, shift+arrows)
  - Manual markers (Cmd+Shift+M) → update state
  - Run detection → YOLO → auto-markers
  - Adjust settings (trmWin, trmIntv, thresholds)
    ↓
Markers → calculate trim segments (via useMarkers hook)
    ↓
Timeline visualizes trim segments (red zones)
    ↓
User review/adjust in MarkerPanel
    ↓
Click Export
    ↓
FFmpeg trims video + apply audio fades
    ↓
Save MP4 + JSON to disk
```

---

## Error Handling

### Video Upload
- **Invalid file type:** Reject, show error, don't proceed
- **File too large (>2GB):** Warn user, but allow (browser canvas may struggle)
- **Missing metadata:** Fail hard with clear message (cannot proceed without fps/duration)

### YOLO Detection
- **Model load failure:** Show error, disable "Run Detection" until retry
- **Inference fails on frame N:** Log frame number, skip, show warning count at end
- **No faces found:** Alert user, offer to adjust thresholds or proceed without auto-markers
- **Multiple overlapping faces:** Flag each overlap with frame range, add to MarkerPanel for user review

### Trimming & Export
- **Marker outside video bounds:** Prevent creation, show error
- **Trim segment exceeds bounds:** Clamp to valid range, warn user
- **FFmpeg export fails:** Show error with logs, user retries
- **Disk space full:** Warn before export, cancel if insufficient space

### Audio Processing
- **Web Audio API unavailable:** Fall back to silent fade (still prevent clicks)
- **Fade generation fails:** Skip fades, export video without audio envelope (still usable)

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Play/Pause | Space |
| Next frame (paused) | Right arrow |
| Previous frame (paused) | Left arrow |
| Jump forward (paused, multi-frame acceleration) | Shift+Right |
| Jump backward (paused, multi-frame acceleration) | Shift+Left |
| Increase playback speed | Shift+Right (playing) |
| Decrease playback speed | Shift+Left (playing) |
| Add marker | Cmd+Shift+M |

---

## Implementation Priority

**Phase 1 (MVP):**
1. Video upload + canvas rendering
2. Playback controls (space, arrows, shift+arrows, speed)
3. Manual markers (Cmd+Shift+M)
4. Trim segment calculation (Mode 1)
5. Timeline visualization (red segments)
6. Basic export (FFmpeg + JSON)

**Phase 2 (Enhancement):**
1. Audio fades on export
2. YOLO detection pipeline
3. DetectorPanel UI
4. Overlap flagging
5. Mode 2 fine-tuning

**Phase 3 (Polish):**
1. Project reload (JSON)
2. Settings persistence (localStorage)
3. Performance optimization (large videos)

---

## Constraints & Assumptions

- **Single-face videos only** — multiple simultaneous faces flagged as overlaps
- **MP4/MOV input only** — other formats rejected
- **Local processing only** — no backend, all computation in browser
- **No testing framework** — manual testing only
- **Code conciseness** — keep scripts under 500 lines, aggressively refactor

---

## Success Criteria

✅ Upload MP4/MOV, render on canvas
✅ Frame-by-frame navigation with smooth playback
✅ Manual marker creation (Cmd+Shift+M)
✅ Red segments on timeline preview trim result
✅ Global trim settings (Mode 1) calculate merge logic
✅ Fine-tune individual markers (Mode 2)
✅ YOLO detects: face on/off, confidence crossing, size jump, movement
✅ Export trimmed video + project JSON
✅ Audio fades prevent clipping on segment boundaries
✅ All keyboard shortcuts responsive
✅ Panels toggle cleanly without blocking timeline

