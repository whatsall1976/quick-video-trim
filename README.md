# Quick Video Trim

## TLDR

Browser-only video trimmer with frame-level scrubbing and MediaPipe-based face quality detection. No server required. Mark bad frames, auto-detect face issues (wrong angle, occlusion, missing/multiple faces), merge into trim segments, export via FFmpeg.wasm.

---

Quick Video Trim is a lightweight, browser-based tool for **frame-level video trimming** with **face-detection-assisted marker placement**. The goal is to make "trim out the bad bits fast" feel like a small, local utility rather than a full NLE.

This is a **local web app** (React + Vite). Video processing/export runs in the browser via **FFmpeg.wasm**; face detection runs in the browser via **MediaPipe FaceLandmarker**.

## What it does

- Load a local video (MP4/MOV) and scrub **frame-by-frame**
- Add **markers** manually (keyboard shortcut) or via **face detection**
- Two detection models (both browser-side, no server):
  - **Face Landmarker**: Detects extreme yaw/pitch/roll, 0 faces (ghosted/missing), >1 faces (overlap/dissolve)
  - **Occlusion Detector**: Detects blocked eyes/nose/lips via landmark visibility scores
- **Snapshot tool**: Inspect raw face parameters at current frame for threshold calibration
- Convert markers into **trim segments** (merge nearby segments based on interval rules)
- Preview trim segments on a timeline (red regions)
- Export a trimmed MP4 + a JSON "project" snapshot
- Audio export modes:
  - `SYNC`: keep original audio, with small fades around cuts
  - `Mute`: muted output
  - `Separate`: original audio applied to full output (ignores trim), 5-second fade-out at end

## How it works (high level)

1. Mark "bad" moments with markers (manual or detected).
2. Each marker expands into a trim window (`trmWin`, odd number).
3. Nearby windows merge when gaps are smaller than `trmIntv`.
4. Export uses FFmpeg.wasm to cut and stitch the remaining sections.

## Detection architecture

Both detectors share a single **MediaPipe FaceLandmarker** instance (`numFaces: 3`, IMAGE mode, GPU delegate). They run **sequentially** because they share the video element's seek position.

- **Face Landmarker** samples every 3 frames. Flags: no face, multiple faces, extreme yaw/pitch/roll.
- **Occlusion** samples every 5 frames. Checks landmark visibility for left eye, right eye, nose, lips.
- Results are merged via `mergeRejectedRanges()` with a 5-frame tolerance, then converted to flagged markers.

### How dissolves/crossfades get caught

We intentionally removed dedicated dissolve detection (TransNetV2, linear blend reconstruction) after extensive testing. Face Landmarker catches dissolves via face count:

- **Ghosted/blurry dissolve**: MediaPipe sees 0 faces → flagged as "No face detected"
- **Clear two-face dissolve**: MediaPipe sees >1 faces → flagged as "Multiple faces detected"
- **Edge case**: One clear face + faint ghost that doesn't register → `faceCount=1`, may pass undetected. Angle/occlusion checks provide partial coverage.

