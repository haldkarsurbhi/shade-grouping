# SHADE – Vision-Based Fabric Shade Matching & Grouping System  
## Complete Technical Audit

**Auditor:** Senior Software Architect & Computer Vision Engineer  
**Date:** February 27, 2026  
**Scope:** Full workspace (backend Python, React UI, camera, color engine, grouping, storage)

---

# 1️⃣ SYSTEM ARCHITECTURE REVIEW

## Current Structure

| Layer | Components | Location |
|-------|-------------|----------|
| **Backend API** | FastAPI (`api.py`) – set-master, analyze | Root |
| **Minimal API** | FastAPI (`main.py`) – health only | Root |
| **Camera** | OpenCV `Camera` class | `camera.py` |
| **Color engine** | Preprocess, LAB, ΔE2000 | `color_engine.py` |
| **Grouping** | `assign_shade_group`, `group_rolls_against_master` | `grouping.py` |
| **Data store** | In-memory list `ROLL_DATA`, `save_results` | `data_store.py` |
| **UI** | React (CRA): Dashboard, Inspection, Logs | `shade-qc-ui/src/` |
| **Legacy UI** | PyQt5 `ShadeSummaryDialog` | `shade_summary.py` |

## Modularity & Scalability

- **Modularity:** Partially good. Color engine, grouping, and camera are in separate modules. API imports them directly. No shared interfaces or dependency injection.
- **Scalability:** Poor. Single global `MASTER_LAB` and `ROLL_DATA`; no multi-tenant or session support. One master shade for entire process.
- **Dual FastAPI apps:** `main.py` and `api.py` define two different apps. UI points to port 8000; only one can run. Unclear which is “production” (no single entrypoint documented).

## Responsibility Separation

| Concern | Status | Notes |
|---------|--------|--------|
| UI | ✅ Separate | React app with clear pages |
| Camera | ⚠️ Isolated but unused | `camera.py` exists; **Inspection screen does not use it**. Live feed is a static image URL. |
| Color engine | ✅ Separate | `color_engine.py` is focused |
| Grouping | ✅ Separate | `grouping.py` is focused |
| Data storage | ❌ Broken | `data_store` is in-memory only; `save_results()` does not persist anything and ignores the list passed from `api.py`. |

## Tight Coupling & Risks

1. **API ↔ global state:** `api.py` uses `global MASTER_LAB`. No master → 500 on `/analyze`.
2. **data_store ↔ grouping:** `data_store.perform_grouping(tolerance)` calls `assign_shade_group(ROLL_DATA, tolerance)`, but `grouping.assign_shade_group(delta_e)` takes a **single float**. Signature mismatch → **runtime error** if `perform_grouping` is ever used.
3. **Frontend ↔ CSV only:** All “real” data is from CSV. Inspection “Capture Scan” uses **random ΔE** and never calls the backend `/analyze`.
4. **Image paths:** Backend returns `"image": "IMAGES/R101.jpg"`. Frontend uses it as `src`; no static file serving from API → images from API would 404 in browser.

## Transition to Backend + Dashboard

- **Structure:** A single FastAPI app with `/set-master`, `/analyze`, health, and static image serving is a good base. React dashboard consuming that API is the right direction.
- **Gaps:** No real integration: Inspection does not call API; no persistence; no single app entrypoint; no env-based config.

## Architecture Improvement Suggestions

1. **Single backend entrypoint:** Merge `main.py` and `api.py` into one app (e.g. `api.py`) with `/health`, `/`, `/set-master`, `/analyze`, and mount `StaticFiles` for `IMAGES/` so the UI can load roll images from the API origin.
2. **Remove global state:** Inject “current master” (e.g. in a small service or request-scoped state) and validate “master set” before analyze.
3. **Fix data_store:** Either (a) make `save_results(rows)` append/persist to CSV or DB, or (b) remove it from the analyze flow until persistence exists. Fix `perform_grouping` to use `group_rolls_against_master(ROLL_DATA, master_lab)` instead of calling `assign_shade_group` with wrong signature.
4. **Wire Inspection to API:** Replace random ΔE with: capture/upload image → POST `/analyze` → show returned shade/ΔE/verdict and optionally add to history from API response.
5. **Document which app to run:** e.g. `uvicorn api:app --reload` and add a root `requirements.txt`.

