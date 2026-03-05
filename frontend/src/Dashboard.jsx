import React, { useMemo, useState } from 'react';
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import './styles.css';

const Dashboard = ({ history }) => {
    const [selectedImage, setSelectedImage] = useState(null);

    // Compute Metrics from Prop
    const stats = useMemo(() => {
        const total = history.length;
        const accepted = history.filter(i => i.decision === 'ACCEPT').length;
        const hold = history.filter(i => i.decision === 'HOLD').length;
        const rejected = history.filter(i => i.decision === 'REJECT').length;

        // Safety check for calculation
        const sumDeltaE = history.reduce((acc, curr) => acc + Number(curr.deltaE || 0), 0);
        const avgDeltaE = total > 0 ? (sumDeltaE / total).toFixed(2) : '0.00';

        return { total, accepted, hold, rejected, avgDeltaE };
    }, [history]);

    // Compute Chart: Distribution
    const distributionData = useMemo(() => {
        const counts = { A: 0, B: 0, C: 0, D: 0, E: 0, REJECT: 0 };
        history.forEach(i => {
            // Normalize shade key
            const shadeKey = i.shade || 'REJECT';
            if (counts[shadeKey] !== undefined) counts[shadeKey]++;
            else counts.REJECT++;
        });

        return [
            { name: 'A', count: counts.A, fill: '#16a34a' }, // Green-600
            { name: 'B', count: counts.B, fill: '#ea580c' }, // Orange-600
            { name: 'C', count: counts.C, fill: '#ca8a04' }, // Yellow-600
            { name: 'D', count: counts.D, fill: '#dc2626' }, // Red-600
            { name: 'REJECT', count: counts.REJECT, fill: '#1e293b' }, // Slate-800
        ];
    }, [history]);

    // Compute Chart: Trend (Reverse chronological to chronological)
    const trendData = useMemo(() => {
        // Clone and reverse to show oldest to newest left-to-right
        // Assuming history is [Newest, ..., Oldest]
        const chronological = [...history].reverse();
        return chronological.map((item, index) => ({
            idx: index + 1, // Simple index for X-axis
            deltaE: item.deltaE,
            shade: item.shade
        }));
    }, [history]);

    // Compute Supplier Stats
    const { supplierChartData, supplierTableData } = useMemo(() => {
        const suppliers = {};

        history.forEach(item => {
            const supplier = (item.supplier && item.supplier.trim()) ? item.supplier : 'Not Entered';

            if (!suppliers[supplier]) {
                suppliers[supplier] = {
                    name: supplier,
                    total: 0,
                    accepted: 0,
                    hold: 0,
                    rejected: 0,
                    sumDeltaE: 0,
                    shades: { A: 0, B: 0, C: 0, D: 0, REJECT: 0 }
                };
            }

            suppliers[supplier].total++;
            suppliers[supplier].sumDeltaE += Number(item.deltaE || 0);

            // Decision Counts
            if (item.decision === 'ACCEPT') suppliers[supplier].accepted++;
            else if (item.decision === 'HOLD') suppliers[supplier].hold++;
            else if (item.decision === 'REJECT' || item.decision === 'Reject') suppliers[supplier].rejected++;

            // Shade Counts
            const shade = item.shade || 'REJECT';
            if (suppliers[supplier].shades[shade] !== undefined) {
                suppliers[supplier].shades[shade]++;
            } else {
                suppliers[supplier].shades['REJECT']++;
            }
        });

        // Format for Chart (Stacked Bar)
        const chartData = Object.values(suppliers).map(s => ({
            name: s.name,
            A: s.shades.A,
            B: s.shades.B,
            C: s.shades.C,
            D: s.shades.D,
            REJECT: s.shades.REJECT
        }));

        // Format for Table
        const tableData = Object.values(suppliers).map(s => {
            const avgDeltaE = s.total > 0 ? (s.sumDeltaE / s.total).toFixed(2) : '0.00';
            const acceptanceRate = s.total > 0 ? ((s.accepted / s.total) * 100).toFixed(1) + '%' : '0.0%';

            return {
                name: s.name,
                total: s.total,
                accepted: s.accepted,
                hold: s.hold,
                rejected: s.rejected,
                avgDeltaE,
                acceptanceRate
            };
        });

        return { supplierChartData: chartData, supplierTableData: tableData };
    }, [history]);

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

            {/* SECTION 1: Metrics Cards */}
            <section className="stats-grid">
                <div className="widget-card stat-widget">
                    <span className="stat-title">Total Processed</span>
                    <span className="stat-number">{stats.total}</span>
                </div>
                <div className="widget-card stat-widget">
                    <span className="stat-title">Accepted</span>
                    <span className="stat-number text-success">{stats.accepted}</span>
                </div>
                <div className="widget-card stat-widget">
                    <span className="stat-title">Hold (QC Check)</span>
                    <span className="stat-number text-warning">{stats.hold}</span>
                </div>
                <div className="widget-card stat-widget">
                    <span className="stat-title">Rejected</span>
                    <span className="stat-number text-danger">{stats.rejected}</span>
                </div>
                <div className="widget-card stat-widget">
                    <span className="stat-title">Avg ΔE</span>
                    <span className="stat-number">{stats.avgDeltaE}</span>
                </div>
            </section>

            {/* SECTION 2: Analytics */}
            <section className="dashboard-split">
                {/* Distribution */}
                <div className="widget-card">
                    <div className="widget-header">
                        <h3>Shade Group Distribution</h3>
                    </div>
                    <div className="widget-body" style={{ height: 280 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={distributionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                                <Tooltip
                                    contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                                    cursor={{ fill: '#f1f5f9' }}
                                />
                                <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={32}>
                                    {distributionData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.fill} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Trend */}
                <div className="widget-card">
                    <div className="widget-header">
                        <h3>Process Consistency (ΔE)</h3>
                    </div>
                    <div className="widget-body" style={{ height: 280 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="idx" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                                <YAxis stroke="#64748b" fontSize={11} domain={[0, 'auto']} tickLine={false} axisLine={false} />
                                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0' }} />
                                <Line type="monotone" dataKey="deltaE" stroke="#2563eb" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </section>

            {/* SECTION 2.5: Supplier Performance */}
            <section className="dashboard-split" style={{ marginBottom: '1.5rem' }}>
                {/* Supplier Chart */}
                <div className="widget-card">
                    <div className="widget-header">
                        <h3>Supplier-wise Shade Grouping</h3>
                    </div>
                    <div className="widget-body" style={{ height: 320 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={supplierChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                                <Tooltip
                                    cursor={{ fill: '#f1f5f9' }}
                                    contentStyle={{ background: '#fff', border: '1px solid #e2e8f0' }}
                                />
                                <Bar dataKey="A" stackId="a" fill="#16a34a" name="Shade A" />
                                <Bar dataKey="B" stackId="a" fill="#ea580c" name="Shade B" />
                                <Bar dataKey="C" stackId="a" fill="#ca8a04" name="Shade C" />
                                <Bar dataKey="D" stackId="a" fill="#dc2626" name="Shade D" />
                                <Bar dataKey="REJECT" stackId="a" fill="#1e293b" name="Reject" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Supplier Summary Table */}
                <div className="widget-card">
                    <div className="widget-header">
                        <h3>Supplier Performance Summary</h3>
                    </div>
                    <div className="table-responsive" style={{ maxHeight: 320, overflowY: 'auto' }}>
                        <table className="table-minimal">
                            <thead>
                                <tr>
                                    <th>Supplier vs Mill</th>
                                    <th>Total Rolls</th>
                                    <th>Acc / Hold / Rej</th>
                                    <th>Acc %</th>
                                    <th>Avg ΔE</th>
                                </tr>
                            </thead>
                            <tbody>
                                {supplierTableData.map((s, i) => (
                                    <tr key={i}>
                                        <td style={{ fontWeight: 600 }}>{s.name}</td>
                                        <td>{s.total}</td>
                                        <td>
                                            <span className="text-success">{s.accepted}</span> /{' '}
                                            <span className="text-warning">{s.hold}</span> /{' '}
                                            <span className="text-danger">{s.rejected}</span>
                                        </td>
                                        <td>
                                            <span className={parseFloat(s.acceptanceRate) > 80 ? "text-success" : parseFloat(s.acceptanceRate) < 50 ? "text-danger" : ""}>
                                                {s.acceptanceRate}
                                            </span>
                                        </td>
                                        <td><strong>{s.avgDeltaE}</strong></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            {/* SECTION 3: Detailed Log */}
            <section className="widget-card">
                <div className="widget-header">
                    <h3>Inspection Log</h3>
                </div>
                <div className="table-responsive">
                    <table className="table-minimal">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Scan</th>
                                <th>Roll ID</th>
                                <th>Buyer Name</th>
                                <th>Supplier vs Mill</th>
                                <th>Order Ref</th>
                                <th>Qty (m)</th>
                                <th>ΔE Value</th>
                                <th>Shade Grp</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map((row, idx) => (
                                <tr key={idx} onClick={() => setSelectedImage(row.image)}>
                                    <td className="text-muted" style={{ fontSize: '0.8rem' }}>{row.date}</td>
                                    <td>
                                        {row.image && <img src={row.image} alt="scan" className="thumb-xs" />}
                                    </td>
                                    <td className="font-mono">{row.rollNo}</td>
                                    <td>{row.buyer || '-'}</td>
                                    <td>{row.supplier || '-'}</td>
                                    <td>{row.orderId || '-'}</td>
                                    <td>{row.quantity}</td>
                                    <td><strong>{row.deltaE}</strong></td>
                                    <td><span className={`shade-tag ${row.shade === 'REJECT' ? 's-reject' : row.shade === 'A' ? 's-a' : 's-other'}`}>{row.shade}</span></td>
                                    <td><span className={getStatusClass(row.decision)}>{row.decision}</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* Image Modal */}
            {selectedImage && (
                <div className="modal-backdrop" onClick={() => setSelectedImage(null)}>
                    <div className="modal-content">
                        <img src={selectedImage} alt="Full View" />
                        <p>Roll Scan Preview</p>
                    </div>
                </div>
            )}

        </div>
    );
};

export default Dashboard;
