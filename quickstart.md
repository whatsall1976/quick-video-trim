# Quickstart (local)

Prereqs: Node.js + npm, plus Python 3.

```bash
npm install
```
Install dependencies.

```bash
npm run dev
```
Start the dev server (Vite). Open the printed localhost URL.

## Face detection (YOLO)

Face detection is performed by a local Python server that runs a YOLO model.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
python server/main.py
```

By default the UI calls `http://127.0.0.1:8765`. To change it:

```bash
VITE_YOLO_SERVER_URL="http://127.0.0.1:8765" npm run dev
```

```bash
npm run build
```
Build production assets into `dist/`.

```bash
npm run preview
```
Serve the production build locally (Vite preview).

Notes:
- First export may download FFmpeg.wasm core (needs network once).
- First YOLO server start may download model weights (needs network once).