---

# 2️⃣ CAMERA & IMAGE PIPELINE REVIEW

## Camera Handling (`camera.py`)

- **Stable/safe:** Partially. Uses `cv2.CAP_DSHOW` on Windows (good). Warm-up `time.sleep(1)` reduces initial garbage frames. No retry if `VideoCapture` fails; no check that resolution was actually set.
- **Frame capture:** `get_frame()` returns `None` on read failure; callers must check. No timeout; if camera hangs, `read()` can block indefinitely.
- **Memory:** Single frame in memory; no accumulation. Risk: if caller never releases, `Camera.release()` must be called explicitly (no context manager).
- **Disconnect:** If camera is unplugged, `cap.read()` can return `(False, None)` repeatedly; no reconnection or backoff. **Not used by React app** (Inspection shows static image).

**Improvements:**

- Add `__enter__` / `__exit__` for `with Camera() as cam:`.
- Validate `cap.isOpened()` after constructor; retry or raise with clear error.
- Optional timeout or non-blocking read for robustness.
- Integrate with Inspection: e.g. local service that grabs frames and sends to backend, or browser-based capture and upload.

## Image Pipeline (`color_engine.py`)

- **Load:** `cv2.imread(image_path)` returns `None` if file missing/corrupt; `preprocess_roi` returns `None`. **api.py does not check** → next step can get `None` and crash.
- **ROI:** Default center crop `(w//4, h//4, w//2, h//2)` is reasonable to avoid edges. No validation of `roi` bounds (could go out of image if caller passes bad values).
- **Median blur:** `medianBlur(..., 5)` is appropriate for texture noise.
- **Color extraction:** `extract_lab_stats` returns mean and std of pixel LAB. Scientifically fine for “average shade” of region.

## LAB Conversion – **CRITICAL BUG**

OpenCV’s `cv2.cvtColor(..., cv2.COLOR_RGB2LAB)` on **8-bit images** returns:

- **L:** 0–255 (CIE L* is 0–100, scaled by 255/100)
- **a, b:** 0–255 (CIE a*, b* are -128…127, stored as value + 128)

CIEDE2000 is defined on **standard CIE L\*a\*b\*** (L* ∈ [0,100], a*, b* ∈ [-128, 127]). The code passes raw OpenCV LAB (0–255) into `delta_e_2000()`, so **ΔE values are wrong** (scale/offset error). Same issue for master and roll.

**Fix:** In `extract_lab_stats`, convert to standard scale before returning:

```python
# After: mean_lab = pixels.mean(axis=0)
# OpenCV 8-bit: L in [0,255], a,b in [0,255] with 128 offset
mean_lab_std = np.array([
    mean_lab[0] * 100.0 / 255.0,
    mean_lab[1] - 128.0,
    mean_lab[2] - 128.0
], dtype=np.float64)
return mean_lab_std, std_lab  # optionally convert std similarly if used
```

Apply the same conversion for any LAB values used in Delta E.

## Delta E Calculation

- **Formula:** Implementation follows CIEDE2000 (L′, C′, h′, S_L, S_C, S_H, R_T, etc.). **Algorithm is CIE2000, not CIE76.** Once LAB is in standard scale, the math is correct.
- **Input type:** `lab1.astype(float)` is safe for numpy arrays; ensure callers never pass None (guard in api.py).

**Summary:** Fix LAB scaling first; then Delta E is industry-standard.

---

# 3️⃣ SHADE GROUPING LOGIC REVIEW

## Tolerance Logic (`grouping.py`)

- **Current:** Hardcoded thresholds: ΔE ≤2 → A, ≤4 → B, ≤6 → C, ≤8 → D, ≤8.5 → E (HOLD), >8.5 → REJECT. No config file or env.
- **Cleanliness:** Logic is clear and readable. Single function `assign_shade_group(delta_e)` returns `(shade, decision)`.
- **Consistency:** Backend uses these bands. **Frontend (App.jsx, csvParser.js) uses different rules:** e.g. ≤1.2→A, ≤2→B, ≤3→C, else D. So CSV-driven UI can show different shade/verdict than backend for same ΔE.

