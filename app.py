"""
Single FastAPI application for SHADE – Fabric Shade Matching & Grouping.
Consolidates root, health, set-master, analyze, and live USB camera (MJPEG) stream.
"""
import datetime
import logging
import os
import re
import shutil
import threading
import time
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

import camera as cam_module
from color_engine import preprocess_roi, extract_lab_stats, delta_e_2000
from grouping import assign_shade_group, regroup_shades_by_l_star
from data_store import append_inspection_record, list_inspection_records, save_results

# ---------------------------------------------------------------------------
# App instance (single)
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Fabric Shade Matching and Grouping",
    description="Backend API for fabric shade analysis and grouping",
    version="1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Config & state
# ---------------------------------------------------------------------------
UPLOAD_DIR = "IMAGES"
os.makedirs(UPLOAD_DIR, exist_ok=True)

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_UI_BUILD_DIR = os.path.join(_BASE_DIR, "frontend", "build")
_UI_INDEX = os.path.join(_UI_BUILD_DIR, "index.html")


def _spa_ui_available() -> bool:
    return os.path.isfile(_UI_INDEX)


app.mount("/images", StaticFiles(directory=UPLOAD_DIR), name="images")

MASTER_LAB = None
# First successful scan in the current "lot" becomes the reference; ΔE = 0 for that scan.
# Later scans use ΔE2000 vs this LAB. POST /lot-reference/reset before a new lot.
LOT_REFERENCE_LAB: Optional[np.ndarray] = None


def _init_master_lab():
    """Load IMAGES/master.jpg if present; otherwise use a neutral LAB so /analyze works for demos."""
    global MASTER_LAB
    path = os.path.join(UPLOAD_DIR, "master.jpg")
    if os.path.isfile(path):
        try:
            roi = preprocess_roi(path)
            if roi is not None:
                lab, _ = extract_lab_stats(roi)
                MASTER_LAB = lab
                logging.info("Master LAB loaded from %s", path)
                return
        except Exception as e:
            logging.warning("Could not load master.jpg: %s", e)
    MASTER_LAB = np.array([70.0, 4.0, 8.0], dtype=float)
    logging.warning(
        "No valid IMAGES/master.jpg — using built-in reference LAB. POST /set-master with a fabric swatch for real matching."
    )


_init_master_lab()


def _safe_roll_stem(roll_no: str) -> str:
    s = re.sub(r"[^\w\-.]+", "_", str(roll_no).strip())
    s = s.strip("._") or "roll"
    return s[:120]


# ---------------------------------------------------------------------------
# Live camera (single capture; USB/external preferred over laptop cam)
# ---------------------------------------------------------------------------
_camera_lock = threading.Lock()
_stream_cap = None
_stream_index = None


def _ensure_stream_camera():
    global _stream_cap, _stream_index
    if _stream_cap is not None and _stream_cap.isOpened():
        return _stream_cap
    if _stream_cap is not None:
        try:
            _stream_cap.release()
        except Exception:
            pass
        _stream_cap = None
        _stream_index = None
    cap, idx = cam_module.open_preferred_capture()
    _stream_cap, _stream_index = cap, idx
    return _stream_cap


def _mjpeg_part(jpeg_bytes: bytes) -> bytes:
    """One multipart chunk; Content-Length helps some browsers decode MJPEG reliably."""
    n = len(jpeg_bytes)
    return (
        b"--frame\r\n"
        b"Content-Type: image/jpeg\r\n"
        b"Content-Length: "
        + str(n).encode("ascii")
        + b"\r\n\r\n"
        + jpeg_bytes
        + b"\r\n"
    )


_placeholder_jpeg_cache: Optional[bytes] = None


def _placeholder_jpeg() -> bytes:
    """Tiny JPEG so the stream keeps sending data when no camera (avoids hung <img>)."""
    global _placeholder_jpeg_cache
    if _placeholder_jpeg_cache is None:
        img = np.zeros((120, 160, 3), dtype=np.uint8)
        img[:] = (45, 42, 40)
        cv2.putText(
            img,
            "No camera / check USB",
            (6, 62),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (200, 200, 200),
            1,
            cv2.LINE_AA,
        )
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 75])
        _placeholder_jpeg_cache = buf.tobytes() if ok else b""
    return _placeholder_jpeg_cache


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {
        "status": "Shade QC backend running",
        "camera_urls": {
            "stream": "/camera-stream (or /camera_stream)",
            "status": "/camera-status (or /camera_status)",
            "snapshot": "/camera-snapshot (or /camera_snapshot)",
        },
    }


@app.get("/health")
def health_check():
    return {"status": "OK"}


@app.get("/camera-status")
@app.get("/camera_status")
def camera_status():
    """Fast JSON only — do not open the camera here (opening is slow and shares a lock with MJPEG)."""
    with _camera_lock:
        cap = _stream_cap
        idx = _stream_index
    ok = cap is not None and cap.isOpened()
    return {
        "ok": bool(ok),
        "index": idx,
        "try_order": cam_module.camera_index_order(),
    }


