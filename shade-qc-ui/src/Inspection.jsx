import React, { useState } from 'react';
import { Camera, Save } from 'lucide-react';
import './styles.css';
import API from './api/api';

const Inspection = ({ activeRoll: initialRoll, onInspectionComplete, history = [] }) => {
    // Local state for the operator's current session
    const [sessionTests, setSessionTests] = useState([]);
    const [currentRoll, setCurrentRoll] = useState(initialRoll);
    const [previewImage, setPreviewImage] = useState(null);
    const [imageFile, setImageFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Form inputs
    const [rollInput, setRollInput] = useState(initialRoll.rollNo);
    const [qtyInput, setQtyInput] = useState(initialRoll.quantity);
    const [buyerInput, setBuyerInput] = useState(initialRoll.buyer);
    const [supplierInput, setSupplierInput] = useState('');

    // Base URL for image src (API returns path like /images/R101.jpg)
    const imageBaseUrl = API.defaults.baseURL || '';

    // --- Helper to get recent images per shade group ---
    const getRecentByShade = (shade) => {
        return history
            .filter(item => item.shade === shade && item.image)
            .slice(0, 3);
    };

    const handleCapture = async () => {
        if (!supplierInput.trim()) {
            alert("Please enter a Supplier name.");
            return;
        }
        if (!imageFile) {
            alert("Please select an image file to analyze.");
            return;
        }

        setError(null);
        setLoading(true);

        try {
            const formData = new FormData();
            formData.append('roll_no', rollInput);
            formData.append('quantity', Number(qtyInput) || 0);
            formData.append('image', imageFile);

            const { data } = await API.post('/analyze', formData);

            const imageUrl = data.image ? `${imageBaseUrl}${data.image}` : null;

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
                buyer: buyerInput,
                supplier: supplierInput,
                orderId: 'ORD-DEMO',
            };

            setSessionTests(prev => [newTest, ...prev]);
            onInspectionComplete(newTest);
        } catch (err) {
            const isNetworkError = err.message === 'Network Error' || err.code === 'ECONNREFUSED' || err.code === 'ERR_NETWORK';
            const message = isNetworkError
                ? 'Connection failed. Start the backend (from project root: uvicorn app:app --reload --port 8000).'
                : (err.response?.data?.error || err.message || 'Analysis failed');
            setError(message);
            alert(message);
        } finally {
            setLoading(false);
        }
    };

    const clearSession = () => setSessionTests([]);

    return (
        <div className="operator-screen">

            {/* 1. Control Bar */}
            <section className="control-bar-dense">
                <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div className="input-group-dense">
                        <label>Roll ID</label>
                        <input
                            type="text"
                            value={rollInput}
                            onChange={(e) => setRollInput(e.target.value)}
                        />
                    </div>
                    <div className="input-group-dense">
                        <label>Length (m)</label>
                        <input
                            type="number"
                            value={qtyInput}
                            onChange={(e) => setQtyInput(e.target.value)}
                            style={{ width: '80px' }}
                        />
                    </div>
                    <div className="input-group-dense">
                        <label>Buyer</label>
                        <input
                            type="text"
                            value={buyerInput}
                            onChange={(e) => setBuyerInput(e.target.value)}
                        />
                    </div>
                    <div className="input-group-dense">
                        <label>Supplier</label>
                        <input
                            type="text"
                            value={supplierInput}
                            onChange={(e) => setSupplierInput(e.target.value)}
                            placeholder="e.g. Arvind Mills"
                        />
                    </div>
                    <div className="input-group-dense">
                        <label>Image</label>
                        <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                        />
                    </div>
                </div>

                <div className="actions-dense">
                    <button
                        className="btn btn-primary btn-compact"
                        onClick={handleCapture}
                        disabled={loading}
                    >
                        <Camera size={16} /> {loading ? 'Analyzing…' : 'Capture Scan'}
                    </button>
                    <button className="btn btn-secondary btn-compact">
                        <Save size={16} /> Manual Save
                    </button>
                </div>
                {error && (
                    <div style={{ color: 'var(--color-danger)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
                        {error}
                    </div>
                )}
            </section>

            {/* 2. Main Workspace */}
            <section className="main-workspace">
                <div className="live-feed-container">
                    <div className="feed-header">
                        <span className="live-indicator">● LIVE</span>
                        <span className="feed-meta">CAM-01 • 4K HDR</span>
                    </div>
                    <div className="live-viewport">
                        {imageFile ? (
                            <img
                                src={URL.createObjectURL(imageFile)}
                                className="feed-image"
                                alt="Selected for analysis"
                            />
                        ) : currentRoll.imageUrl ? (
                            <img src={currentRoll.imageUrl} className="feed-image" alt="Live Feed" />
                        ) : (
                            <div className="no-signal">Select an image to analyze</div>
                        )}
                        <div className="reticle-box">
                            <div className="corner c-tl"></div>
                            <div className="corner c-tr"></div>
                            <div className="corner c-bl"></div>
                            <div className="corner c-br"></div>
                            <div className="center-cross"></div>
                        </div>
                    </div>

                    <div className="feed-footer">
                        <span><strong>Exposure:</strong> Auto</span>
                        <span><strong>Light Source:</strong> D65</span>
                    </div>
                </div>

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
                                {getRecentByShade('A').length === 0 && <span className="empty-text">No Reference Image</span>}
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
                                {getRecentByShade('B').length === 0 && <span className="empty-text">No Reference Image</span>}
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
                                {getRecentByShade('C').length === 0 && <span className="empty-text">No Reference Image</span>}
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
                                {getRecentByShade('D').length === 0 && <span className="empty-text">No Reference Image</span>}
                            </div>
                        </div>

                    </div>
                </div>
            </section>

            {/* 3. Session Table */}
            <section className="session-panel">
                <div className="panel-header-dense">
                    <h4>Live Inspection Session Log</h4>
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
                                            <span className={test.deltaE > 1.0 ? 'fw-bold' : ''}>
                                                {typeof test.deltaE === 'number' ? test.deltaE.toFixed(2) : test.deltaE}
                                            </span>
                                        </td>
                                        <td>
                                            <span className={`shade-badge shade-${(test.shade || test.shadeGroup || '').toLowerCase()}`}>
                                                {test.shade || test.shadeGroup}
                                            </span>
                                        </td>
                                        <td>
                                            <span className={`verdict-badge verdict-${(test.decision || '').toLowerCase()}`}>
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
