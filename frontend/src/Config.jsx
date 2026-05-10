import React, { useEffect, useState } from 'react';
import API from './api/api';
import { SHADE_THRESHOLDS } from './utils/shadeRules';
import './styles.css';

const buyerToleranceRows = [
  { buyer: 'PRL', preferredBand: 'A-B', note: 'Premium lots; hold at D for review.' },
  { buyer: 'DRESSMEN', preferredBand: 'A-C', note: 'Commercial lot with visual check on D.' },
  { buyer: 'COS', preferredBand: 'A-C', note: 'Stable tolerance with supervisor check on D.' },
];

const workflowNotes = [
  'Capture first roll in a lot to set lot reference (deltaE = 0).',
  'All next rolls are compared against that lot reference using deltaE2000.',
  'Use "New lot" before switching to another batch or buyer order.',
];

const Config = () => {
  const [cameraInfo, setCameraInfo] = useState({
    status: 'Checking camera status...',
    tryOrder: '—',
    index: '—',
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await API.get('/camera-status', { timeout: 5000 });
        if (cancelled) return;
        setCameraInfo({
          status: data?.ok ? 'Camera detected' : 'Camera not detected',
          tryOrder: Array.isArray(data?.try_order) ? data.try_order.join(' -> ') : '—',
          index: data?.index ?? '—',
        });
      } catch {
        if (cancelled) return;
        setCameraInfo({
          status: 'Camera API unavailable',
          tryOrder: '—',
          index: '—',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="content-area">
      <section className="widget-card">
        <div className="widget-header">
          <h3>Shade Configuration Reference</h3>
        </div>
        <div className="widget-body config-grid">
          <div className="config-block">
            <h4>deltaE Threshold Table</h4>
            <table className="table-minimal">
              <thead>
                <tr>
                  <th>Shade</th>
                  <th>deltaE Range</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {SHADE_THRESHOLDS.map((row, idx) => (
                  <tr key={row.shade}>
                    <td><strong>{row.shade}</strong></td>
                    <td>
                      {idx === 0
                        ? `0.00 to < ${row.maxExclusive.toFixed(2)}`
                        : row.maxExclusive === Number.POSITIVE_INFINITY
                          ? `>= ${SHADE_THRESHOLDS[idx - 1].maxExclusive.toFixed(2)}`
                          : `${SHADE_THRESHOLDS[idx - 1].maxExclusive.toFixed(2)} to < ${row.maxExclusive.toFixed(2)}`}
                    </td>
                    <td>{row.shade === 'E' ? 'REJECT' : row.shade === 'D' ? 'HOLD' : 'ACCEPT'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="config-block">
            <h4>Buyer-Wise Tolerance Examples</h4>
            <table className="table-minimal">
              <thead>
                <tr>
                  <th>Buyer</th>
                  <th>Preferred Band</th>
                  <th>Operator Note</th>
                </tr>
              </thead>
              <tbody>
                {buyerToleranceRows.map((row) => (
                  <tr key={row.buyer}>
                    <td>{row.buyer}</td>
                    <td>{row.preferredBand}</td>
                    <td>{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="config-block">
            <h4>Camera Preference (Live)</h4>
            <div className="config-note-list">
              <p><strong>Status:</strong> {cameraInfo.status}</p>
              <p><strong>Active Index:</strong> {cameraInfo.index}</p>
              <p><strong>Try Order:</strong> {cameraInfo.tryOrder}</p>
              <p className="text-muted">Use Inspection page Reload Camera if preview is unavailable.</p>
            </div>
          </div>

          <div className="config-block">
            <h4>Inspection Workflow Notes</h4>
            <ul className="config-note-list">
              {workflowNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>

          <div className="config-block config-block-full">
            <h4>Shade Grouping Rules (Explanation)</h4>
            <p>
              deltaE is the color distance from lot reference. Lower values mean better match.
              Shade A-C are acceptable production matches. Shade D is held for QC review.
              Shade E is rejected and should not be dispatched.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Config;
