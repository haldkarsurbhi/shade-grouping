import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Camera, Save, Layers, Printer, RefreshCw } from 'lucide-react';
import './styles.css';
import API from './api/api';

const Inspection = ({ activeRoll: initialRoll, onInspectionComplete, onHistoryRegroup }) => {
    const [sessionTests, setSessionTests] = useState([]);
    const [currentRoll, setCurrentRoll] = useState(initialRoll);
    const [previewImage, setPreviewImage] = useState(null);
    const [loading, setLoading] = useState(false);
    const [regroupBusy, setRegroupBusy] = useState(false);
    const [newLotBusy, setNewLotBusy] = useState(false);
    const [error, setError] = useState(null);
    const [streamKey, setStreamKey] = useState(0);
    const [cameraHint, setCameraHint] = useState('');
    const [pollPreviewUrl, setPollPreviewUrl] = useState(null);
    const [camSwitchBusy, setCamSwitchBusy] = useState(false);

    const mjpegRef = useRef(null);
    const pollBlobRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        const poll = async () => {
            try {
                const res = await API.get('/camera-status', { timeout: 5000 });
                if (cancelled) return;
                const data = res.data;
                const ct = String(res.headers['content-type'] || '');
                // Static hosts (e.g. Vercel) often return index.html 200 for unknown paths — not JSON
                if (
                    !ct.includes('application/json') ||
                    typeof data !== 'object' ||
                    data === null ||
                    typeof data.ok !== 'boolean'
                ) {
                    throw new Error('not_api');
                }
                const ord = (data.try_order || []).join('→');
                setCameraHint(
                    data.ok
                        ? `Camera OK · device ${data.index ?? '?'} · try ${ord || '—'}`
                        : `No camera yet · try order ${ord || '—'} (Use USB/Sony first)`
                );
            } catch {
                if (!cancelled) {
                    setCameraHint(
                        process.env.NODE_ENV === 'production'
                            ? 'No API — set REACT_APP_API_URL in Vercel to your FastAPI URL, redeploy, then hard-refresh.'
                            : 'Backend offline — start uvicorn on :8000'
                    );
                }
            }
        };
        poll();
        const id = setInterval(poll, 2000);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);

    const trimOrigin = (s) => String(s || '').replace(/\/$/, '');

    const API_BASE = useMemo(
        () => trimOrigin(API.defaults.baseURL || (typeof window !== 'undefined' ? window.location.origin : '')),
        []
    );

    const imageBaseUrl = API_BASE;

    /**
     * Base URL for camera JPEG fetch (snapshot polling). Same host as backend — not CRA proxy.
     * Multipart MJPEG in <img> is unreliable in several browsers even when the camera works.
     */
    const liveStreamBase = useMemo(() => {
        if (process.env.REACT_APP_CAMERA_BASE_URL) {
            return trimOrigin(process.env.REACT_APP_CAMERA_BASE_URL);
        }
        const apiEnv = process.env.REACT_APP_API_URL;
        if (apiEnv && String(apiEnv).trim()) {
            return trimOrigin(apiEnv);
        }
        if (typeof window === 'undefined') {
            return '';
        }
        const { hostname, origin } = window.location;
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return 'http://127.0.0.1:8000';
        }
        // Vercel etc.: never use :8000 on the page origin; use API env or same origin (footer label only)
        return trimOrigin(origin);
    }, []);

    const reloadStream = useCallback(() => {
        setStreamKey((k) => k + 1);
    }, []);

    const postCameraPreference = useCallback(
        async (mode) => {
            setCamSwitchBusy(true);
            try {
                const fd = new FormData();
                fd.append('mode', mode);
                await API.post('/camera-preference', fd);
                reloadStream();
            } catch {
                alert('Could not change camera preference. Is the backend running?');
            } finally {
                setCamSwitchBusy(false);
            }
        },
        [reloadStream]
    );

    const postCameraIndex = useCallback(
        async (index) => {
            setCamSwitchBusy(true);
            try {
                const fd = new FormData();
                fd.append('index', String(index));
                await API.post('/camera-use-index', fd);
                reloadStream();
            } catch {
                alert('Could not switch camera index.');
            } finally {
                setCamSwitchBusy(false);
            }
        },
        [reloadStream]
    );

    useEffect(() => {
        if (currentRoll.imageUrl) {
            if (pollBlobRef.current) {
                URL.revokeObjectURL(pollBlobRef.current);
                pollBlobRef.current = null;
            }
            setPollPreviewUrl(null);
            return undefined;
        }

        let stopped = false;
        let timeoutId;

        const schedule = (ms) => {
            timeoutId = window.setTimeout(tick, ms);
        };

        async function tick() {
            if (stopped) return;
            try {
                const res = await fetch(`${liveStreamBase}/camera-snapshot?ts=${Date.now()}`, {
                    cache: 'no-store',
                    credentials: 'omit',
                });
                if (stopped) return;
                const ct = res.headers.get('content-type') || '';
                if (res.ok && ct.includes('image') && !ct.includes('json')) {
                    const blob = await res.blob();
                    if (!stopped && blob.size > 400) {
                        const url = URL.createObjectURL(blob);
                        if (pollBlobRef.current) URL.revokeObjectURL(pollBlobRef.current);
                        pollBlobRef.current = url;
                        setPollPreviewUrl(url);
                    }
                }
            } catch {
                /* network / CORS */
            }
            if (!stopped) schedule(160);
        }

        schedule(0);
        return () => {
            stopped = true;
            if (timeoutId) window.clearTimeout(timeoutId);
            if (pollBlobRef.current) {
                URL.revokeObjectURL(pollBlobRef.current);
                pollBlobRef.current = null;
            }
            setPollPreviewUrl(null);
        };
    }, [currentRoll.imageUrl, liveStreamBase, streamKey]);

    const snapVideoFrame = useCallback(() => {
        const el = mjpegRef.current;
        if (!el) return null;
        const w = el.naturalWidth || el.width || el.clientWidth;
        const h = el.naturalHeight || el.height || el.clientHeight;
        if (w < 2 || h < 2) return null;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(el, 0, 0, w, h);
        return new Promise((resolve) => {
            canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
        });
    }, []);

    const [rollInput, setRollInput] = useState(initialRoll.rollNo);
    const [qtyInput, setQtyInput] = useState(initialRoll.quantity);
    const [buyerInput, setBuyerInput] = useState(initialRoll.buyer);
    const [supplierInput, setSupplierInput] = useState('');

    const getRecentByShade = (shade) => {
        const norm = (s) => String(s ?? '').toUpperCase().trim();
        const matchesShade = (item) => {
            const sh = norm(item.shade ?? item.shadeGroup);
            const t = norm(shade);
            if (t === 'D') return sh === 'D' || sh === 'REJECT';
            return sh === t;
        };
        const seen = new Set();
        const out = [];
        // Session only — do not mix dashboard/CSV/demo history into shade reference cards
        for (const item of sessionTests) {
            if (!item?.image || !matchesShade(item)) continue;
            const key = item.id ?? item.rollNo;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(item);
            if (out.length >= 3) break;
        }
        return out;
    };

    const handleCapture = async () => {
        if (!supplierInput.trim()) {
            alert('Please enter a Supplier name.');
            return;
        }

        setError(null);
        setLoading(true);

        try {
            let blob = null;
            try {
                const res = await API.get('/camera-snapshot', { responseType: 'blob' });
                const b = res.data;
                if (b instanceof Blob && b.size > 2000 && b.type !== 'application/json') {
                    blob = b;
                }
            } catch {
                /* use canvas fallback below */
            }
            if (!blob) {
                blob = await snapVideoFrame();
            }
            if (!blob) {
                const msg =
                    'No frame from camera. Check /camera-status in browser (proxy to backend) and USB permissions.';
                setError(msg);
                alert(msg);
                setLoading(false);
                return;
            }

            const formData = new FormData();
            formData.append('roll_no', rollInput);
            formData.append('quantity', Number(qtyInput) || 0);
            formData.append('image', blob, `${rollInput}.jpg`);

            const { data } = await API.post('/analyze', formData);

            const imageUrl = data.image ? `${imageBaseUrl}${data.image}` : null;
            const lab = Array.isArray(data.lab) && data.lab.length >= 3 ? data.lab : null;

            const newTest = {
                id: Date.now(),
                date: new Date().toISOString().split('T')[0],
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                rollNo: data.roll_no,
                quantity: data.quantity,
                deltaE: data.delta_e,
                shade: data.shade_group,
                shadeGroup: data.shade_group,
                decision: data.decision,
                image: imageUrl,
                lab,
                isLotReference: !!data.is_lot_reference,
                buyer: buyerInput,
                supplier: supplierInput,
                orderId: 'ORD-DEMO',
            };

            setSessionTests((prev) => [newTest, ...prev]);
            onInspectionComplete(newTest);
            setCurrentRoll((prev) => ({ ...prev, imageUrl }));
        } catch (err) {
            const isNetworkError =
                err.message === 'Network Error' || err.code === 'ECONNREFUSED' || err.code === 'ERR_NETWORK';
            const message = isNetworkError
                ? 'Connection failed. Start the backend (uvicorn app:app --host 127.0.0.1 --port 8000).'
                : err.response?.data?.error || err.message || 'Analysis failed';
            setError(message);
            alert(message);
        } finally {
            setLoading(false);
        }
    };

    const resumeLiveCamera = () => {
        setCurrentRoll((prev) => ({ ...prev, imageUrl: null }));
        reloadStream();
    };

    const handleNewLot = async () => {
        if (sessionTests.length > 0) {
            const ok = window.confirm(
                'Start a new lot? This clears the live session and resets the reference. The next capture will be ΔE 0; following captures compare to that roll.'
            );
            if (!ok) return;
        }
        setNewLotBusy(true);
        setError(null);
        try {
            await API.post('/lot-reference/reset');
            setSessionTests([]);
        } catch {
            alert('Could not reset lot reference. Is the backend running?');
        } finally {
            setNewLotBusy(false);
        }
    };

    const escapeCsvCell = (v) => {
        const s = v == null ? '' : String(v);
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    };

    const handleManualSave = () => {
        if (!sessionTests.length) {
            alert('Nothing to save — capture at least one roll in this session.');
            return;
        }
        const headers = [
            'Time',
            'Roll ID',
            'Buyer',
            'Supplier',
            'Quantity (m)',
            'DeltaE',
            'L*',
            'a*',
            'b*',
            'Shade Group',
            'Verdict',
            'Image',
        ];
        const rows = sessionTests.map((t) => {
            const lab = t.lab;
            return [
                t.time,
                t.rollNo,
                t.buyer,
                t.supplier,
                t.quantity,
                typeof t.deltaE === 'number' ? t.deltaE.toFixed(4) : t.deltaE,
                lab?.[0] ?? '',
                lab?.[1] ?? '',
                lab?.[2] ?? '',
                t.shade || t.shadeGroup,
                t.decision,
                t.image || '',
            ].map(escapeCsvCell);
        });
        const csv = '\ufeff' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `shade_session_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const handlePrintLotReport = () => {
        if (!sessionTests.length) {
            alert('Nothing to print — capture at least one roll in this session.');
            return;
        }
        const esc = (v) => {
            if (v == null || v === '') return '—';
            return String(v)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        };
        const escAttr = (v) =>
            String(v ?? '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;');

        const chronological = [...sessionTests].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
        const generated = new Date().toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
        });

        // Hidden iframe: avoids pop-up blockers and window.open(..., "noopener") returning null (no document handle).
        const iframe = document.createElement('iframe');
        iframe.setAttribute('title', 'Print lot report');
        iframe.setAttribute('aria-hidden', 'true');
        Object.assign(iframe.style, {
            position: 'fixed',
            right: '0',
            bottom: '0',
            width: '0',
            height: '0',
            border: '0',
            opacity: '0',
            pointerEvents: 'none',
        });
        document.body.appendChild(iframe);
        const printWin = iframe.contentWindow;
        const printDoc = printWin?.document;
        if (!printDoc) {
            document.body.removeChild(iframe);
            alert('Could not open print view. Try again or use Manual Save and print the CSV.');
            return;
        }

        const styles = `
            * { box-sizing: border-box; }
            body { font-family: system-ui, Segoe UI, sans-serif; margin: 16px; color: #111; }
            h1 { font-size: 1.35rem; margin: 0 0 4px; }
            .meta { font-size: 0.85rem; color: #444; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
            th, td { border: 1px solid #ccc; padding: 8px; vertical-align: middle; text-align: left; }
            th { background: #f0f0f0; font-weight: 600; }
            tr { page-break-inside: avoid; }
            .img-cell { width: 150px; text-align: center; }
            .img-cell img { max-width: 140px; max-height: 140px; width: auto; height: auto; object-fit: contain; display: block; margin: 0 auto; }
            .no-img { color: #888; font-size: 0.75rem; }
            .num { font-variant-numeric: tabular-nums; }
            .shade { font-weight: 700; }
            tfoot td { border: none; padding-top: 12px; font-size: 0.8rem; color: #555; }
            @page { margin: 12mm; }
        `;

        const bodyRows = chronological
            .map((t) => {
                const shade = t.shade || t.shadeGroup || '—';
                const de =
                    typeof t.deltaE === 'number' && !Number.isNaN(t.deltaE)
                        ? t.deltaE.toFixed(2)
                        : esc(t.deltaE);
                const deLabel = t.isLotReference ? `ΔE ${de} (ref)` : `ΔE ${de}`;
                const imgHtml = t.image
                    ? `<img src="${escAttr(t.image)}" alt="Roll ${escAttr(t.rollNo)}" />`
                    : '<span class="no-img">No image</span>';
                return `<tr>
                    <td class="img-cell">${imgHtml}</td>
                    <td class="num">${esc(t.time)}</td>
                    <td><strong>${esc(t.rollNo)}</strong></td>
                    <td>${esc(t.buyer)}</td>
                    <td>${esc(t.supplier)}</td>
                    <td class="num">${esc(t.quantity)} m</td>
                    <td class="shade">${esc(shade)}</td>
                    <td class="num">${deLabel}</td>
                    <td>${esc(t.decision)}</td>
                </tr>`;
            })
            .join('');

        printDoc.open();
        printDoc.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Lot inspection report</title>
  <style>${styles}</style>
</head>
<body>
  <h1>ShaDE — Lot inspection report</h1>
  <div class="meta">Generated: ${esc(generated)} · Rolls in lot: ${chronological.length}</div>
  <table>
    <thead>
      <tr>
        <th>Image</th>
        <th>Time</th>
        <th>Roll no.</th>
        <th>Buyer</th>
        <th>Supplier</th>
        <th>Length</th>
        <th>Shade</th>
        <th>ΔE</th>
        <th>Verdict</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
    <tfoot><tr><td colspan="9">End of report</td></tr></tfoot>
  </table>
</body>
</html>`);
        printDoc.close();

        const cleanup = () => {
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        };

        let printed = false;
        const runPrint = () => {
            if (printed) return;
            printed = true;
            try {
                printWin.focus();
                printWin.print();
            } catch {
                /* ignore */
            }
            setTimeout(cleanup, 500);
        };

        const imgs = printDoc.images;
        let pending = 0;
        for (let i = 0; i < imgs.length; i++) {
            if (!imgs[i].complete) pending++;
        }
        if (pending === 0) {
            setTimeout(runPrint, 150);
            return;
        }
        let left = pending;
        const tick = () => {
            left -= 1;
            if (left <= 0) setTimeout(runPrint, 150);
        };
        for (let i = 0; i < imgs.length; i++) {
            const img = imgs[i];
            if (img.complete) continue;
            img.onload = tick;
            img.onerror = tick;
        }
        setTimeout(() => {
            if (!printed) runPrint();
        }, 8000);
    };

    const handleRegroupByL = async () => {
        const rollsPayload = sessionTests
            .map((t) => {
                const lab = t.lab;
                const L = lab?.[0];
                if (L == null || Number.isNaN(Number(L))) return null;
                return { roll_no: t.rollNo, L_star: Number(L) };
            })
            .filter(Boolean);
        if (!rollsPayload.length) {
            alert('No scans with L* in this session. Capture rolls using the backend analyze step first.');
            return;
        }
        setRegroupBusy(true);
        setError(null);
        try {
            const { data } = await API.post('/regroup-lightness', { rolls: rollsPayload });
            const list = data?.rolls;
            if (!Array.isArray(list)) {
                throw new Error('Invalid response from regroup-lightness');
            }
            const byRoll = new Map(list.map((r) => [r.roll_no, r]));
            const nextSession = sessionTests.map((t) => {
                const u = byRoll.get(t.rollNo);
                if (!u) return t;
                return {
                    ...t,
                    shade: u.shade_group,
                    shadeGroup: u.shade_group,
                    decision: u.decision,
                };
            });
            setSessionTests(nextSession);
            if (onHistoryRegroup) {
                const updates = nextSession
                    .filter((t) => byRoll.has(t.rollNo))
                    .map((t) => ({
                        rollNo: t.rollNo,
                        shadeGroup: byRoll.get(t.rollNo).shade_group,
                        decision: byRoll.get(t.rollNo).decision,
                    }));
                onHistoryRegroup(updates);
            }
        } catch (err) {
            const msg =
                err.response?.data?.error ||
                err.message ||
                'Regroup failed. Is the backend running?';
            setError(msg);
            alert(msg);
        } finally {
            setRegroupBusy(false);
        }
    };

    return (
        <div className="operator-screen">
            <section className="control-bar-dense">
                <div className="control-bar-top inspection-toolbar">
                    <div className="inspection-toolbar-left">
                        <div className="inspection-field-grid">
                            <div className="input-group-dense">
                                <label htmlFor="insp-roll-id">Roll ID</label>
                                <input
                                    id="insp-roll-id"
                                    type="text"
                                    value={rollInput}
                                    onChange={(e) => setRollInput(e.target.value)}
                                />
                            </div>
                            <div className="input-group-dense">
                                <label htmlFor="insp-length">Length (m)</label>
                                <input
                                    id="insp-length"
                                    type="number"
                                    className="inspection-input-qty"
                                    value={qtyInput}
                                    onChange={(e) => setQtyInput(e.target.value)}
                                />
                            </div>
                            <div className="input-group-dense">
                                <label htmlFor="insp-buyer">Buyer</label>
                                <input
                                    id="insp-buyer"
                                    type="text"
                                    value={buyerInput}
                                    onChange={(e) => setBuyerInput(e.target.value)}
                                />
                            </div>
                            <div className="input-group-dense">
                                <label htmlFor="insp-supplier">Supplier</label>
                                <input
                                    id="insp-supplier"
                                    type="text"
                                    value={supplierInput}
                                    onChange={(e) => setSupplierInput(e.target.value)}
                                    placeholder="e.g. Arvind Mills"
                                />
                            </div>
                        </div>
                        <div className="inspection-camera-inline">
                            <span className="inspection-camera-label">Camera</span>
                            <div className="camera-actions-inner">
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-compact"
                                    disabled={camSwitchBusy}
                                    onClick={() => postCameraPreference('usb_first')}
                                    title="Try indices 1,2,3 before 0 — use external Sony/USB"
                                >
                                    USB / Sony first
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-compact"
                                    disabled={camSwitchBusy}
                                    onClick={() => postCameraPreference('laptop_first')}
                                >
                                    Laptop first
                                </button>
                                <label htmlFor="insp-cam-index" className="camera-index-label">
                                    Index
                                    <select
                                        id="insp-cam-index"
                                        disabled={camSwitchBusy}
                                        defaultValue=""
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            if (v === '') return;
                                            postCameraIndex(parseInt(v, 10));
                                            e.target.value = '';
                                        }}
                                        className="camera-index-select"
                                    >
                                        <option value="">—</option>
                                        {[0, 1, 2, 3, 4, 5].map((i) => (
                                            <option key={i} value={i}>
                                                {i}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div className="actions-dense">
                        <button className="btn btn-primary btn-compact" onClick={handleCapture} disabled={loading}>
                            <Camera size={16} /> {loading ? 'Analyzing…' : 'Capture Scan'}
                        </button>
                        <button type="button" className="btn btn-secondary btn-compact" onClick={reloadStream}>
                            Reload stream
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary btn-compact"
                            onClick={handleNewLot}
                            disabled={newLotBusy}
                            title="Clear session and reset reference — next scan is ΔE 0, others compare to it"
                        >
                            <RefreshCw size={16} /> {newLotBusy ? 'Resetting…' : 'New lot'}
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary btn-compact"
                            onClick={handleRegroupByL}
                            disabled={regroupBusy || sessionTests.length === 0}
                            title="Reassign A–D by L* quartiles within this session (light→dark)"
                        >
                            <Layers size={16} /> {regroupBusy ? 'Regrouping…' : 'Regroup by L*'}
                        </button>
                        <button type="button" className="btn btn-secondary btn-compact" onClick={handleManualSave}>
                            <Save size={16} /> Manual Save
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary btn-compact"
                            onClick={handlePrintLotReport}
                            disabled={sessionTests.length === 0}
                            title="Open a printable report for the current session (image, shade, ΔE, buyer, supplier, roll, length)"
                        >
                            <Printer size={16} /> Print lot report
                        </button>
                    </div>
                </div>
                <p className="control-bar-hint">
                    <strong>ΔE</strong> is measured vs the <strong>first capture in this lot</strong> (that row shows{' '}
                    <strong>0</strong> as the reference). Later rolls get A–D / REJECT from your ΔE rules. Use{' '}
                    <strong>New lot</strong> before another batch; restart the server also clears the reference.
                </p>
                {error && <div className="inspection-error-msg">{error}</div>}
            </section>

            <section className="main-workspace">
                <div className="inspection-col-camera">
                    <div className="live-feed-card">
                        <div className="feed-header">
                            <span className="live-indicator">● LIVE</span>
                            <span className="feed-meta">{cameraHint || 'Checking camera…'}</span>
                        </div>
                        <div className="live-feed-preview-square">
                            {currentRoll.imageUrl ? (
                                <img src={currentRoll.imageUrl} className="feed-media feed-image" alt="Last capture" />
                            ) : pollPreviewUrl ? (
                                <img
                                    key={streamKey}
                                    ref={mjpegRef}
                                    src={pollPreviewUrl}
                                    className="feed-media feed-video"
                                    alt="Live USB camera"
                                />
                            ) : (
                                <div className="feed-placeholder">Loading camera preview…</div>
                            )}
                            <div className="reticle-box reticle-overlay">
                                <div className="corner c-tl"></div>
                                <div className="corner c-tr"></div>
                                <div className="corner c-bl"></div>
                                <div className="corner c-br"></div>
                                <div className="center-cross"></div>
                            </div>
                        </div>

                        <div className="feed-footer">
                            <span>
                                <strong>Preview:</strong> /camera-snapshot (~6/s)
                            </span>
                            <span>
                                <strong>API:</strong> {liveStreamBase}
                            </span>
                            {currentRoll.imageUrl && (
                                <button type="button" className="btn-link-live" onClick={resumeLiveCamera}>
                                    Show live preview
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="inspection-col-shades">
                    <div className="ref-sidebar">
                    <h4 className="panel-title">Visual Shade Match Standards</h4>
                    <div className="shade-preview-container">
                        <div className="shade-group-card">
                            <div className="shade-card-header s-a-text">Shade A</div>
                            <div className="preview-grid">
                                {getRecentByShade('A').map((item, i) => (
                                    <div key={i} className="preview-thumb" onClick={() => setPreviewImage(item.image)}>
                                        <img src={item.image} alt="Ref A" />
                                    </div>
                                ))}
                                {getRecentByShade('A').length === 0 && (
                                    <span className="empty-text">No Reference Image</span>
                                )}
                            </div>
                        </div>

                        <div className="shade-group-card">
                            <div className="shade-card-header s-b-text">Shade B</div>
                            <div className="preview-grid">
                                {getRecentByShade('B').map((item, i) => (
                                    <div key={i} className="preview-thumb" onClick={() => setPreviewImage(item.image)}>
                                        <img src={item.image} alt="Ref B" />
                                    </div>
                                ))}
                                {getRecentByShade('B').length === 0 && (
                                    <span className="empty-text">No Reference Image</span>
                                )}
                            </div>
                        </div>

                        <div className="shade-group-card">
                            <div className="shade-card-header s-c-text">Shade C</div>
                            <div className="preview-grid">
                                {getRecentByShade('C').map((item, i) => (
                                    <div key={i} className="preview-thumb" onClick={() => setPreviewImage(item.image)}>
                                        <img src={item.image} alt="Ref C" />
                                    </div>
                                ))}
                                {getRecentByShade('C').length === 0 && (
                                    <span className="empty-text">No Reference Image</span>
                                )}
                            </div>
                        </div>

                        <div className="shade-group-card">
                            <div className="shade-card-header s-d-text">Shade D (Reject)</div>
                            <div className="preview-grid">
                                {getRecentByShade('D').map((item, i) => (
                                    <div key={i} className="preview-thumb" onClick={() => setPreviewImage(item.image)}>
                                        <img src={item.image} alt="Ref D" />
                                    </div>
                                ))}
                                {getRecentByShade('D').length === 0 && (
                                    <span className="empty-text">No Reference Image</span>
                                )}
                            </div>
                        </div>
                    </div>
                    </div>
                </div>
            </section>

            <section className="session-panel session-panel--card">
                <div className="panel-header-dense">
                    <h4 className="session-log-title">Live Inspection Session Log</h4>
                    <div className="session-stats">
                        <span className="count-badge">{sessionTests.length} Records</span>
                    </div>
                </div>
                <div className="table-wrapper-industrial">
                    <table className="table-industrial">
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Roll ID</th>
                                <th>Buyer</th>
                                <th>Supplier</th>
                                <th>Quantity</th>
                                <th>ΔE</th>
                                <th>Shade Group</th>
                                <th>Verdict</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sessionTests.length === 0 ? (
                                <tr>
                                    <td colSpan="8" className="empty-table-msg">
                                        Waiting for new scan...
                                    </td>
                                </tr>
                            ) : (
                                sessionTests.map((test) => (
                                    <tr key={test.id}>
                                        <td className="font-mono text-muted">{test.time}</td>
                                        <td className="font-mono font-bold">{test.rollNo}</td>
                                        <td>{test.buyer || '-'}</td>
                                        <td>{test.supplier || '-'}</td>
                                        <td>{test.quantity} m</td>
                                        <td>
                                            {test.isLotReference ? (
                                                <span className="text-muted" title="Lot reference — compared to itself">
                                                    {typeof test.deltaE === 'number' ? test.deltaE.toFixed(2) : test.deltaE}{' '}
                                                    <span style={{ fontSize: '0.75em' }}>(ref)</span>
                                                </span>
                                            ) : (
                                                <span className={test.deltaE > 1.0 ? 'fw-bold' : ''}>
                                                    {typeof test.deltaE === 'number' ? test.deltaE.toFixed(2) : test.deltaE}
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            <span
                                                className={`shade-badge shade-${(test.shade || test.shadeGroup || '').toLowerCase()}`}
                                            >
                                                {test.shade || test.shadeGroup}
                                            </span>
                                        </td>
                                        <td>
                                            <span
                                                className={`verdict-badge verdict-${(test.decision || '').toLowerCase()}`}
                                            >
                                                {test.decision}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            {previewImage && (
                <div className="modal-backdrop" onClick={() => setPreviewImage(null)}>
                    <div className="modal-content">
                        <img src={previewImage} alt="Ref Preview" />
                        <p>Fabric Reference Preview</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Inspection;
