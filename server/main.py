import logging
import os
import time
from pathlib import Path
from typing import Any

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("detection-server")

import cv2
import numpy as np
import torch
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

try:
  from transnetv2_pytorch import TransNetV2

  _transnet_model = None

  def get_transnet():
    global _transnet_model
    if _transnet_model is None:
      _transnet_model = TransNetV2()
    return _transnet_model

  TRANSITION_DETECTOR_AVAILABLE = True
except ImportError:
  TRANSITION_DETECTOR_AVAILABLE = False

APP_HOST = os.getenv("SERVER_HOST", "127.0.0.1")
APP_PORT = int(os.getenv("SERVER_PORT", "8765"))

app = FastAPI(title="Quick Video Trim - Detection Server")

app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
  return {
    "ok": True,
    "transnetv2": TRANSITION_DETECTOR_AVAILABLE,
  }


@app.post("/detect-transitions-frames")
async def detect_transitions_frames(
  frames: list[UploadFile] = File(...),
  threshold: int = Form(50),
  startFrame: int = Form(0),
  fps: int = Form(30),
) -> dict[str, Any]:
  """Accept uploaded frames, run TransNetV2 for transition/dissolve detection"""
  if not TRANSITION_DETECTOR_AVAILABLE:
    return {"status": "missing", "message": "TransNetV2 not available", "rejectedRanges": []}

  try:
    log.info(f"[TransNetV2] Received {len(frames)} frames, threshold={threshold}, startFrame={startFrame}")

    if not frames:
      log.info("[TransNetV2] No frames received")
      return {"status": "ok", "rejectedRanges": []}

    # Decode all frames into numpy array
    decoded = []
    for frame_file in frames:
      raw = await frame_file.read()
      img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
      if img is not None:
        # TransNetV2 expects RGB 48x27
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        img_resized = cv2.resize(img_rgb, (48, 27))
        decoded.append(img_resized)

    log.info(f"[TransNetV2] Decoded {len(decoded)} of {len(frames)} frames")

    if len(decoded) < 2:
      log.info("[TransNetV2] Less than 2 frames decoded, skipping")
      return {"status": "ok", "rejectedRanges": []}

    # Run TransNetV2
    t0 = time.time()
    model = get_transnet()
    frames_tensor = torch.from_numpy(np.array(decoded, dtype=np.uint8))
    single_preds, all_preds = model.predict_frames(frames_tensor)
    # single_preds: (N,) tensor with per-frame transition probability
    predictions = single_preds.detach().cpu().numpy()
    dt_ms = int((time.time() - t0) * 1000)

    # predictions shape: (N,) with transition probability per frame
    threshold_norm = threshold / 100.0
    rejected_ranges = []
    in_transition = False
    trans_start = 0

    for i, score in enumerate(predictions):
      abs_frame = startFrame + i

      if float(score) > threshold_norm and not in_transition:
        trans_start = abs_frame
        in_transition = True
      elif float(score) <= threshold_norm and in_transition:
        rejected_ranges.append({
          "startFrame": max(startFrame, trans_start - 2),
          "endFrame": abs_frame + 2,
          "score": float(score),
          "reason": "Transition / crossfade",
        })
        in_transition = False

    # Close open transition
    if in_transition:
      rejected_ranges.append({
        "startFrame": max(startFrame, trans_start - 2),
        "endFrame": startFrame + len(decoded) - 1,
        "score": 0.8,
        "reason": "Transition / crossfade",
      })

    log.info(f"[TransNetV2] Done in {dt_ms}ms. Scores: min={predictions.min():.4f} max={predictions.max():.4f} mean={predictions.mean():.4f}. threshold_norm={threshold_norm}. Found {len(rejected_ranges)} transitions")
    return {"status": "ok", "rejectedRanges": rejected_ranges, "ms": dt_ms}

  except Exception as e:
    log.error(f"[TransNetV2] Error: {e}", exc_info=True)
    return {"status": "error", "message": str(e), "rejectedRanges": []}


if __name__ == "__main__":
  import uvicorn

  uvicorn.run("main:app", host=APP_HOST, port=APP_PORT, reload=True)