@app.post("/camera-preference")
async def camera_preference(mode: str = Form(...)):
    """
    Release the current device and set scan order.
    - usb_first: try 1,2,3 then 0 (external / Sony before laptop)
    - laptop_first: try 0,1,2,3
    - default: clear in-app override; use env SHADE_CAMERA_TRY_INDICES or built-in default
    """
    global _stream_cap, _stream_index
    if mode not in ("usb_first", "laptop_first", "default"):
        return JSONResponse(
            status_code=400,
            content={"error": "mode must be usb_first, laptop_first, or default"},
        )
    with _camera_lock:
        if _stream_cap is not None:
            try:
                _stream_cap.release()
            except Exception:
                pass
            _stream_cap = None
            _stream_index = None
    if mode == "laptop_first":
        cam_module.set_try_order([0, 1, 2, 3])
    elif mode == "usb_first":
        cam_module.set_try_order([1, 2, 3, 0])
    else:
        cam_module.clear_try_order()
    return {"ok": True, "try_order": cam_module.camera_index_order()}


@app.post("/camera-use-index")
async def camera_use_index(index: int = Form(...)):
    """Use only this device index (after releasing the current camera)."""
    global _stream_cap, _stream_index
    if index < 0 or index > 15:
        return JSONResponse(status_code=400, content={"error": "index must be 0–15"})
    with _camera_lock:
        if _stream_cap is not None:
            try:
                _stream_cap.release()
            except Exception:
                pass
            _stream_cap = None
            _stream_index = None
    cam_module.set_try_order([index])
    return {"ok": True, "try_order": [index]}


@app.get("/camera-snapshot")
@app.get("/camera_snapshot")
def camera_snapshot():
    """Single JPEG (proxied same-origin from CRA) — avoids canvas + crossOrigin issues for capture."""
    with _camera_lock:
        cap = _ensure_stream_camera()
        if cap is None or not cap.isOpened():
            return JSONResponse(status_code=503, content={"error": "No camera"})
        fallback = None
        for _ in range(24):
            good, frame = cap.read()
            if not good or frame is None or getattr(frame, "size", 0) == 0:
                time.sleep(0.03)
                continue
            fallback = frame
            if cam_module.frame_has_signal(frame, 1.25):
                enc_ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
                if enc_ok:
                    return Response(
                        content=jpg.tobytes(),
                        media_type="image/jpeg",
                        headers={
                            "Cache-Control": "no-store, no-cache, must-revalidate",
                            "Access-Control-Allow-Origin": "*",
                        },
                    )
            time.sleep(0.03)
        if fallback is not None:
            enc_ok, jpg = cv2.imencode(".jpg", fallback, [cv2.IMWRITE_JPEG_QUALITY, 90])
            if enc_ok:
                return Response(
                    content=jpg.tobytes(),
                    media_type="image/jpeg",
                    headers={
                        "Cache-Control": "no-store, no-cache, must-revalidate",
                        "Access-Control-Allow-Origin": "*",
                    },
                )
    return JSONResponse(status_code=503, content={"error": "No frame from camera"})


@app.get("/camera-stream")
@app.get("/camera_stream")
def camera_stream():
    def generate():
        while True:
            with _camera_lock:
                cap = _ensure_stream_camera()
                if cap is None or not cap.isOpened():
                    blob = _placeholder_jpeg()
                    if blob:
                        yield _mjpeg_part(blob)
                    time.sleep(0.4)
                    continue
                good, frame = cap.read()
            if not good or frame is None:
                time.sleep(0.03)
                continue
            enc_ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            if not enc_ok:
                continue
            yield _mjpeg_part(jpg.tobytes())
            # ~15 FPS — avoids saturating CPU and matches typical USB bandwidth
            time.sleep(1.0 / 15.0)

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate, private",
            "Pragma": "no-cache",
            "Expires": "0",
            "Access-Control-Allow-Origin": "*",
        },
    )


@app.post("/set-master")
async def set_master(image: UploadFile):
    """
    Saves a reference image to IMAGES/master.jpg and updates MASTER_LAB.
    Live /analyze compares each roll to the first scan in the lot (see LOT_REFERENCE_LAB),
    not to this file, unless you have not started a lot yet — first scan still sets the lot ref.
    """
    global MASTER_LAB
    path = f"{UPLOAD_DIR}/master.jpg"
    with open(path, "wb") as f:
        shutil.copyfileobj(image.file, f)

    roi = preprocess_roi(path)
    MASTER_LAB, _ = extract_lab_stats(roi)

    return {"status": "Master shade set"}


@app.post("/lot-reference/reset")
async def reset_lot_reference():
    """Clear lot reference so the next /analyze capture becomes reference (ΔE 0)."""
    global LOT_REFERENCE_LAB
    LOT_REFERENCE_LAB = None
    return {
        "status": "ok",
        "message": "Lot reference cleared. Next scan sets reference (ΔE 0); following scans compare to it.",
    }