## Edge Cases

- **ΔE = 0:** Returns A, ACCEPT ✅  
- **ΔE = 2.0:** Returns B ✅ (boundary inclusive).  
- **Float precision:** Comparisons are `<=`; 8.5000001 correctly goes to REJECT.  
- **Negative ΔE:** Not possible from formula; no check.  
- **NaN/Inf:** Would propagate; no validation in `assign_shade_group`.

## Historical Comparison

- `group_rolls_against_master(rolls, master_lab)` is scalable: O(n) over rolls, one ΔE per roll. No issue for thousands of rolls from a compute perspective.
- **Data_store:** `perform_grouping(tolerance=1.5)` is **broken** (wrong signature for `assign_shade_group`). Grouping is only used correctly inside `api.py` per request and in `group_rolls_against_master`.

## Suggestions

1. **Single source of truth:** Move threshold config to one place (e.g. backend config or API). Frontend should not duplicate shade rules; if it needs to display shade from ΔE before API, use the same thresholds (e.g. shared constants or small API returning band).
2. **Configurable thresholds:** Load from env or config (e.g. `SHADE_A_MAX=2.0`, `SHADE_B_MAX=4.0`, …) so factories can tune without code change.
3. **Fix data_store.perform_grouping:** Implement as: compute master_lab from stored master or parameter, then call `group_rolls_against_master(ROLL_DATA, master_lab)` and assign results back to ROLL_DATA (or return new list). Remove call to `assign_shade_group(ROLL_DATA, tolerance)`.
4. **Optional:** Validate ΔE is finite and non-negative in `assign_shade_group` and return a dedicated “INVALID” or re-raise.

---

# 4️⃣ DATA STORAGE & TRACEABILITY REVIEW

## Current Storage

| Data | Where | Format |
|------|--------|--------|
| Inspection history (UI) | CSV | `public/inspection_data.csv` (and `public/data/`) |
| Parsing | PapaParse in App.jsx + csvParser.js | In-memory array `history` |
| Backend roll state | In-memory list `ROLL_DATA` | Python list of dicts |
| “Save” from API | `save_results(...)` | **Does nothing** – ignores argument, returns ROLL_DATA, no write to disk/DB |
| Images | Filesystem | `IMAGES/master.jpg`, `IMAGES/{roll_no}.jpg` |

## Structure

- CSV columns: Date, Roll ID, Buyer, Supplier, Quantity (m), DeltaE, Shade Group, Verdict, Image. Adequate for single-table view. Image column is often empty in CSV; backend returns path string.
- Backend roll dict: roll_no, image_path, lab, shade_group, delta_e (in add_roll); api.py builds a different dict for save_results (L*, a*, b*, etc.) and passes it to save_results which ignores it.

## Scale to 50,000+ Rolls

- **CSV:** Not suitable. No indexing; full load into memory; no concurrent write; risk of corruption on append.  
- **In-memory ROLL_DATA:** Lost on restart; not shared across workers; would exhaust memory at scale.  
- **Images:** 50k files in one folder is manageable but not ideal; no cleanup policy; no deduplication.

## Image Storage & Paths

- Paths are relative: `IMAGES/master.jpg`, `IMAGES/{roll_no}.jpg`. Safe for same working directory. **Roll numbers are used in filenames** – special characters in roll_no could cause path issues (sanitize with e.g. `re.sub(r'[^\w\-]', '_', roll_no)`).
- No static file serving in api.py → frontend cannot load `IMAGES/...` from API origin. Either mount StaticFiles at e.g. `/images` or add a GET `/images/{roll_no}` that returns the file.
- CSV “Image” column: empty or path; if backend writes paths, they should be URLs or paths the frontend can resolve (e.g. `http://api/images/R101.jpg`).

## Database Architecture Suggestion

For production and traceability:

1. **PostgreSQL (or SQLite for pilot):**  
   - Tables: `masters` (id, lab_l, lab_a, lab_b, image_path, set_at), `rolls` (id, roll_no, buyer, supplier, quantity_m, image_path, lab_l, lab_a, lab_b, delta_e, shade_group, decision, created_at, master_id).  
   - Index on (created_at, supplier, buyer, roll_no) for dashboards and logs.
