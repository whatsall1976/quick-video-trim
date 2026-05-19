# Quickstart (local)

## TLDR

`npm install && npm run dev` — that's it. No server, no Python, no `.venv`. Everything runs in the browser.

---

Prereqs: Node.js + npm.

## Setup

```bash
npm install
npm run dev
```

Open the localhost URL printed by Vite.

## MediaPipe model

The app uses MediaPipe FaceLandmarker for face detection. The model file is loaded from `public/models/face_landmarker.task` at runtime.

If the model is not present, download it:

```bash
mkdir -p public/models
curl -L -o public/models/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
```

The model is ~4MB. It only needs to be downloaded once.

## Production build

```bash
npm run build
npm run preview
```

`npm run build` writes production assets to `dist/`; `npm run preview` serves that build locally.

## Notes

- First export may download FFmpeg.wasm core (~30MB), so it needs network once.
- MediaPipe WASM runtime is loaded from CDN on first detection run.
- No Python server required. All detection runs in the browser via MediaPipe's WASM backend.
