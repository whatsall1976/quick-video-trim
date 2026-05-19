# Quick Video Trim

Quick Video Trim is a lightweight, browser-based tool for **frame-level video trimming** with optional **face-detection-assisted marker placement**. The goal is to make “trim out the bad bits fast” feel like a small, local utility rather than a full NLE.

This is a **local web app** (React + Vite). Video processing/export runs in the browser via **FFmpeg.wasm**; face detection uses **TensorFlow.js**.

## What it does

- Load a local video (MP4/MOV) and scrub **frame-by-frame**
- Add **markers** manually (keyboard shortcut) or via **face detection**
- Convert markers → **trim segments** (merge nearby segments based on interval rules)
- Preview trim segments on a timeline (red regions)
- Export a trimmed MP4 + a JSON “project” snapshot
- Audio export modes:
  - `SYNC`: keep original audio, with small fades around cuts
  - `Mute`: muted output
  - `Music`: placeholder mode for adding music + fade-out behavior

## How it works (high level)

1. Mark “bad” moments with markers (manual or detected).
2. Each marker expands into a trim window (`trmWin`, odd number).
3. Nearby windows merge when gaps are smaller than `trmIntv`.
4. Export uses FFmpeg.wasm to cut and stitch the remaining sections.

## Tech stack

- UI: React 18, Vite
- Rendering: `<video>` + Canvas (for responsive scrubbing / frame display)
- Detection: TensorFlow.js (BlazeFace model loader)
- Export: `@ffmpeg/ffmpeg` + `@ffmpeg/util` (FFmpeg.wasm)

## Repo layout

- `src/App.jsx`: app shell + panel orchestration + export flow
- `src/context/AppContext.jsx`: central state + reducers
- `src/components/`: `VideoPlayer`, `Timeline`, panels (`ControlBar`, `MarkerPanel`, `DetectorPanel`, `SettingsPanel`)
- `src/hooks/`: playback shortcuts, markers/segments, detection pipeline, audio fades
- `src/utils/`: FFmpeg export wrapper, audio processing, detector helpers
- `docs/`: design notes and changelog

## Development

See `quickstart.md` for the minimal local run commands.

Useful scripts:

- `npm run dev`: start Vite dev server
- `npm run build`: production build
- `npm run preview`: serve the production build locally
- `npm run lint`: run ESLint

## Notes / constraints

- Runs fully in the browser; large videos and WASM processing can be memory/CPU intensive.
- FFmpeg.wasm core and ML model weights may be fetched at runtime (network required on first use).
- This is intentionally not a general-purpose editor; the UX is optimized for “mark → trim → export”.