2. **Image storage:** Keep files in `IMAGES/` or object storage; DB stores path or URL. Optional: store small thumbnail path separately.
3. **API:** Replace ROLL_DATA with DB inserts; `save_results` becomes “persist this roll to DB”. Add GET endpoints for history (paginated) and for roll detail/image URL.
4. **CSV:** Keep as optional export (e.g. “Export today’s inspections”) generated from DB, not as primary source.

---

# 5️⃣ UI/UX REVIEW (INDUSTRIAL ENVIRONMENT)

## Layout

- **Shell:** Sidebar + main content; header with breadcrumb, search, user. Clear and operator-friendly.
- **Dashboard:** Stats cards, shade distribution bar chart, ΔE trend line, supplier stacked bar, supplier table, inspection log table. Good information density.
- **Inspection:** Control bar (Roll ID, Length, Buyer, Supplier), Capture Scan / Manual Save, “live” viewport (reticle overlay), shade reference panel (A/B/C/D), session log table. Logical for a QC station.

## Error Handling

- **CSV load failure:** `loadError` state and message “Inspection data not available”. No retry button.
- **Capture:** Only validation is “Please enter a Supplier name.” No handling for “API error” or “Camera not available” because capture is simulated.
- **No global error boundary** for React; no toast/snackbar for API errors.

## Buttons & Workflow

- Capture Scan / Manual Save are visible. Manual Save has no implemented behavior. Config in sidebar has no target (no config page).
- **Workflow gap:** Operator cannot actually capture from camera or upload image and get real ΔE; workflow is demo-only.

## Production Deployment Improvements

1. **Connect Inspection to backend:** Real “Capture” = upload image + metadata to `/analyze`, show result and add to session + global history (and persist via backend once implemented).
2. **Error feedback:** Show API errors (e.g. “Master not set”, “Upload failed”) in the UI with retry or guidance.
3. **Config page:** Allow base URL and optionally tolerance presets if backend supports them.
4. **Accessibility:** Ensure focus order and contrast for factory lighting; consider larger touch targets for gloves.
5. **Dashboard image column:** When row.image is from API (path), use full URL to backend static image (e.g. `baseURL + '/' + row.image` or dedicated image endpoint) so thumbnails load.
6. **Shade E:** Dashboard distribution and filters include A,B,C,D,REJECT but backend has E (HOLD). Add E to charts and filters so E is not lumped into REJECT.

---

# 6️⃣ SECURITY & RELIABILITY REVIEW

## Camera Disconnect

- **Backend:** Camera is not used by the API; analyze uses uploaded file. No camera disconnect impact on API.
- **Standalone camera.py:** If used elsewhere, no auto-reconnect; caller gets None and must handle.

## Database Failure

- **Current:** No database; only in-memory list. Process restart loses all backend roll data. “Failure” = restart.
- **After DB:** Use connection pooling; return 503 or clear error if DB unavailable; avoid exposing stack traces in production.

## Image Write Failure

- **api.py:** `open(path, "wb")` and `shutil.copyfileobj` can raise (disk full, permission, path too long). **No try/except** → unhandled exception → 500. Same for `/set-master` and `/analyze`.

## Crash Risks

1. **Master not set:** `MASTER_LAB` is None → `delta_e_2000(mean_lab, MASTER_LAB)` → TypeError or similar → 500.
2. **Missing/corrupt image:** `preprocess_roi` returns None → `extract_lab_stats(None)` returns (None, None) → `delta_e_2000` with None → crash.
3. **data_store.perform_grouping:** Wrong signature → TypeError if ever called.
4. **Roll number in path:** Special characters could cause path errors or security concerns (path traversal if not validated).

## Exception Handling

- **api.py:** No try/except in set_master or analyze. Any failure in open/copyfileobj, preprocess_roi, extract_lab_stats, delta_e_2000, or assign_shade_group surfaces as 500.
- **Recommendation:** Wrap endpoints in try/except; validate “master set” and “roi is not None”; on error return 400/422 with message (e.g. “Master not set”, “Invalid image”) and log full trace server-side.

