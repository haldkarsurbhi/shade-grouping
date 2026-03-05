import React, { useState, useEffect, useMemo } from 'react';
import { Search, Bell, ChevronRight } from 'lucide-react';
import './styles.css';
import Papa from 'papaparse';
import Sidebar from './Sidebar';
import Dashboard from './Dashboard';
import Inspection from './Inspection';
import Logs from './Logs';
import { shadeHistory } from './data';

const App = () => {
  // Simple Router State
  const [page, setPage] = useState('dashboard');

  // Global Data State: default to src/data.js so deployed app reflects data.js updates
  const [history, setHistory] = useState(() => [...shadeHistory]);
  const [loadError, setLoadError] = useState(false);

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
              if (dE <= 1.2) shadeGroup = 'A';
              else if (dE > 1.2 && dE <= 2.0) shadeGroup = 'B';
              else if (dE > 2.0 && dE <= 3.0) shadeGroup = 'C';
              else shadeGroup = 'D'; // >3.0
            }

            // Verdict Logic
            if (!verdict || !verdict.trim()) {
              const s = shadeGroup.toUpperCase().trim();
              if (['A', 'B'].includes(s)) verdict = 'ACCEPT';
              else if (['C'].includes(s)) verdict = 'HOLD';
              else if (['D', 'REJECT'].includes(s)) verdict = 'REJECT';
              else verdict = 'HOLD'; // default fallback
            }

            // Normalize Verification Text
            verdict = verdict.toUpperCase();
            if (verdict === 'ACCEPTED') verdict = 'ACCEPT';
            if (verdict === 'REJECTED') verdict = 'REJECT';

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
              image: image || null
            };
          });
          setHistory(parsedData);
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
    imageUrl: "https://images.unsplash.com/photo-1596324823106-963b51b32d56?auto=format&fit=crop&q=80&w=600&h=400"
  });

  const handleInspectionComplete = (newTest) => {
    // Merge for UI consistency during session
    setHistory(prev => [newTest, ...prev]);
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
            <div className="search-box">
              <Search size={14} className="search-icon" />
              <input type="text" placeholder="Scan Roll ID..." />
            </div>
            <div className="icon-btn">
              <Bell size={18} />
              <span className="badge-dot"></span>
            </div>
            <div className="user-profile">
              <div className="avatar">OP</div>
              <div className="user-info">
                <span className="name">Operator</span>
                <span className="role">Level 2</span>
              </div>
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
          <Logs history={history} />
        )}
      </main>
    </div>
  );
};

export default App;
