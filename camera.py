"""
OpenCV camera helpers for jury-safe USB UVC operation.

Environment:
  SHADE_CAMERA_INDEX           If set (e.g. 1), only that index is used.
  SHADE_CAMERA_ALLOWED_INDICES Comma-separated indices, default "0,1,2".
"""
from __future__ import annotations

import logging
import os
import time
from typing import List, Optional, Tuple

import cv2

logger = logging.getLogger(__name__)

# Runtime override from POST /camera-preference and POST /camera-use-index.
_TRY_ORDER_OVERRIDE: Optional[List[int]] = None
_LAST_ERROR: str = ""


def _set_last_error(msg: str) -> None:
    global _LAST_ERROR
    _LAST_ERROR = str(msg or "").strip()
    if _LAST_ERROR:
        logger.warning("Camera error: %s", _LAST_ERROR)


def clear_last_error() -> None:
    global _LAST_ERROR
    _LAST_ERROR = ""


def get_last_error() -> str:
    return _LAST_ERROR


def set_try_order(indices: List[int]) -> None:
    global _TRY_ORDER_OVERRIDE
    _TRY_ORDER_OVERRIDE = [int(i) for i in indices]
    logger.info("Camera try order override: %s", _TRY_ORDER_OVERRIDE)


def clear_try_order() -> None:
    global _TRY_ORDER_OVERRIDE
    _TRY_ORDER_OVERRIDE = None
    logger.info("Camera try order override cleared (env/default)")


def frame_has_signal(frame, min_mean: float = 1.25) -> bool:
    """True if frame is not empty/black/corrupt single-channel style output."""
    if frame is None or getattr(frame, "size", 0) == 0:
        return False
    if len(frame.shape) != 3 or frame.shape[2] != 3:
        return False

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    if float(gray.mean()) < min_mean:
        return False

    # Reject common corrupted preview: almost pure green plane.
    b_mean, g_mean, r_mean = [float(v) for v in frame.reshape(-1, 3).mean(axis=0)]
    if g_mean > 35.0 and b_mean < 6.0 and r_mean < 6.0:
        return False

    # Reject effectively-flat frames.
    if float(frame.std()) < 2.0:
        return False

    return True


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


def _allowed_indices() -> List[int]:
    forced = os.environ.get("SHADE_CAMERA_INDEX", "").strip()
    if forced:
        try:
            return [int(forced)]
        except ValueError:
            _set_last_error(f"Invalid SHADE_CAMERA_INDEX: {forced!r}")
            return [0]

    raw = os.environ.get("SHADE_CAMERA_ALLOWED_INDICES", "0,1,2").strip()
    parsed = _parse_indices(raw)
    if not parsed:
        parsed = [0, 1, 2]
    # Keep only a small deterministic range for jury stability.
    clean = [i for i in parsed if 0 <= i <= 2]
    return clean if clean else [0, 1, 2]


def _backend_preference() -> Tuple[int, ...]:
    if os.name != "nt":
        return (cv2.CAP_V4L2, cv2.CAP_ANY)
    # UVC devices are usually more stable on DirectShow.
    return (cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_ANY)


def try_open_camera(index: int) -> Optional[cv2.VideoCapture]:
    """Try to open `index` with each backend; warm up reads until a frame arrives."""
    clear_last_error()
    for api in _backend_preference():
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
        # Prefer UVC MJPG output to reduce corrupted color planes on Windows.
        try:
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        except Exception:
            pass

        # Prefer HD; fall back to VGA if the driver rejects sizes.
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        time.sleep(0.15)
        ok_probe, probe = cap.read()
        if not ok_probe or probe is None or getattr(probe, "size", 0) == 0:
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            time.sleep(0.15)

        for _ in range(12):
            cap.read()

        for _ in range(24):
            ok, frame = cap.read()
            if ok and frame is not None and getattr(frame, "size", 0) > 0:
                if not frame_has_signal(frame, 2.0):
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

    _set_last_error(
        f"USB camera not detected or unusable at index {index}. "
        "Check cable/Device Manager, then click Reload Camera."
    )
    return None


def camera_index_order() -> List[int]:
    allowed = _allowed_indices()
    if _TRY_ORDER_OVERRIDE is not None:
        return [i for i in _TRY_ORDER_OVERRIDE if i in allowed]
    # Default for jury profile: try external USB first, then integrated.
    if 1 in allowed and 0 in allowed:
        ordered = [1, 0] + [i for i in allowed if i not in (1, 0)]
        return ordered
    return allowed


def open_preferred_capture() -> Tuple[Optional[cv2.VideoCapture], Optional[int]]:
    """Open the first working device in the configured index order."""
    clear_last_error()
    for index in camera_index_order():
        cap = try_open_camera(index)
        if cap is not None:
            return cap, index
    tried = camera_index_order()
    _set_last_error(
        f"USB camera not detected. Tried indices {tried}. "
        "Check Device Manager and cable, then click Reload Camera."
    )
    logger.error("No camera opened; tried indices %s", tried)
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