---

# 7️⃣ PERFORMANCE & SCALABILITY REVIEW

## 8-Hour Continuous Run

- **Backend:** No obvious memory leak in single request (roi and LAB are bounded). Global ROLL_DATA grows unbounded if many rolls analyzed and stored in memory → over time memory can grow.
- **Frontend:** Recharts and table re-render on history change; with thousands of rows, consider virtualized table and pagination. No evidence of leak in reviewed code.
- **Camera:** If a separate process uses camera.py in a loop without release(), driver/resources could leak; not applicable to current React flow.

## 1000 Rolls/Day

- **Per request:** One image read, one ROI, one LAB mean, one ΔE, one grouping. Fast (milliseconds per roll). No bottleneck for 1000/day if requests are spread.
- **Storage:** 1000 rows in memory is fine; 50k is not. CSV append 1000 rows/day is workable short-term but not for long-term or concurrent access.
- **Blocking:** All API logic is synchronous; async def with sync cv2/numpy will block the event loop. For high concurrency, run heavy work in a thread pool (e.g. `run_in_executor`) so other requests are not blocked.

## Unnecessary Recalculations

- **Frontend:** useMemo for stats, distributionData, trendData, supplierChartData is correct; no redundant recalc except when history changes.
- **Backend:** Each analyze recalculates from scratch; no caching. Acceptable for current scale.

**Summary:** Fix unbounded ROLL_DATA growth (or move to DB); offload CPU-bound work to thread pool if you need high concurrency; add pagination/virtualization for large history in UI.

---

# 8️⃣ INDUSTRY DEPLOYMENT READINESS SCORE

| Criterion | Academic (10) | Pilot Factory (10) | Full Production (10) |
|----------|----------------|---------------------|------------------------|
| Correctness (LAB/ΔE, grouping) | 5 – LAB scale bug | 5 | 5 |
| Architecture (single app, no broken deps) | 6 – dual apps, broken save | 5 | 4 |
| Data persistence & traceability | 3 – none | 3 | 2 |
| UI ↔ backend integration | 2 – Inspection mock | 3 | 2 |
| Error handling & resilience | 3 – no guards | 4 | 3 |
| Security (paths, validation) | 5 – basic | 5 | 4 |
| Config & env | 4 – hardcoded | 5 | 4 |
| Documentation & run instructions | 4 – minimal | 5 | 4 |
| **Overall (average)** | **4.5/10** | **4.4/10** | **3.5/10** |

**Summary:**

- **Academic prototype:** 4–5/10. Good for demonstrating pipeline (camera, color, grouping) once LAB is fixed; architecture and persistence are weak.
- **Pilot factory:** 4/10. Requires: fix LAB, single backend app, persist results (CSV or DB), wire Inspection to API, basic error handling and image serving. Then pilot is feasible with close monitoring.
- **Full production:** 3–4/10. Requires: DB, proper image storage/URLs, validation, security hardening, env-based config, and operational docs (backup, recovery, updates).

---

# 9️⃣ TRANSITION TO BACKEND + DASHBOARD

## Add FastAPI Backend (Consolidate)

- Merge `main.py` into `api.py`: keep one FastAPI app with `/`, `/health`, `/set-master`, `/analyze`.
- Mount static files: `app.mount("/images", StaticFiles(directory="IMAGES"), name="images")` so frontend can use `http://localhost:8000/images/R101.jpg`.
- Add `requirements.txt` (fastapi, uvicorn, python-multipart, opencv-python, numpy) and document `uvicorn api:app --host 0.0.0.0 --port 8000`.

## Move to PostgreSQL

- Add SQLAlchemy or async equivalent (e.g. asyncpg); define models for master and rolls.
- Replace ROLL_DATA with session/DB; `add_roll` → insert; `save_results` → insert or update roll record; optional batch insert from `group_rolls_against_master` results.
- Add GET `/rolls` (paginated) and GET `/rolls/{roll_no}` (or by id) for dashboard and logs. Return image URL as e.g. `/images/{roll_no}.jpg`.

## Connect to Vercel Dashboard

