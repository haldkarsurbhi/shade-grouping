"""
Single FastAPI application for SHADE – Fabric Shade Matching & Grouping.
Consolidates root, health, set-master, and analyze endpoints.
"""
import os
import shutil
import logging

from fastapi import FastAPI, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from color_engine import preprocess_roi, extract_lab_stats, delta_e_2000
from grouping import assign_shade_group
from data_store import save_results

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

app.mount("/images", StaticFiles(directory=UPLOAD_DIR), name="images")

MASTER_LAB = None

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"status": "Shade QC backend running"}


@app.get("/health")
def health_check():
    return {"status": "OK"}


@app.post("/set-master")
async def set_master(image: UploadFile):
    global MASTER_LAB
    path = f"{UPLOAD_DIR}/master.jpg"
    with open(path, "wb") as f:
        shutil.copyfileobj(image.file, f)

    roi = preprocess_roi(path)
    MASTER_LAB, _ = extract_lab_stats(roi)

    return {"status": "Master shade set"}


@app.post("/analyze")
async def analyze_roll(
    roll_no: str = Form(...),
    quantity: float = Form(...),
    image: UploadFile = Form(...),
):
    if MASTER_LAB is None:
        return JSONResponse(
            status_code=400,
            content={"error": "Master shade not set"},
        )

    try:
        path = f"{UPLOAD_DIR}/{roll_no}.jpg"
        with open(path, "wb") as f:
            shutil.copyfileobj(image.file, f)

        roi = preprocess_roi(path)
        if roi is None:
            return JSONResponse(
                status_code=400,
                content={"error": "Invalid image or ROI"},
            )

        mean_lab, _ = extract_lab_stats(roi)
        delta_e = delta_e_2000(mean_lab, MASTER_LAB)
        shade, decision = assign_shade_group(delta_e)

        result = {
            "roll_no": roll_no,
            "lab": mean_lab.tolist(),
            "delta_e": delta_e,
            "shade_group": shade,
            "decision": decision,
            "quantity": quantity,
            "image": f"/images/{roll_no}.jpg",
        }

        save_results([{
            "roll_no": roll_no,
            "L*": mean_lab[0],
            "a*": mean_lab[1],
            "b*": mean_lab[2],
            "delta_e": round(delta_e, 2),
            "shade_group": shade,
            "decision": decision,
        }])

        return result

    except Exception as e:
        logging.exception("Analyze failed: %s", e)
        return JSONResponse(
            status_code=500,
            content={"error": "Image processing failed"},
        )
