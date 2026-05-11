import React, { useState, useEffect, useCallback, useRef } from 'react';
import DronePanel from './components/DronePanel';
import MapComponent from './components/MapComponent';
import OrderPanel from './components/OrderPanel';
import './index.css';

const API = 'http://localhost:8000';
const POLL_MS = 600;

function App() {
  const [drones, setDrones] = useState([]);
  const [orders, setOrders] = useState([]);
  const [routes, setRoutes] = useState({});
  const [simStatus, setSimStatus] = useState('idle');  // idle | running | finished
  const [progress, setProgress] = useState(0);
  const [temperature, setTemperature] = useState(0);
  const [bestCost, setBestCost] = useState(0);
  const [currentCost, setCurrentCost] = useState(0);
  const [metrics, setMetrics] = useState(null);
  const [costHistory, setCostHistory] = useState([]);
  const [iteration, setIteration] = useState(0);
  const [totalIter, setTotalIter] = useState(0);

  const pollRef = useRef(null);

  // ── Data fetching ──────────────────────────────────────────────────
  const fetchDrones = useCallback(async () => {
    try {
      const r = await fetch(`${API}/drones`);
      setDrones(await r.json());
    } catch (_) { }
  }, []);

  const fetchOrders = useCallback(async () => {
    try {
      const r = await fetch(`${API}/orders`);
      setOrders(await r.json());
    } catch (_) { }
  }, []);

  const fetchAll = useCallback(() => {
    fetchDrones();
    fetchOrders();
  }, [fetchDrones, fetchOrders]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Status polling ─────────────────────────────────────────────────
  const pollStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/status`);
      const d = await r.json();
      setSimStatus(d.status);
      setProgress(d.progress);
      setTemperature(d.temperature);
      setBestCost(d.best_cost);
      setCurrentCost(d.current_cost);
      setIteration(d.iteration);
      setTotalIter(d.total_iterations);

      if (d.status === 'finished' && d.result) {
        setRoutes(d.result.routes || {});
        setMetrics(d.result);
        setCostHistory(d.result.cost_history || []);
        // Refresh drones/orders so batteries & assignments update
        fetchAll();
        // Stop polling
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch (_) { }
  }, [fetchAll]);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(pollStatus, POLL_MS);
  }, [pollStatus]);

  useEffect(() => () => clearInterval(pollRef.current), []);

  // ── Simulation ─────────────────────────────────────────────────────
  const startSimulation = async () => {
    if (simStatus === 'running') return;
    try {
      const r = await fetch(`${API}/simulate`, { method: 'POST' });
      if (!r.ok) {
        const e = await r.json();
        alert(e.detail || 'Failed to start simulation');
        return;
      }
      setRoutes({});
      setMetrics(null);
      setCostHistory([]);
      setSimStatus('running');
      setProgress(0);
      startPolling();
    } catch (err) {
      alert('Backend not reachable. Is the server running?');
    }
  };

  const resetSim = async () => {
    clearInterval(pollRef.current);
    pollRef.current = null;
    await fetch(`${API}/reset`, { method: 'POST' });
    setRoutes({});
    setMetrics(null);
    setCostHistory([]);
    setSimStatus('idle');
    setProgress(0);
    fetchAll();
  };

  // ── Cost graph normalisation ───────────────────────────────────────
  const maxCost = Math.max(...costHistory, 1);
  const minCost = Math.min(...costHistory, 0);
  const costRange = maxCost - minCost || 1;

  return (
    <div id="app-root" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="app-header">
        {/* Logo */}
        <div className="logo">
          <span className="logo-icon">🚁</span>
          ROUTECORE
          <span style={{
            fontSize: '10px', fontWeight: 500, letterSpacing: '1px',
            color: 'var(--text-muted)', marginLeft: '4px',
            background: 'none', WebkitTextFillColor: 'var(--text-muted)',
          }}></span>
        </div>

        {/* Centre – status + progress */}
        <div className="header-center">
          <span className={`status-badge ${simStatus}`}>
            <span className="status-dot" />
            {simStatus === 'idle' && 'Ready to Start'}
            {simStatus === 'running' && `Optimizing… ${progress.toFixed(0)}%`}
            {simStatus === 'finished' && 'Simulation Complete'}
          </span>

          {simStatus === 'running' && (
            <div style={{ width: '140px' }}>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="progress-labels">
                <span>T={temperature.toFixed(2)}</span>
                <span>iter {iteration.toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* Cost graph after/during simulation */}
          {costHistory.length > 2 && (
            <div style={{ width: '100px', height: '32px', display: 'flex', alignItems: 'flex-end', gap: '1px', opacity: 0.85 }}>
              {costHistory.slice(-40).map((v, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1, minWidth: '2px',
                    height: `${Math.max(4, ((v - minCost) / costRange) * 30)}px`,
                    background: `linear-gradient(180deg, var(--cyan), var(--purple))`,
                    borderRadius: '1px 1px 0 0', opacity: 0.7,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right – metrics + buttons */}
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          {metrics && (
            <div style={{ display: 'flex', gap: '20px' }}>
              <div className="metric-chip">
                <strong>{metrics.total_distance?.toFixed(1)} km</strong>
                Total Dist
              </div>
              <div className="metric-chip">
                <strong>{metrics.total_energy?.toFixed(1)}</strong>
                Energy
              </div>
              <div className="metric-chip">
                <strong>{metrics.total_cost?.toFixed(1)}</strong>
                SA Cost
              </div>
            </div>
          )}

          {simStatus === 'finished' && (
            <button className="btn btn-ghost" onClick={resetSim} style={{ fontSize: '12px' }}>
              🔄 Reset
            </button>
          )}

          <button
            className="simulate-btn"
            onClick={startSimulation}
            disabled={simStatus === 'running'}
            id="simulate-btn"
          >
            {simStatus === 'running'
              ? <><span className="spin">⚙</span> Running…</>
              : <><span>▶</span> Start Simulation</>
            }
          </button>
        </div>
      </header>

      {/* ── 2-Panel Main Layout ────────────────────────────────────── */}
      <main className="main-layout">
        <DronePanel
          drones={drones}
          onRefresh={fetchDrones}
          simStatus={simStatus}
        />

        <MapComponent
          orders={orders}
          drones={drones}
          routes={routes}
          simStatus={simStatus}
        />

        <OrderPanel
          orders={orders}
          drones={drones}
          onRefresh={fetchOrders}
          simStatus={simStatus}
        />
      </main>
    </div>
  );
}

export default App;
