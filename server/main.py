import io
import os
import time
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

APP_HOST = os.getenv("YOLO_SERVER_HOST", "127.0.0.1")
APP_PORT = int(os.getenv("YOLO_SERVER_PORT", "8765"))
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL_PATHS = (
  REPO_ROOT / "models" / "yoloface_8n.onnx",
  REPO_ROOT / "models" / "yolov8n-face.onnx",
)


def default_model_name() -> str:
  for path in DEFAULT_MODEL_PATHS:
    if path.exists():
      return str(path)
  return str(DEFAULT_MODEL_PATHS[0])


MODEL_NAME = os.getenv("YOLO_MODEL", default_model_name())
YOLO_IMGSZ = int(os.getenv("YOLO_IMGSZ", "640"))
YOLO_IOU = float(os.getenv("YOLO_IOU", "0.5"))
YOLO_MAX_DET = int(os.getenv("YOLO_MAX_DET", "50"))

_session: ort.InferenceSession | None = None


def get_session() -> ort.InferenceSession:
  global _session
  if _session is None:
    model_path = Path(MODEL_NAME)
    if not model_path.exists():
      raise FileNotFoundError(f"Model file not found: {model_path}")
    _session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
  return _session


def input_size(session: ort.InferenceSession) -> tuple[int, int]:
  shape = session.get_inputs()[0].shape
  height = shape[2] if len(shape) == 4 and isinstance(shape[2], int) else YOLO_IMGSZ
  width = shape[3] if len(shape) == 4 and isinstance(shape[3], int) else YOLO_IMGSZ
  return int(width), int(height)


def letterbox(image: Image.Image, size: tuple[int, int]) -> tuple[np.ndarray, float, int, int]:
  target_w, target_h = size
  src_w, src_h = image.size
  scale = min(target_w / src_w, target_h / src_h)
  new_w, new_h = int(round(src_w * scale)), int(round(src_h * scale))
  pad_x = (target_w - new_w) // 2
  pad_y = (target_h - new_h) // 2

  resized = image.resize((new_w, new_h), Image.Resampling.BILINEAR)
  canvas = Image.new("RGB", (target_w, target_h), (114, 114, 114))
  canvas.paste(resized, (pad_x, pad_y))
  arr = np.asarray(canvas, dtype=np.float32) / 255.0
  arr = np.transpose(arr, (2, 0, 1))[None, ...]
  return arr, scale, pad_x, pad_y


def xywh_to_xyxy(boxes: np.ndarray) -> np.ndarray:
  out = np.empty_like(boxes)
  out[:, 0] = boxes[:, 0] - boxes[:, 2] / 2
  out[:, 1] = boxes[:, 1] - boxes[:, 3] / 2
  out[:, 2] = boxes[:, 0] + boxes[:, 2] / 2
  out[:, 3] = boxes[:, 1] + boxes[:, 3] / 2
  return out


def nms(boxes: np.ndarray, scores: np.ndarray, iou_thresh: float, limit: int) -> list[int]:
  if len(boxes) == 0:
    return []
  x1, y1, x2, y2 = boxes.T
  areas = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
  order = scores.argsort()[::-1]
  keep: list[int] = []

  while order.size > 0 and len(keep) < limit:
    i = int(order[0])
    keep.append(i)
    if order.size == 1:
      break

    rest = order[1:]
    xx1 = np.maximum(x1[i], x1[rest])
    yy1 = np.maximum(y1[i], y1[rest])
    xx2 = np.minimum(x2[i], x2[rest])
    yy2 = np.minimum(y2[i], y2[rest])
    inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
    union = areas[i] + areas[rest] - inter
    iou = inter / np.maximum(union, 1e-6)
    order = rest[iou <= iou_thresh]

  return keep