@app.get("/inspection-records")
def get_inspection_records():
    """Saved captures (newest first) for dashboard / logs after refresh."""
    rows = list_inspection_records()
    rows.reverse()
    return {"records": rows}


@app.post("/analyze")
async def analyze_roll(
    roll_no: str = Form(...),
    quantity: float = Form(...),
    image: UploadFile = Form(...),
    buyer: str = Form(""),
    supplier: str = Form(""),
):
    capture_id = int(time.time() * 1000)
    try:
        fname = f"{_safe_roll_stem(roll_no)}_{capture_id}.jpg"
        path = os.path.join(UPLOAD_DIR, fname)
        with open(path, "wb") as f:
            shutil.copyfileobj(image.file, f)

        roi = preprocess_roi(path)
        if roi is None:
            return JSONResponse(
                status_code=400,
                content={"error": "Invalid image or ROI"},
            )

        global LOT_REFERENCE_LAB

        mean_lab, _ = extract_lab_stats(roi)
        if LOT_REFERENCE_LAB is None:
            LOT_REFERENCE_LAB = mean_lab.copy()
            delta_e = 0.0
            shade, decision = "A", "ACCEPT"
            is_lot_reference = True
            logging.info("Lot reference LAB set from roll %s (ΔE 0 for this scan).", roll_no)
        else:
            delta_e = delta_e_2000(mean_lab, LOT_REFERENCE_LAB)
            shade, decision = assign_shade_group(delta_e)
            is_lot_reference = False

        rel_image = f"/images/{fname}"
        result = {
            "roll_no": roll_no,
            "lab": mean_lab.tolist(),
            "delta_e": delta_e,
            "shade_group": shade,
            "decision": decision,
            "quantity": quantity,
            "image": rel_image,
            "is_lot_reference": is_lot_reference,
            "capture_id": capture_id,
        }

        now = datetime.datetime.now()
        log_row = {
            "id": capture_id,
            "persistedFromApi": True,
            "date": now.date().isoformat(),
            "time": now.strftime("%H:%M"),
            "rollNo": roll_no,
            "buyer": (buyer or "").strip(),
            "supplier": (supplier or "").strip(),
            "quantity": quantity,
            "deltaE": float(delta_e),
            "shade": shade,
            "shadeGroup": shade,
            "decision": decision,
            "image": rel_image,
            "lab": mean_lab.tolist(),
            "isLotReference": is_lot_reference,
            "orderId": "CAPTURE",
        }
        append_inspection_record(log_row)

        save_results([{
            "roll_no": roll_no,
            "image_path": path,
            "L*": mean_lab[0],
            "a*": mean_lab[1],
            "b*": mean_lab[2],
            "delta_e": round(delta_e, 2),
            "shade_group": shade,
            "decision": decision,
            "quantity": quantity,
            "buyer": (buyer or "").strip(),
            "supplier": (supplier or "").strip(),
        }])

        return result

    except Exception as e:
        logging.exception("Analyze failed: %s", e)
        return JSONResponse(
            status_code=500,
            content={"error": "Image processing failed"},
        )


@app.post("/regroup-lightness")
async def regroup_lightness(body: dict):
    """
    JSON body: { "rolls": [ { "roll_no": "...", "L_star": 82.1 }, ... ] }
    Also accepts L* or lab: [L,a,b]. Returns same rolls with updated shade_group/decision.
    """
    rolls = body.get("rolls") if isinstance(body, dict) else None
    if not isinstance(rolls, list):
        return JSONResponse(
            status_code=400,
            content={"error": "Body must include a list field 'rolls'"},
        )
    updated = regroup_shades_by_l_star(rolls)
    return {"rolls": updated}


# React production build (npm run build in frontend/) — mounted last so API routes win.
# CRA with homepage "/" emits /static/... URLs; mount build/static at /static so /ui/ works locally.
if _spa_ui_available():
    _static_dir = os.path.join(_UI_BUILD_DIR, "static")
    if os.path.isdir(_static_dir):
        app.mount("/static", StaticFiles(directory=_static_dir), name="ui_static")
    _manifest = os.path.join(_UI_BUILD_DIR, "manifest.json")
    if os.path.isfile(_manifest):

        @app.get("/manifest.json", include_in_schema=False)
        async def _spa_manifest():
            return FileResponse(_manifest)

    _favicon = os.path.join(_UI_BUILD_DIR, "favicon.ico")
    if os.path.isfile(_favicon):

        @app.get("/favicon.ico", include_in_schema=False)
        async def _spa_favicon():
            return FileResponse(_favicon)

    app.mount(
        "/ui",
        StaticFiles(directory=_UI_BUILD_DIR, html=True),
        name="ui",
    )
    logging.info("Serving SPA at /ui/ from %s", _UI_BUILD_DIR)
else:
    logging.warning(
        "No frontend/build/index.html — API only. Run: cd frontend && npm run build"
    )
