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
  const [simStatus, setSimStatus] = useState('idle');  // idle | running | finished
  const [progress, setProgress] = useState(0);
  const [temperature, setTemperature] = useState(0);
  const [bestCost, setBestCost] = useState(0);
  const [currentCost, setCurrentCost] = useState(0);
  const [metrics, setMetrics] = useState(null);
  const [costHistory, setCostHistory] = useState([]);
  const [iteration, setIteration] = useState(0);
  const [totalIter, setTotalIter] = useState(0);

  // Multi-stage state
  const [stages, setStages] = useState([]);       // array of stage objects from backend
  const [selectedStage, setSelectedStage] = useState('all'); // 'all' | 1 | 2 | ...

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
        const stagesData = d.result.stages || [];
        setStages(stagesData);
        setSelectedStage('all');
        setMetrics(d.result);
        setCostHistory(d.result.cost_history || []);
        fetchAll();
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
      setStages([]);
      setSelectedStage('all');
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
    setStages([]);
    setSelectedStage('all');
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
        </div>

        {/* Centre – status + progress */}
        <div className="header-center">
          <span className={`status-badge ${simStatus}`}>
            <span className="status-dot" />
            {simStatus === 'idle' && 'Ready to Start'}
            {simStatus === 'running' && `Trip ${iteration} — ${progress.toFixed(0)}%`}
            {simStatus === 'finished' && `Done · ${metrics?.total_stages ?? 0} Trips · ${metrics?.served_orders ?? 0}/${metrics?.total_orders ?? 0} Orders`}
          </span>

          {simStatus === 'running' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ width: '140px' }}>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="progress-labels">
                  <span>Trip {iteration}</span>
                  <span>{progress.toFixed(0)}%</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                <span>COST: {currentCost.toFixed(1)}</span>
                <span>BEST: {bestCost.toFixed(1)}</span>
              </div>
            </div>
          )}


        </div>

        {/* Right – metrics + stage filter + buttons */}
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          {/* Baseline Distance Calculation */}
          {orders.length > 0 && !metrics && simStatus === 'idle' && (
            <div className="metric-chip">
              <strong>
                {orders.reduce((sum, o) => sum + (o.distance_to_depot * 2), 0).toFixed(1)} km
              </strong>
              <span>Est. Unoptimized</span>
            </div>
          )}

          {metrics && (() => {
            const currentMetrics = selectedStage === 'all' 
              ? metrics 
              : stages.find(s => s.stage === selectedStage);
            
            if (!currentMetrics) return null;

            const servedOrders = orders.filter(o => o.status === 'assigned');
            const baseline = servedOrders.reduce((sum, o) => sum + (o.distance_to_depot * 2), 0);
            const saved = baseline - metrics.total_distance;
            const percentSaved = baseline > 0 ? (saved / baseline) * 100 : 0;

            return (
              <div style={{ display: 'flex', gap: '20px' }}>
                {selectedStage === 'all' && (
                  <div className="metric-chip" title="Total distance if drones flew to each order individually and back">
                    <strong style={{ color: 'var(--text-muted)' }}>{baseline.toFixed(1)} km</strong>
                    <span>Baseline Dist</span>
                  </div>
                )}
                <div className="metric-chip">
                  <strong style={{ color: selectedStage === 'all' ? 'var(--cyan)' : 'var(--text)' }}>
                    {currentMetrics.total_distance?.toFixed(1)} km
                  </strong>
                  <span>{selectedStage === 'all' ? 'Optimized Dist' : 'Trip Dist'}</span>
                </div>
                {selectedStage === 'all' && saved > 0 && (
                  <div className="metric-chip">
                    <strong style={{ color: 'var(--green)' }}>{percentSaved.toFixed(1)}%</strong>
                    <span>Efficiency</span>
                  </div>
                )}
                <div className="metric-chip">
                  <strong>{currentMetrics.total_energy?.toFixed(1)}</strong>
                  <span>{selectedStage === 'all' ? 'Total Energy' : 'Trip Energy'}</span>
                </div>
                <div className="metric-chip" title="SA Cost = Distance + (Energy * 0.1) + Penalties">
                  <strong style={{ color: 'var(--purple)' }}>
                    {currentMetrics.total_cost?.toFixed(2)}
                  </strong>
                  <span>SA Cost</span>
                </div>
                <div className="metric-chip">
                  <strong>
                    {selectedStage === 'all' 
                      ? `${metrics.served_orders}/${metrics.total_orders}` 
                      : Object.values(currentMetrics.assignments || {}).reduce((sum, oids) => sum + oids.length, 0)
                    }
                  </strong>
                  <span>{selectedStage === 'all' ? 'Total Served' : 'Orders Served'}</span>
                </div>
              </div>
            );
          })()}

          {/* Stage filter buttons — only visible after simulation finishes */}
          {simStatus === 'finished' && stages.length > 0 && (
            <div className="stage-filter">
              <button
                className={`stage-btn ${selectedStage === 'all' ? 'active' : ''}`}
                onClick={() => setSelectedStage('all')}
              >
                All
              </button>
              {stages.map(s => (
                <button
                  key={s.stage}
                  className={`stage-btn ${selectedStage === s.stage ? 'active' : ''}`}
                  onClick={() => setSelectedStage(s.stage)}
                >
                  Trip {s.stage}
                </button>
              ))}
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

      {/* ── 3-Panel Main Layout ────────────────────────────────────── */}
      <main className="main-layout">
        <DronePanel
          drones={(() => {
            if (selectedStage === 'all') return drones;
            const stageData = stages.find(s => s.stage === selectedStage);
            if (!stageData) return drones;
            
            return drones.map(d => {
              const stageMetrics = stageData.drone_metrics[d.id];
              return {
                ...d,
                current_battery: stageMetrics ? stageMetrics.remaining_battery : 100,
                status: stageMetrics ? 'delivering' : 'idle'
              };
            });
          })()}
          onRefresh={fetchDrones}
          simStatus={simStatus}
        />

        <MapComponent
          orders={(() => {
            if (selectedStage === 'all') return orders;
            const stageData = stages.find(s => s.stage === selectedStage);
            if (!stageData) return orders;
            const stageOrderIds = Object.values(stageData.assignments).flat();
            return orders.filter(o => stageOrderIds.includes(o.id));
          })()}
          drones={drones}
          stages={stages}
          selectedStage={selectedStage}
          simStatus={simStatus}
        />

        <OrderPanel
          orders={(() => {
            if (selectedStage === 'all') return orders;
            const stageData = stages.find(s => s.stage === selectedStage);
            if (!stageData) return orders;
            const stageOrderIds = Object.values(stageData.assignments).flat();
            return orders.filter(o => stageOrderIds.includes(o.id));
          })()}
          drones={drones}
          onRefresh={fetchOrders}
          simStatus={simStatus}
        />
      </main>
    </div>
  );
}

export default App;
