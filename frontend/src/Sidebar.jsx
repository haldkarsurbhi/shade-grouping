import React from 'react';
import { BarChart2, Layers, Clock, Settings, Hexagon } from 'lucide-react';
import './styles.css';

const Sidebar = ({ page, setPage }) => {
    return (
        <aside className="app-sidebar">
            <div className="sidebar-logo">
                <div className="logo-icon">
                    <Hexagon size={28} color="#fff" fill="#2563eb" strokeWidth={1.5} />
                </div>
                <div className="logo-text">
                    <span className="brand-name">Fabric Shade</span>
                    <span className="brand-system">Matching & Grouping System</span>
                </div>
            </div>

            <nav className="nav-links">
                <div
                    className={`nav-item ${page === 'dashboard' ? 'active' : ''}`}
                    onClick={() => setPage('dashboard')}
                    style={{ cursor: 'pointer' }}
                >
                    <BarChart2 size={18} />
                    <span>Overview</span>
                </div>
                <div
                    className={`nav-item ${page === 'inspection' ? 'active' : ''}`}
                    onClick={() => setPage('inspection')}
                    style={{ cursor: 'pointer' }}
                >
                    <Layers size={18} />
                    <span>Inspection</span>
                </div>
                <div
                    className={`nav-item ${page === 'logs' ? 'active' : ''}`}
                    onClick={() => setPage('logs')}
                    style={{ cursor: 'pointer' }}
                >
                    <Clock size={18} />
                    <span>Logs</span>
                </div>
            </nav>

            <div className="sidebar-footer">
                <div className="nav-item">
                    <Settings size={18} />
                    <span>Config</span>
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
