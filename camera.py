"""
OpenCV camera helpers. Prefers external/USB cameras (e.g. Sony) over the
built-in laptop webcam by trying indices in configurable order.

Environment:
  SHADE_CAMERA_INDEX      If set (e.g. 1), only that index is used.
  SHADE_CAMERA_TRY_INDICES Comma-separated order, default "1,2,3,0" so USB
                           devices are tried before the typical laptop cam at 0.
"""
from __future__ import annotations

import logging
import os
import time
from typing import List, Optional, Tuple

import cv2

logger = logging.getLogger(__name__)

# Runtime override from POST /camera-preference (USB-first vs laptop-first).
_TRY_ORDER_OVERRIDE: Optional[List[int]] = None


def set_try_order(indices: List[int]) -> None:
    global _TRY_ORDER_OVERRIDE
    _TRY_ORDER_OVERRIDE = list(indices)
    logger.info("Camera try order override: %s", _TRY_ORDER_OVERRIDE)


def clear_try_order() -> None:
    global _TRY_ORDER_OVERRIDE
    _TRY_ORDER_OVERRIDE = None
    logger.info("Camera try order override cleared (env/default)")


def frame_has_signal(frame, min_mean: float = 1.25) -> bool:
    """True if frame is not an empty/all-black buffer (common right after open on Windows)."""
    if frame is None or getattr(frame, "size", 0) == 0:
        return False
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return float(gray.mean()) >= min_mean


def _parse_indices(s: str) -> List[int]:
    out: List[int] = []
    for part in s.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(int(part))
        except ValueError:
            logger.warning("Ignoring bad camera index token: %r", part)
    return out


def _backend_preference(index: int) -> Tuple[int, ...]:
    if os.name != "nt":
        return (cv2.CAP_V4L2, cv2.CAP_ANY)
    # External/USB (Sony, etc.) is usually index 1+ on Windows — DirectShow often works better than MSMF.
    if index > 0:
        return (cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_ANY)
    return (cv2.CAP_MSMF, cv2.CAP_DSHOW, cv2.CAP_ANY)


def try_open_camera(index: int) -> Optional[cv2.VideoCapture]:
    """Try to open `index` with each backend; warm up reads until a frame arrives."""
    for api in _backend_preference(index):
        cap: Optional[cv2.VideoCapture] = None
        try:
            cap = cv2.VideoCapture(index, api)
        except Exception as e:
            logger.debug("VideoCapture(%s, %s) raised: %s", index, api, e)
            continue
        if cap is None or not cap.isOpened():
            if cap is not None:
                cap.release()
            continue

        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        # Prefer HD; fall back to VGA if the driver rejects sizes (avoids black/invalid buffers).
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        time.sleep(0.15)
        ok_probe, probe = cap.read()
        if not ok_probe or probe is None or getattr(probe, "size", 0) == 0:
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            time.sleep(0.15)

        for _ in range(20):
            cap.read()

        time.sleep(0.15)
        for _ in range(40):
            ok, frame = cap.read()
            if ok and frame is not None and getattr(frame, "size", 0) > 0:
                if not frame_has_signal(frame, 1.25):
                    time.sleep(0.04)
                    continue
                logger.info(
                    "Camera ready: index=%s api=%s shape=%s luma~%.1f",
                    index,
                    api,
                    frame.shape,
                    float(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).mean()),
                )
                return cap
            time.sleep(0.04)

        cap.release()

    return None


def camera_index_order() -> List[int]:
    forced = os.environ.get("SHADE_CAMERA_INDEX", "").strip()
    if forced:
        return [int(forced)]
    if _TRY_ORDER_OVERRIDE is not None:
        return list(_TRY_ORDER_OVERRIDE)
    # Default: external USB (e.g. Sony) is usually 1+; laptop integrated is often 0.
    raw = os.environ.get("SHADE_CAMERA_TRY_INDICES", "1,2,3,0").strip()
    parsed = _parse_indices(raw)
    return parsed if parsed else [1, 2, 3, 0]


def open_preferred_capture() -> Tuple[Optional[cv2.VideoCapture], Optional[int]]:
    """
    Open the first working device in the configured index order.
    Default order tries 1,2,3 before 0 so a USB Sony (or other external UVC)
    is chosen ahead of the laptop integrated camera.
    """
    for index in camera_index_order():
        cap = try_open_camera(index)
        if cap is not None:
            return cap, index
    logger.error("No camera opened; tried indices %s", camera_index_order())
    return None, None


class Camera:
    """Legacy wrapper: opens preferred camera (not hard-coded index 0)."""

    def __init__(self, camera_index: Optional[int] = None):
        if camera_index is not None:
            idx = int(camera_index)
            self.cap = try_open_camera(idx)
            self.index = idx if self.cap is not None else None
        else:
            self.cap, self.index = open_preferred_capture()
        if self.cap:
            time.sleep(0.5)

    def get_frame(self):
        if not self.cap or not self.cap.isOpened():
            return None
        ret, frame = self.cap.read()
        if not ret:
            return None
        return frame

    def release(self):
        if self.cap and self.cap.isOpened():
            self.cap.release()