- Build React app (`npm run build`); serve from Vercel (static or Node server). Set `VITE_API_URL` or `REACT_APP_API_URL` to production API (e.g. `https://your-api.railway.app` or similar). Use that in `api.js` instead of hardcoded `http://127.0.0.1:8000`.
- API must allow CORS for the Vercel origin (restrict `allow_origins` in production).
- Images: frontend must request images from API domain (e.g. `https://api.example.com/images/R101.jpg`), not from Vercel.

## Refactoring Order

1. **Fix critical bugs:** LAB scale in color_engine; guard master set and roi in api.py; fix or remove data_store.perform_grouping and save_results.
2. **Single backend:** Merge main + api; add static mount for IMAGES; add requirements.txt and run instructions.
3. **Wire UI to API:** Inspection calls POST /analyze with form data + file; display result and push to history; optionally persist via new backend endpoint.
4. **Persistence:** Introduce DB (SQLite for pilot or PostgreSQL); migrate “save” and “load” to DB; add GET rolls endpoints.
5. **Config:** Env for API URL, DB URL, optional tolerance; frontend reads API URL from env.
6. **Deploy:** Backend on a host (e.g. Railway, Render); frontend on Vercel; CORS and image URLs configured.

---

# 10️⃣ FINAL SUMMARY

## Critical Fixes (Immediate)

1. **LAB scale in color_engine.py:** Convert OpenCV 8-bit LAB to CIE L*a*b* (L* 0–100, a*b* -128…127) before computing ΔE and returning from `extract_lab_stats`. Otherwise all ΔE values are wrong.
2. **api.py: validate before use:** Check `MASTER_LAB is not None` before analyze; return 400 with “Master shade not set” otherwise. Check `preprocess_roi` result is not None; return 400 “Invalid or missing image” otherwise.
3. **api.py: exception handling:** Wrap set_master and analyze in try/except; on file/processing errors return 4xx/5xx with clear message and log trace.
4. **data_store:** Fix `save_results`: either persist the passed list (e.g. append to CSV or DB) or remove the call from api.py until persistence exists. Fix `perform_grouping` to use `group_rolls_against_master(ROLL_DATA, master_lab)` instead of `assign_shade_group(ROLL_DATA, tolerance)`.

## Medium Priority

5. **Single backend app:** One FastAPI app (e.g. api.py) with health, set-master, analyze, and mount of IMAGES for static image serving. Document run command and add requirements.txt.
6. **Inspection → API:** Replace random ΔE with real upload to `/analyze`; display returned shade/ΔE/verdict and add to history; optionally persist via backend when available.
7. **Frontend image URLs:** When displaying backend-sourced images, use API base URL + path (e.g. baseURL + `/images/` + filename) so thumbnails and modals load.
8. **Unified shade rules:** One set of thresholds (backend); frontend uses same rules for any client-side display or fallback (or fetches from config API).
9. **Roll number sanitization:** Sanitize roll_no for use in file path (e.g. allow only alphanumeric and hyphen) to avoid path traversal or invalid paths.
10. **Dashboard shade E:** Include E in distribution and filters so HOLD (E) is not mixed with REJECT.

## Optional Enhancements

- Camera integration: browser capture or local service that sends frames to backend.
- Config page in UI; backend config endpoint for tolerance.
- Retry/backoff for CSV load; global error boundary and toasts in React.
- Context manager for Camera; camera reconnect logic if used.
- Async/thread pool for analyze to avoid blocking event loop under load.
- Pagination or virtualized table for large inspection log.
- Export CSV from backend (from DB) for date range.

## What Is Already Strong

- **Color engine structure:** Preprocess → ROI → LAB → stats is clear. CIEDE2000 implementation is correct once LAB scale is fixed.
- **Grouping logic:** Simple, readable, and consistent within backend; easy to make configurable.
- **UI layout and UX:** Dashboard and Inspection screens are well structured for an industrial QC workflow; stats, charts, and filters are appropriate.
- **Frontend stack:** React, Recharts, PapaParse, and CSS variables are used sensibly; code is maintainable.
- **Separation of concerns:** Camera, color, grouping, and API are in separate modules; integration points are few and clear once bugs are fixed.

---

*End of Technical Audit*