def parse_yolo_output(
  output: np.ndarray,
  conf: float,
  scale: float,
  pad_x: int,
  pad_y: int,
  image_size: tuple[int, int],
  iou_thresh: float,
  max_det: int,
) -> list[dict[str, Any]]:
  pred = np.squeeze(output)
  if pred.ndim != 2:
    raise ValueError(f"Unsupported ONNX output shape: {output.shape}")
  if pred.shape[0] < pred.shape[1]:
    pred = pred.T
  if pred.shape[1] < 5:
    raise ValueError(f"Unsupported ONNX output shape: {output.shape}")

  boxes = xywh_to_xyxy(pred[:, :4])
  if pred.shape[1] == 5 or (pred.shape[1] > 5 and float(np.nanmax(pred[:, 5:])) > 1.5):
    # YOLO face models commonly output x/y/w/h, confidence, then landmark x/y/score triples.
    scores = pred[:, 4]
    class_ids = np.zeros(len(pred), dtype=np.int64)
  else:
    class_scores = pred[:, 4:]
    class_ids = np.argmax(class_scores, axis=1)
    scores = class_scores[np.arange(len(class_scores)), class_ids]

  mask = scores >= conf
  boxes = boxes[mask]
  scores = scores[mask]
  class_ids = class_ids[mask]

  if len(boxes) == 0:
    return []

  boxes[:, [0, 2]] = (boxes[:, [0, 2]] - pad_x) / scale
  boxes[:, [1, 3]] = (boxes[:, [1, 3]] - pad_y) / scale
  img_w, img_h = image_size
  boxes[:, [0, 2]] = np.clip(boxes[:, [0, 2]], 0, img_w)
  boxes[:, [1, 3]] = np.clip(boxes[:, [1, 3]], 0, img_h)

  keep = nms(boxes, scores, iou_thresh, max_det)
  results: list[dict[str, Any]] = []
  for i in keep:
    x1, y1, x2, y2 = boxes[i]
    class_id = int(class_ids[i])
    results.append(
      {
        "x": float(x1),
        "y": float(y1),
        "width": float(max(0.0, x2 - x1)),
        "height": float(max(0.0, y2 - y1)),
        "confidence": float(scores[i]),
        "classId": class_id,
        "className": "face" if pred.shape[1] == 5 or class_id == 0 else str(class_id),
      }
    )
  return results


app = FastAPI(title="Quick Video Trim - YOLO Server")

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
    session = get_session()
    return {"ok": True, "model": MODEL_NAME, "input": session.get_inputs()[0].shape}
  except Exception as e:
    return {"ok": False, "model": MODEL_NAME, "error": str(e)}


@app.post("/detect")
async def detect(
  image: UploadFile = File(...),
  conf: float = 0.25,
  iou: float | None = None,
  max_det: int | None = None,
) -> dict[str, Any]:
  if image.content_type not in ("image/jpeg", "image/png", "image/webp"):
    raise HTTPException(status_code=415, detail=f"Unsupported image type: {image.content_type}")

  raw = await image.read()
  try:
    pil_image = Image.open(io.BytesIO(raw)).convert("RGB")
  except Exception as e:
    raise HTTPException(status_code=400, detail=f"Failed to decode image: {e}") from e

  session = get_session()
  t0 = time.time()
  input_name = session.get_inputs()[0].name
  tensor, scale, pad_x, pad_y = letterbox(pil_image, input_size(session))
  outputs = session.run(None, {input_name: tensor})
  nms_iou = YOLO_IOU if iou is None else max(0.0, min(float(iou), 1.0))
  det_limit = YOLO_MAX_DET if max_det is None else max(1, min(int(max_det), 500))
  boxes = parse_yolo_output(outputs[0], conf, scale, pad_x, pad_y, pil_image.size, nms_iou, det_limit)
  dt_ms = int((time.time() - t0) * 1000)

  return {"boxes": boxes, "ms": dt_ms, "model": MODEL_NAME, "nmsIou": nms_iou}


if __name__ == "__main__":
  import uvicorn

  uvicorn.run("main:app", host=APP_HOST, port=APP_PORT, reload=True)