See [Detection Roadmap](#detection-roadmap) below for the full history.

## Tech stack

- UI: React 18, Vite
- Rendering: `<video>` + Canvas (for responsive scrubbing / frame display)
- Detection: MediaPipe FaceLandmarker (`@mediapipe/tasks-vision`), runs in browser
- Export: `@ffmpeg/ffmpeg` + `@ffmpeg/util` (FFmpeg.wasm)

## Repo layout

- `src/App.jsx`: app shell + panel orchestration + export flow
- `src/context/AppContext.jsx`: central state + reducers
- `src/components/`: `VideoPlayer`, `Timeline`, panels (`ControlBar`, `MarkerPanel`, `DetectorPanel`, `SettingsPanel`)
- `src/hooks/`: playback shortcuts, markers/segments, detection pipeline, audio fades
- `src/utils/qualityDetectors/`: `faceLandmarkerDetector.js`, `occlusionDetector.js`, `sharedLandmarker.js`, `ranges.js`
- `docs/`: design notes and changelog

## Development

See `quickstart.md` for the minimal local run commands.

Useful scripts:

- `npm run dev`: start Vite dev server
- `npm run build`: production build
- `npm run preview`: serve the production build locally
- `npm run lint`: run ESLint

## Detection Roadmap

This section documents the journey of building detection for video quality issues, including failed approaches and why we ended up with the current architecture.

### Phase 1: YOLO face detection (server-side)

The original approach used a Python server with Ultralytics YOLO for face detection. This required a `.venv` with heavy dependencies (tensorflow 1.1GB, onnxruntime 67MB). It worked for basic face detection but was server-dependent and bloated.

**Removed**: Server-side approach replaced by browser-side MediaPipe.

### Phase 2: TransNetV2 for dissolve/transition detection (server-side)

TransNetV2 was added to detect shot boundaries and crossfades. It required a Python server with PyTorch.

**Problems encountered**:
- `predict_frames()` expected `torch.Tensor`, not numpy arrays → crash
- Returned a tuple `(single_preds, all_preds)`, not a flat array → crash
- **Fundamental limitation**: TransNetV2 detects shot *boundaries* (hard cuts score 0.98, crossfade edges score 0.71), but mid-dissolve frames where content is statically blended score 0.0002. It cannot detect that a frame IS a dissolve, only where a dissolve starts/ends.
- When all frames in a window are equally blended (static double-exposure), TransNetV2 sees no change → scores near 0.

**Removed**: TransNetV2 fundamentally cannot solve the mid-dissolve detection problem.

### Phase 3: Linear blend reconstruction for dissolve detection (browser-side)

After TransNetV2 failed, we built a custom dissolve detector using pixel math: `frame(t) ~ alpha * frame(t-d) + (1-alpha) * frame(t+d)`. The idea: if a frame can be reconstructed as a linear blend of surrounding frames, it's a dissolve.

**Problems encountered**:
- When content is a static double-exposure (all frames look identical), `reconErr = 0` and `sceneChange = 0` for all gap sizes (5, 10, 15, 30, 45 frames).
- The detector only works for *active* dissolves where content is changing over time, not for static blended content.
- Multi-gap testing confirmed: zero reconstruction error across all gaps means the content is not transitioning — it's statically blended.

**Removed**: Cannot detect static double-exposure content.

### Phase 4: Face Landmarker + Occlusion (browser-side, current)

The breakthrough was realizing that MediaPipe FaceLandmarker's face count IS the dissolve signal:
- Ghosted/blurry dissolves → `faceCount = 0` (no recognizable face in the blur)
- Clear two-face dissolves → `faceCount > 1` (both faces detected)

This approach catches dissolves as a side effect of face detection, without needing a dedicated dissolve model.

**Known gap**: A dissolve where one face is clearly visible and the ghost is too faint for MediaPipe to register (so `faceCount = 1`) would pass undetected. The yaw/pitch/roll and occlusion checks provide partial coverage for this edge case, since the visible face may be at an unusual angle or have partially occluded landmarks from the ghosting.

**Future consideration**: If this gap becomes a real problem, possible approaches include:
- Lowering MediaPipe's face detection confidence threshold to pick up fainter ghosts
- Image histogram analysis (dissolves often have unusual intensity distributions)
- SSIM-based comparison with a reference "clean" frame

### Technical lessons learned

1. **Sequential detector execution is mandatory**: Detectors sharing a `<video>` element must run sequentially. `Promise.all` causes race conditions on `currentTime` seeks.
2. **IMAGE mode, not VIDEO mode**: MediaPipe's VIDEO mode requires monotonically increasing timestamps. When detectors seek backwards, it crashes. IMAGE mode with `detect()` avoids this.
3. **Shared singleton**: Both face and occlusion detectors share one FaceLandmarker instance (`numFaces: 3`) to avoid loading the model twice.
4. **Server-side ML was unnecessary**: Everything runs in the browser via MediaPipe WASM. No Python server, no `.venv`, no heavyweight dependencies.

## Notes / constraints

- Runs fully in the browser; large videos and WASM processing can be memory/CPU intensive.
- FFmpeg.wasm core and MediaPipe model weights are fetched at runtime (network required on first use).
- The MediaPipe face landmarker model (`face_landmarker.task`) should be placed in `public/models/`.
- This is intentionally not a general-purpose editor; the UX is optimized for "mark → trim → export".
