import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Search, Calendar, Filter, Image as ImageIcon } from 'lucide-react';
import './styles.css';

const Logs = ({ history }) => {
    // 1. Filter State
    const [filters, setFilters] = useState({
        search: '', // Buyer or Roll search
        supplier: '',
        date: ''
    });

    const [expandedDates, setExpandedDates] = useState({});
    const [selectedImage, setSelectedImage] = useState(null);

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
            groups[date].records.push(item);

            // Stats
            groups[date].stats.total++;
            groups[date].stats.sumDeltaE += Number(item.deltaE || 0);
            if (item.decision === 'ACCEPT') groups[date].stats.accept++;
            if (item.decision === 'HOLD') groups[date].stats.hold++;
            if (item.decision === 'REJECT') groups[date].stats.reject++;
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
                                                        <td>{row.buyer}</td>
                                                        <td>{row.supplier}</td>
                                                        <td>{row.quantity}</td>
                                                        <td><strong>{row.deltaE}</strong></td>
                                                        <td>
                                                            <span className={`shade-tag ${row.shade === 'REJECT' ? 's-reject' : row.shade === 'A' ? 's-a' : 's-other'}`}>
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

                                        {['A', 'B', 'C', 'D'].map(shade => {
                                            const shadeImages = group.records.filter(r => (r.shade || 'D') === shade && r.image);
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
