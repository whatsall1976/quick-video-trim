# Quickstart (local)

Prereqs: Node.js + npm, plus Python 3.

This app has two separate processes:

1. Vite serves the React app.
2. The Python YOLO server handles face detection.

Run them in two terminals.

## Terminal 1: React app

```bash
npm install
npm run dev
```

Open the localhost URL printed by Vite.

## Terminal 2: YOLO server

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r server/requirements.txt
python server/main.py
```

If a PyPI mirror says `from versions: none` for common packages like `fastapi`, that mirror is not usable from your environment. Switch back to official PyPI or try a different mirror.

The YOLO server listens on `http://127.0.0.1:8765` by default. The React app already uses that URL, so you do not need to set any environment variable for the default setup.

Only set `VITE_YOLO_SERVER_URL` if you run the Python server somewhere else:

```bash
VITE_YOLO_SERVER_URL="http://127.0.0.1:8765" npm run dev
```

You can verify the server directly:

```bash
curl http://127.0.0.1:8765/health
```

## YOLO model location

The server loads the model named by `YOLO_MODEL`. By default it uses the first repo-local model it finds:

1. `./models/yoloface_8n.onnx`
2. `./models/yolov8n-face.pt`

So if you already have `yoloface_8n.onnx`, put it here:

```bash
mkdir -p models
mv /path/to/yoloface_8n.onnx models/yoloface_8n.onnx
```

Then start the server normally:

```bash
python server/main.py
```

Ultralytics may also use its user cache directory for downloads and metadata. Common cache locations are:

- macOS: `~/Library/Application Support/Ultralytics/`
- Linux: `~/.config/Ultralytics/`

To use another model file without moving it into `models/`, pass the path explicitly:

```bash
YOLO_MODEL="/path/to/other-model.onnx" python server/main.py
```

## Production build

```bash
npm run build
npm run preview
```

`npm run build` writes production assets to `dist/`; `npm run preview` serves that build locally.

Notes:
- First export may download FFmpeg.wasm core, so it needs network once.
- First YOLO server start may download model weights, so it needs network once.
