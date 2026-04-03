# ShaDE desktop (one-click app)

This folder runs **Electron**, which:

1. Starts **FastAPI** (`uvicorn app:app` on `127.0.0.1:8000`) from the project root  
2. Opens a window to **http://127.0.0.1:8000/ui/** (the built React UI served by the same server)

## One-time setup

1. **Python** (3.10+): install dependencies from the project root:

   ```bash
   pip install -r requirements.txt
   ```

   Optional: create a venv at project root as `.venv` — the desktop app will use it automatically.

2. **Frontend build** (required):

   ```bash
   cd frontend
   npm install
   npm run build
   ```

3. **Electron**:

   ```bash
   cd desktop
   npm install
   ```

## Run the desktop app

From `desktop/`:

```bash
npm start
```

Or double-click **`Start-ShaDE-Desktop.bat`** in the project root (Windows).

## Without Electron (browser only)

Double-click **`Start-ShaDE-Browser.bat`**: it starts uvicorn in a minimized window and opens the UI in your default browser.

## How it works

- **`app.py`** serves the React production build under **`/ui/`** when `frontend/build/index.html` exists.  
- **`/`** redirects to **`/ui/`**.  
- API routes (`/analyze`, `/camera-snapshot`, …) stay on the same origin, so the UI works without `REACT_APP_API_URL`.

## Packaging an `.exe` installer (optional)

Tools such as **electron-builder** can bundle Electron + your code into an installer. You would still need **Python** and **`pip install -r requirements.txt`** on the target PC unless you also bundle a Python runtime (larger setup).
