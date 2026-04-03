import React, { useState, useEffect } from 'react';
import { Bell, ChevronRight } from 'lucide-react';
import './styles.css';
import Papa from 'papaparse';
import API from './api/api';
import Sidebar from './Sidebar';
import Dashboard from './Dashboard';
import Inspection from './Inspection';
import Logs from './Logs';
import { shadeHistory } from './data';

const DEFAULT_IMAGE_BY_ROLL = new Map(
  shadeHistory.map((x) => [String(x.rollNo).trim().toUpperCase(), x.image])
);

function resolveHistoryImageUrl(imagePath) {
  if (imagePath == null || imagePath === '') return null;
  const s = String(imagePath).trim();
  if (/^https?:\/\//i.test(s)) return s;
  const base = (API.defaults.baseURL || '').replace(/\/$/, '');
  if (!base) return s.startsWith('/') ? s : `/${s}`;
  return `${base}${s.startsWith('/') ? s : `/${s}`}`;
}

const App = () => {
  // Simple Router State
  const [page, setPage] = useState('dashboard');

  // Global Data State: default to src/data.js so deployed app reflects data.js updates
  const [history, setHistory] = useState(() => [...shadeHistory]);
  const [loadError, setLoadError] = useState(false);

  // Reload captures saved by the backend (images under /images + inspection_records.jsonl)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await API.get('/inspection-records');
        if (cancelled || !data?.records?.length) return;
        const mapped = data.records.map((r) => ({
          ...r,
          image: resolveHistoryImageUrl(r.image),
        }));
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
  }, []);

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

            // Shade Group Logic (matches backend assign_shade_group: reject only if ΔE >= 5)
            if (!shadeGroup || !shadeGroup.trim()) {
              if (dE >= 5) shadeGroup = 'REJECT';
              else if (dE < 1.25) shadeGroup = 'A';
              else if (dE < 2.5) shadeGroup = 'B';
              else if (dE < 3.75) shadeGroup = 'C';
              else shadeGroup = 'D';
            }

            // Verdict Logic
            if (!verdict || !verdict.trim()) {
              const s = shadeGroup.toUpperCase().trim();
              if (s === 'REJECT' || dE >= 5) verdict = 'REJECT';
              else if (['A', 'B', 'C', 'D'].includes(s)) verdict = 'ACCEPT';
              else verdict = 'ACCEPT';
            }

            // Normalize Verification Text
            verdict = verdict.toUpperCase();
            if (verdict === 'ACCEPTED') verdict = 'ACCEPT';
            if (verdict === 'REJECTED') verdict = 'REJECT';

            // Shade D is not a reject; only ΔE ≥ 5 (or explicit REJECT group) is rejected
            const sg = String(shadeGroup || '').toUpperCase().trim();
            if (verdict === 'REJECT' && dE < 5 && sg === 'D') {
              verdict = 'ACCEPT';
            }

            // Ensure Date has a default if really missing
            if (!date) date = new Date().toISOString().split('T')[0];

            return {
              id: `csv-${index}`,
              date: date,
              rollNo: rollId || `UNK-${index}`,
              buyer: buyer,
              supplier: supplier,
              quantity: Number(quantity) || 0,
              deltaE: dE,
              shade: shadeGroup,
              decision: verdict,
              image: image && String(image).trim() ? image.trim() : null
            };
          });
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
  }, []);

  // Default state for Active Inspection
  const [activeRoll] = useState({
    rollNo: "R-2026-9001",
    quantity: 120,
    buyer: "Zara International",
    deltaE: 0.00,
    shadeGroup: "-",
    imageUrl: null,
  });

  const handleInspectionComplete = (newTest) => {
    // Merge for UI consistency during session
    setHistory(prev => [newTest, ...prev]);
  };

  const handleHistoryRegroup = (updates) => {
    if (!updates?.length) return;
    const m = new Map(
      updates.map((x) => [String(x.rollNo).trim().toUpperCase(), x])
    );
    setHistory((prev) =>
      prev.map((h) => {
        const k = String(h.rollNo).trim().toUpperCase();
        const u = m.get(k);
        if (!u) return h;
        return {
          ...h,
          shade: u.shadeGroup,
          shadeGroup: u.shadeGroup,
          decision: u.decision,
        };
      })
    );
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
              {page === 'dashboard' ? 'OVERVIEW' : 'LIVE INSPECTION'}
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
            onHistoryRegroup={handleHistoryRegroup}
          />
        )}

        {page === 'logs' && (
          <Logs history={history} />
        )}
      </main>
    </div>
  );
};

export default App;
