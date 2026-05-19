import os
import time
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO

APP_HOST = os.getenv("YOLO_SERVER_HOST", "127.0.0.1")
APP_PORT = int(os.getenv("YOLO_SERVER_PORT", "8765"))

# Heavier defaults are opt-in via env vars; keep a small model name as fallback.
MODEL_NAME = os.getenv("YOLO_MODEL", "yolov8n-face.pt")
YOLO_DEVICE = os.getenv("YOLO_DEVICE")  # e.g. "cuda", "cpu", "mps", or "0"
YOLO_IMGSZ = int(os.getenv("YOLO_IMGSZ", "960"))  # bigger = slower but better
YOLO_IOU = float(os.getenv("YOLO_IOU", "0.5"))
YOLO_MAX_DET = int(os.getenv("YOLO_MAX_DET", "50"))

_model: YOLO | None = None


def get_model() -> YOLO:
  global _model
  if _model is None:
    _model = YOLO(MODEL_NAME)
  return _model


app = FastAPI(title="Quick Video Trim – YOLO Server")

app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
  try:
    get_model()
    return {"ok": True, "model": MODEL_NAME}
  except Exception as e:
    return {"ok": False, "model": MODEL_NAME, "error": str(e)}


@app.post("/detect")
async def detect(
  image: UploadFile = File(...),
  conf: float = 0.25,
) -> dict[str, Any]:
  """
  Detect faces/objects on a single image frame.
  Returns boxes in pixel coords: [{x,y,width,height,confidence,classId,className}]
  """
  if image.content_type not in ("image/jpeg", "image/png", "image/webp"):
    raise HTTPException(status_code=415, detail=f"Unsupported image type: {image.content_type}")

  raw = await image.read()
  arr = np.frombuffer(raw, dtype=np.uint8)
  bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
  if bgr is None:
    raise HTTPException(status_code=400, detail="Failed to decode image")

  model = get_model()
  t0 = time.time()
  predict_kwargs: dict[str, Any] = {
    "conf": conf,
    "iou": YOLO_IOU,
    "imgsz": YOLO_IMGSZ,
    "max_det": YOLO_MAX_DET,
    "verbose": False,
  }
  if YOLO_DEVICE:
    predict_kwargs["device"] = YOLO_DEVICE

  results = model.predict(bgr, **predict_kwargs)
  dt_ms = int((time.time() - t0) * 1000)

  r0 = results[0]
  names = getattr(r0, "names", {})
  boxes_out: list[dict[str, Any]] = []
  if r0.boxes is not None and len(r0.boxes) > 0:
    xyxy = r0.boxes.xyxy.cpu().numpy()
    confs = r0.boxes.conf.cpu().numpy()
    cls = r0.boxes.cls.cpu().numpy().astype(int)
    for (x1, y1, x2, y2), c, cl in zip(xyxy, confs, cls):
      x1f, y1f, x2f, y2f = float(x1), float(y1), float(x2), float(y2)
      boxes_out.append(
        {
          "x": x1f,
          "y": y1f,
          "width": max(0.0, x2f - x1f),
          "height": max(0.0, y2f - y1f),
          "confidence": float(c),
          "classId": int(cl),
          "className": names.get(int(cl), str(int(cl))),
        }
      )

  return {"boxes": boxes_out, "ms": dt_ms, "model": MODEL_NAME}


if __name__ == "__main__":
  import uvicorn

  uvicorn.run("main:app", host=APP_HOST, port=APP_PORT, reload=True)
