/**
 * ShaDE desktop: spawn uvicorn from project root, open packaged UI at /ui/
 */
const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

const PROJECT_ROOT = path.join(__dirname, '..');
const HEALTH_URL = 'http://127.0.0.1:8000/health';
const UI_URL = 'http://127.0.0.1:8000/ui/';

let mainWindow = null;
let uvicornProc = null;

function pythonSpec() {
  if (process.platform === 'win32') {
    const venvPy = path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe');
    if (fs.existsSync(venvPy)) {
      return { command: venvPy, shell: false };
    }
    return { command: 'python', shell: true };
  }
  const venvPy = path.join(PROJECT_ROOT, '.venv', 'bin', 'python3');
  if (fs.existsSync(venvPy)) {
    return { command: venvPy, shell: false };
  }
  return { command: 'python3', shell: false };
}

function waitHealth(maxMs = 90000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const req = http.get(HEALTH_URL, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        schedule();
      });
      req.on('error', schedule);
      req.setTimeout(2000, () => {
        req.destroy();
        schedule();
      });
    }
    function schedule() {
      if (Date.now() - start > maxMs) {
        reject(new Error('Backend did not respond on /health in time.'));
        return;
      }
      setTimeout(attempt, 350);
    }
    attempt();
  });
}

function startBackend() {
  const indexHtml = path.join(PROJECT_ROOT, 'frontend', 'build', 'index.html');
  if (!fs.existsSync(indexHtml)) {
    dialog.showErrorBox(
      'ShaDE',
      'Frontend build not found.\n\nOpen a terminal in the project folder and run:\n' +
        '  cd frontend\n' +
        '  npm install\n' +
        '  npm run build\n\nThen start this app again.'
    );
    return false;
  }

  const { command, shell } = pythonSpec();
  const spawnArgs = ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '8000'];

  try {
    uvicornProc = spawn(command, spawnArgs, {
      cwd: PROJECT_ROOT,
      shell,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
  } catch (e) {
    dialog.showErrorBox('ShaDE', 'Failed to start Python:\n' + (e && e.message ? e.message : String(e)));
    return false;
  }

  uvicornProc.stdout.on('data', (d) => process.stdout.write(d));
  uvicornProc.stderr.on('data', (d) => process.stderr.write(d));
  uvicornProc.on('error', (e) => {
    dialog.showErrorBox('ShaDE', 'Backend process error:\n' + e.message);
  });
  uvicornProc.on('exit', (code, signal) => {
    if (code && code !== 0 && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'ShaDE',
        message: `Backend exited (code ${code}). Restart the app.`,
      });
    }
  });

  return true;
}

function killBackend() {
  if (uvicornProc && !uvicornProc.killed) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(uvicornProc.pid), '/f', '/t'], { shell: true, stdio: 'ignore' });
      } else {
        uvicornProc.kill('SIGTERM');
      }
    } catch {
      /* ignore */
    }
    uvicornProc = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(UI_URL);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (!startBackend()) {
    app.quit();
    return;
  }
  try {
    await waitHealth();
  } catch (e) {
    dialog.showErrorBox(
      'ShaDE',
      (e && e.message) + '\n\nCheck that Python dependencies are installed:\n  pip install -r requirements.txt'
    );
    killBackend();
    app.quit();
    return;
  }
  createWindow();
});

app.on('window-all-closed', () => {
  killBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  killBackend();
});
