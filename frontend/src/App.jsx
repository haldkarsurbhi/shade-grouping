import React, { useState, useEffect } from 'react';
import { Bell, ChevronRight } from 'lucide-react';
import './styles.css';
import Papa from 'papaparse';
import API from './api/api';
import Sidebar from './Sidebar';
import Dashboard from './Dashboard';
import Inspection from './Inspection';
import Logs from './Logs';
import Config from './Config';
import { shadeHistory } from './data';
import { decisionFromShade, normalizeInspectionRecord, normalizeShade } from './utils/shadeRules';

const DEFAULT_IMAGE_BY_ROLL = new Map(
  shadeHistory.map((x) => [String(x.rollNo).trim().toUpperCase(), x.image])
);
const DELETED_LOTS_STORAGE_KEY = 'shade_deleted_lots_v1';
const PLACEHOLDER_LOT_IDS = new Set(['', 'CAPTURE', 'ORD-DEMO', '-']);

function normalizeLotPart(value, fallback) {
  const s = String(value || '').trim().toUpperCase();
  if (!s) return fallback;
  return s.replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function deriveLotId(row) {
  const raw = String(row?.orderId ?? row?.lotId ?? '').trim();
  if (raw && !PLACEHOLDER_LOT_IDS.has(raw.toUpperCase())) return raw;
  const datePart = normalizeLotPart(row?.date, 'NO-DATE');
  const buyerPart = normalizeLotPart(row?.buyer, 'NO-BUYER');
  const supplierPart = normalizeLotPart(row?.supplier, 'NO-SUPPLIER');
  return `LOT-${datePart}-${buyerPart}-${supplierPart}`;
}

function ensureLotId(row) {
  const lotId = deriveLotId(row);
  return { ...row, orderId: lotId, lotId };
}

function resolveHistoryImageUrl(imagePath) {
  if (imagePath == null || imagePath === '') return null;
  const s = String(imagePath).trim();
  if (/^https?:\/\//i.test(s)) return s;
  const base = (API.defaults.baseURL || '').replace(/\/$/, '');
  if (!base) return s.startsWith('/') ? s : `/${s}`;
  return `${base}${s.startsWith('/') ? s : `/${s}`}`;
}

const normalizedSeedHistory = shadeHistory.map((row) => ensureLotId(normalizeInspectionRecord(row)));

const App = () => {
  // Simple Router State
  const [page, setPage] = useState('dashboard');

  // Global Data State: default to src/data.js so deployed app reflects data.js updates
  const [deletedLots, setDeletedLots] = useState(() => {
    try {
      const raw = localStorage.getItem(DELETED_LOTS_STORAGE_KEY);
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  });
  const [history, setHistory] = useState(() =>
    normalizedSeedHistory.filter((row) => !deletedLots.includes(deriveLotId(row)))
  );
  const [loadError, setLoadError] = useState(false);

  const persistDeletedLots = (updater) => {
    setDeletedLots((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      localStorage.setItem(DELETED_LOTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleDeleteLot = (lotId) => {
    const target = String(lotId || '').trim();
    if (!target) return;
    persistDeletedLots((prev) => (prev.includes(target) ? prev : [...prev, target]));
    setHistory((prev) => prev.filter((row) => deriveLotId(row) !== target));
  };

  const handleRestoreDeletedLots = () => {
    localStorage.removeItem(DELETED_LOTS_STORAGE_KEY);
    setDeletedLots([]);
    setHistory([...normalizedSeedHistory]);
  };

  // Reload captures saved by the backend (images under /images + inspection_records.jsonl)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await API.get('/inspection-records');
        if (cancelled || !data?.records?.length) return;
        const mapped = data.records
          .map((r) =>
            ensureLotId(
              normalizeInspectionRecord({
                ...r,
                image: resolveHistoryImageUrl(r.image),
              })
            )
          )
          .filter((row) => !deletedLots.includes(deriveLotId(row)));
        setHistory((prev) => {
          const seen = new Set(mapped.map((x) => x.id));
          const rest = prev.filter((row) => !seen.has(row.id));
          return [...mapped, ...rest];
        });
      } catch {
        /* API offline — keep local/demo data */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deletedLots]);

  // Optional: load CSV from public/inspection_data.csv; if present, it overrides data.js
  useEffect(() => {
    const csvUrl = process.env.PUBLIC_URL + '/inspection_data.csv';

    Papa.parse(csvUrl, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data && results.data.length > 0) {
          const parsedData = results.data.map((row, index) => {
            // STEP 2: FIELD MAPPING (Exact Match)
            // Using a helper to safely access keys even if they have extra spaces in CSV

            const getVal = (colName) => {
              if (row[colName] !== undefined) return row[colName];

              // Fallback: Case-insensitive trim match if headers are slightly off
              const foundKey = Object.keys(row).find(k => k.trim().toLowerCase() === colName.toLowerCase());
              if (foundKey) return row[foundKey];
              return "";
            };

            let date = getVal('Date');
            let rollId = getVal('Roll ID');
            let buyer = getVal('Buyer');
            let supplier = getVal('Supplier');
            let quantity = getVal('Quantity (m)');
            let deltaE = getVal('DeltaE');
            let shadeGroup = getVal('Shade Group');
            let verdict = getVal('Verdict');
            let image = getVal('Image');
            if (!image || !String(image).trim()) {
              const rk = String(rollId || '').trim().toUpperCase();
              image = DEFAULT_IMAGE_BY_ROLL.get(rk) || '';
            }

            // STEP 3: AUTO-FILL (ONLY IF FIELD IS EMPTY)
            // Buyer
            if (!buyer || !buyer.trim()) buyer = "Not Entered";

            // Supplier
            if (!supplier || !supplier.trim()) supplier = "Not Entered";

            // Numeric Parsing
            let dE = parseFloat(deltaE);
            if (isNaN(dE)) dE = 0;

            // Shade Group Logic
            if (!shadeGroup || !shadeGroup.trim()) {
              shadeGroup = normalizeShade('', dE);
            }

            // Verdict Logic
            if (!verdict || !verdict.trim()) {
              verdict = decisionFromShade(shadeGroup);
            }

            // Normalize Verification Text
            verdict = verdict.toUpperCase();
            if (verdict === 'ACCEPTED') verdict = 'ACCEPT';
            if (verdict === 'REJECTED') verdict = 'REJECT';

            const normalizedShade = normalizeShade(shadeGroup, dE);
            const normalizedDecision = decisionFromShade(normalizedShade);

            // Ensure Date has a default if really missing
            if (!date) date = new Date().toISOString().split('T')[0];

            return ensureLotId(normalizeInspectionRecord({
              id: `csv-${index}`,
              date: date,
              rollNo: rollId || String(index + 1).padStart(3, '0'),
              buyer: buyer,
              supplier: supplier,
              quantity: Number(quantity) || 0,
              deltaE: dE,
              shade: normalizedShade,
              decision: normalizedDecision,
              image: image && String(image).trim() ? image.trim() : null
            }));
          }).filter((row) => !deletedLots.includes(deriveLotId(row)));
          // Keep in-memory captures and server-persisted rows; CSV supplements demo data.
          setHistory((prev) => {
            const keep = prev.filter(
              (row) => typeof row.id === 'number' || row.persistedFromApi === true
            );
            return [...keep, ...parsedData];
          });
          setLoadError(false);
        } else {
          // No CSV data: keep initial data.js (shadeHistory); no error
          setLoadError(false);
        }
      },
      error: (err) => {
        console.error("CSV Parse Error:", err);
        // Keep data.js on CSV failure so dashboard still shows
        setLoadError(false);
      }
    });
  }, [deletedLots]);

  // Default state for Active Inspection
  const [activeRoll] = useState({
    rollNo: "001",
    quantity: 120,
    buyer: "Zara International",
    deltaE: 0.00,
    shadeGroup: "-",
    imageUrl: null,
  });

  const handleInspectionComplete = (newTest) => {
    // Merge for UI consistency during session
    const normalized = ensureLotId(normalizeInspectionRecord(newTest));
    if (deletedLots.includes(deriveLotId(normalized))) return;
    setHistory(prev => [normalized, ...prev]);
  };

  return (
    <div className="app-shell">
      {/* 1. Sidebar (Pass setPage for nav) */}
      <Sidebar page={page} setPage={setPage} />

      {/* 2. Main Content Area */}
      <main className="app-main">
        {/* Top Header */}
        <header className="top-header">
          <div className="breadcrumbs">
            <span className="crumb-root">SYSTEM</span>
            <ChevronRight size={14} className="crumb-sep" />
            <span className="crumb-module">SHADE QC</span>
            <ChevronRight size={14} className="crumb-sep" />
            <span className="crumb-page">
              {page === 'dashboard'
                ? 'OVERVIEW'
                : page === 'inspection'
                  ? 'LIVE INSPECTION'
                  : page === 'logs'
                    ? 'INSPECTION LOGS'
                    : 'CONFIGURATION'}
            </span>
          </div>

          <div className="header-actions">
            <div className="icon-btn">
              <Bell size={18} />
              <span className="badge-dot"></span>
            </div>
          </div>
        </header>

        {/* 3. View Switcher */}
        {page === 'dashboard' && (
          <>
            {loadError ? (
              <div className="error-state" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                Inspection data not available
              </div>
            ) : (
              <Dashboard history={history} />
            )}
          </>
        )}

        {page === 'inspection' && (
          <Inspection
            activeRoll={activeRoll}
            onInspectionComplete={handleInspectionComplete}
          />
        )}

        {page === 'logs' && (
          <Logs
            history={history}
            onDeleteLot={handleDeleteLot}
            onRestoreLots={handleRestoreDeletedLots}
            deletedLotCount={deletedLots.length}
          />
        )}

        {page === 'config' && (
          <Config />
        )}
      </main>
    </div>
  );
};

export default App;
