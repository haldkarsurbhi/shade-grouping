import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Search, Calendar, Filter, Image as ImageIcon } from 'lucide-react';
import './styles.css';
import { normalizeInspectionRecord } from './utils/shadeRules';

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

const Logs = ({ history, onDeleteLot, onRestoreLots, deletedLotCount = 0 }) => {
    // 1. Filter State
    const [filters, setFilters] = useState({
        search: '', // Buyer or Roll search
        supplier: '',
        date: ''
    });

    const [expandedDates, setExpandedDates] = useState({});
    const [selectedImage, setSelectedImage] = useState(null);
    const [selectedLotForDelete, setSelectedLotForDelete] = useState('');

    const lotOptions = useMemo(() => {
        const counts = new Map();
        history.forEach((row) => {
            const lotId = deriveLotId(row);
            counts.set(lotId, (counts.get(lotId) || 0) + 1);
        });
        return Array.from(counts.entries())
            .map(([lotId, count]) => ({ lotId, count }))
            .sort((a, b) => a.lotId.localeCompare(b.lotId));
    }, [history]);

    const handleDeleteSelectedLot = () => {
        if (!selectedLotForDelete) return;
        const confirmed = window.confirm(`Delete lot "${selectedLotForDelete}" from logs and dashboard?`);
        if (!confirmed) return;
        onDeleteLot?.(selectedLotForDelete);
        setSelectedLotForDelete('');
    };

    // 2. Filter & Group Data
    const groupedData = useMemo(() => {
        let filtered = history;

        // Apply Filters
        if (filters.search) {
            const q = filters.search.toLowerCase();
            filtered = filtered.filter(i =>
                (i.buyer && i.buyer.toLowerCase().includes(q)) ||
                (i.rollNo && i.rollNo.toLowerCase().includes(q))
            );
        }
        if (filters.supplier) {
            filtered = filtered.filter(i => i.supplier && i.supplier.toLowerCase().includes(filters.supplier.toLowerCase()));
        }
        if (filters.date) {
            filtered = filtered.filter(i => i.date === filters.date);
        }

        // Group by Date
        const groups = {};
        filtered.forEach(item => {
            const date = item.date;
            if (!groups[date]) {
                groups[date] = {
                    date,
                    records: [],
                    stats: { total: 0, accept: 0, hold: 0, reject: 0, sumDeltaE: 0 }
                };
            }
            const normalized = normalizeInspectionRecord(item);
            groups[date].records.push(normalized);

            // Stats
            groups[date].stats.total++;
            groups[date].stats.sumDeltaE += Number(normalized.deltaE || 0);
            if (normalized.decision === 'ACCEPT') groups[date].stats.accept++;
            if (normalized.decision === 'HOLD') groups[date].stats.hold++;
            if (normalized.decision === 'REJECT') groups[date].stats.reject++;
        });

        // Sort Dates Descending (Newest First)
        return Object.values(groups).sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [history, filters]);

    // Toggle Accordion
    const toggleDate = (date) => {
        setExpandedDates(prev => ({
            ...prev,
            [date]: !prev[date]
        }));
    };

    // Auto-expand first date on load
    useMemo(() => {
        if (groupedData.length > 0) {
            const firstDate = groupedData[0].date;
            setExpandedDates(prev => {
                if (Object.keys(prev).length === 0) return { [firstDate]: true };
                return prev;
            });
        }
    }, [groupedData]);

    const getStatusClass = (status) => {
        switch (status) {
            case 'ACCEPT': return 'pill success';
            case 'HOLD': return 'pill warning';
            case 'REJECT': return 'pill danger';
            default: return 'pill neutral';
        }
    };

    return (
        <div className="content-area">
            <p className="text-muted" style={{ marginBottom: '0.25rem' }}>
                <span title="Delta E is the color difference from lot reference.">ΔE: lower means closer shade</span>
                {' · '}
                <span title="D means hold for review, E means reject.">Decision policy: A-C Accept, D Hold, E Reject</span>
            </p>
            {/* Header / Filters */}
            <div className="widget-card" style={{ marginBottom: '1.5rem' }}>
                <div className="widget-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Filter size={20} className="text-gray-500" />
                        <h3>Log Filters</h3>
                    </div>
                </div>
                <div className="widget-body filter-bar" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <div className="search-box" style={{ flex: 1, minWidth: '200px' }}>
                        <Search size={14} className="search-icon" />
                        <input
                            type="text"
                            placeholder="Search Buyer or Roll ID..."
                            value={filters.search}
                            onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                        />
                    </div>
                    <div className="search-box" style={{ flex: 1, minWidth: '200px' }}>
                        <Search size={14} className="search-icon" />
                        <input
                            type="text"
                            placeholder="Filter by Supplier..."
                            value={filters.supplier}
                            onChange={(e) => setFilters(prev => ({ ...prev, supplier: e.target.value }))}
                        />
                    </div>
                    <div className="search-box" style={{ flex: 0, minWidth: '150px' }}>
                        <Calendar size={14} className="search-icon" />
                        <input
                            type="date"
                            value={filters.date}
                            onChange={(e) => setFilters(prev => ({ ...prev, date: e.target.value }))}
                        />
                    </div>
                    <button className="btn-primary" onClick={() => setFilters({ search: '', supplier: '', date: '' })}>
                        Reset
                    </button>
                </div>
                <div className="widget-body filter-bar" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', paddingTop: 0 }}>
                    <select
                        value={selectedLotForDelete}
                        onChange={(e) => setSelectedLotForDelete(e.target.value)}
                        style={{ minWidth: '280px' }}
                    >
                        <option value="">Select lot to delete...</option>
                        {lotOptions.map((lot) => (
                            <option key={lot.lotId} value={lot.lotId}>
                                {lot.lotId} ({lot.count} rolls)
                            </option>
                        ))}
                    </select>
                    <button className="btn-danger" disabled={!selectedLotForDelete} onClick={handleDeleteSelectedLot}>
                        Delete Lot
                    </button>
                    {deletedLotCount > 0 && (
                        <button className="btn-secondary" onClick={onRestoreLots}>
                            Restore Deleted Lots ({deletedLotCount})
                        </button>
                    )}
                </div>
            </div>

            {/* Date Groups */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {groupedData.length === 0 ? (
                    <div className="empty-state">No records found matching filters</div>
                ) : (
                    groupedData.map(group => (
                        <div key={group.date} className="widget-card">
                            {/* Accordion Header */}
                            <div
                                className="widget-header accordion-header"
                                onClick={() => toggleDate(group.date)}
                                style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    {expandedDates[group.date] ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                    <h3 style={{ margin: 0 }}>Inspection Log – {group.date}</h3>
                                </div>
                                <div className="summary-pills" style={{ display: 'flex', gap: '0.5rem' }}>
                                    <span className="pill neutral">Total: {group.stats.total}</span>
                                    <span className="pill success">Acc: {group.stats.accept}</span>
                                    <span className="pill warning">Hold: {group.stats.hold}</span>
                                    <span className="pill danger">Rej: {group.stats.reject}</span>
                                    <span className="pill neutral">Avg ΔE: {(group.stats.sumDeltaE / group.stats.total).toFixed(2)}</span>
                                </div>
                            </div>

                            {/* Accordion Content */}
                            {expandedDates[group.date] && (
                                <div className="widget-body">
                                    {/* Table */}
                                    <div className="table-responsive" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                                        <table className="table-minimal">
                                            <thead>
                                                <tr>
                                                    <th>Roll ID</th>
                                                    <th>Lot ID</th>
                                                    <th>Buyer Name</th>
                                                    <th>Supplier</th>
                                                    <th>Qty (m)</th>
                                                    <th>ΔE Value</th>
                                                    <th>Shade Grp</th>
                                                    <th>Verdict</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {group.records.map((row, idx) => (
                                                    <tr key={idx}>
                                                        <td className="font-mono"><strong>{row.rollNo}</strong></td>
                                                        <td className="font-mono">{deriveLotId(row)}</td>
                                                        <td>{row.buyer}</td>
                                                        <td>{row.supplier}</td>
                                                        <td>{row.quantity}</td>
                                                        <td><strong>{row.deltaE}</strong></td>
                                                        <td>
                                                            <span className={`shade-tag ${row.shade === 'E' ? 's-reject' : row.shade === 'A' ? 's-a' : 's-other'}`}>
                                                                {row.shade}
                                                            </span>
                                                        </td>
                                                        <td><span className={getStatusClass(row.decision)}>{row.decision}</span></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Image Traceability Section */}
                                    <div style={{ marginTop: '1.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                                            <ImageIcon size={18} className="text-gray-500" />
                                            <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#475569' }}>Sample Traceability (Grouped by Shade)</h4>
                                        </div>

                                        {['A', 'B', 'C', 'D', 'E'].map(shade => {
                                            const shadeImages = group.records.filter(r => (r.shade || 'E') === shade && r.image);
                                            if (shadeImages.length === 0) return null;

                                            return (
                                                <div key={shade} style={{ marginBottom: '1rem' }}>
                                                    <h5 style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>Shade Group {shade}</h5>
                                                    <div className="image-grid" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                        {shadeImages.map((imgItem, i) => (
                                                            <div key={i} className="trace-thumb" onClick={() => setSelectedImage(imgItem.image)}>
                                                                <img
                                                                    src={imgItem.image}
                                                                    alt={`Roll ${imgItem.rollNo}`}
                                                                    style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #cbd5e1', cursor: 'pointer' }}
                                                                />
                                                                <span style={{ display: 'block', fontSize: '10px', marginTop: '2px', textAlign: 'center', color: '#475569' }}>{imgItem.rollNo}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {/* Handle Rejects separately or group with D if preferred, sticking to strict groups for now */}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* Lightbox Modal */}
            {selectedImage && (
                <div className="modal-backdrop" onClick={() => setSelectedImage(null)}>
                    <div className="modal-content">
                        <img src={selectedImage} alt="Traceability View" />
                        <p>Fabric Sample Preview</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Logs;
