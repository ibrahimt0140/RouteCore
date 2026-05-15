import React, { useState } from 'react';

const API = 'http://localhost:8000';

export const DRONE_COLORS = [
  '#00e5ff', '#7c3aed', '#00e676', '#ffc107',
  '#ff4d6d', '#818cf8', '#34d399', '#f97316',
];

const DronePanel = ({ drones, onRefresh, simStatus }) => {
  const [showForm, setShowForm] = useState(false);
  const [genCount, setGenCount] = useState(3);
  const [form, setForm] = useState({
    name: '', payload_capacity: '10', max_range: '20', speed: '40', altitude: '110',
  });
  const [loading, setLoading] = useState(false);

  const addDrone = async () => {
    if (!form.name.trim()) return;
    setLoading(true);
    try {
      await fetch(`${API}/drones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          payload_capacity: parseFloat(form.payload_capacity),
          max_range: parseFloat(form.max_range),
          speed: parseFloat(form.speed),
          altitude: parseFloat(form.altitude),
          battery_capacity: 100,
        }),
      });
      setForm({ name: '', payload_capacity: '10', max_range: '20', speed: '40', altitude: '110' });
      setShowForm(false);
      onRefresh();
    } finally { setLoading(false); }
  };

  const removeDrone = async (id) => {
    await fetch(`${API}/drones/${id}`, { method: 'DELETE' });
    onRefresh();
  };

  const generateDrones = async () => {
    setLoading(true);
    try {
      await fetch(`${API}/generate-drones?count=${genCount}`, { method: 'POST' });
      onRefresh();
    } finally { setLoading(false); }
  };

  const isRunning = simStatus === 'running';

  return (
    <div className="glass side-panel">
      {/* Header */}
      <div className="panel-header">
        <div className="panel-title">
          <span>🚁</span> Drones
          <span style={{
            marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)',
            fontWeight: 400, textTransform: 'none', letterSpacing: 0,
          }}>
            {drones.length} active
          </span>
        </div>
        <div className="panel-subtitle">Fleet configuration</div>

        {/* Generate row */}
        <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className="num-spinner">
            <button onClick={() => setGenCount(c => Math.max(1, c - 1))}>−</button>
            <input 
              type="number" 
              value={genCount} 
              onChange={e => setGenCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
              className="spinner-input"
            />
            <button onClick={() => setGenCount(c => Math.min(20, c + 1))}>+</button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={generateDrones} disabled={isRunning || loading}>
            ⚡ Generate
          </button>
          <button className="btn btn-green btn-sm" onClick={() => setShowForm(s => !s)} disabled={isRunning}>
            {showForm ? '✕ Cancel' : '+ Add'}
          </button>
        </div>
      </div>

      <div className="panel-body">
        {/* Add form */}
        {showForm && (
          <div className="add-form">
            <div className="add-form-title">New Drone</div>
            <div className="form-grid">
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Name</label>
                <input
                  className="field field-sm"
                  value={form.name}
                  placeholder="e.g. SkySwift A1"
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Payload (kg)</label>
                <input
                  className="field field-sm" type="number" min="1" max="50"
                  value={form.payload_capacity}
                  onChange={e => setForm(f => ({ ...f, payload_capacity: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Range (km)</label>
                <input
                  className="field field-sm" type="number" min="5" max="100"
                  value={form.max_range}
                  onChange={e => setForm(f => ({ ...f, max_range: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Speed (km/h)</label>
                <input
                  className="field field-sm" type="number" min="10" max="120"
                  value={form.speed}
                  onChange={e => setForm(f => ({ ...f, speed: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Altitude (m)</label>
                <input
                  className="field field-sm" type="number" min="50" max="500"
                  value={form.altitude}
                  onChange={e => setForm(f => ({ ...f, altitude: e.target.value }))}
                />
              </div>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={addDrone}
              disabled={loading || !form.name.trim()}
            >
              {loading ? '⏳ Adding…' : '✓ Add Drone'}
            </button>
          </div>
        )}

        {/* Empty state */}
        {drones.length === 0 && (
          <div className="empty">
            <div className="empty-icon">🚁</div>
            No drones configured.<br />Generate or add drones above.
          </div>
        )}

        {/* Drone cards */}
        {drones.map((drone, i) => {
          const color = DRONE_COLORS[i % DRONE_COLORS.length];
          const bat = drone.current_battery;
          const batColor = bat > 50 ? 'var(--green)' : bat > 25 ? 'var(--amber)' : 'var(--red)';

          return (
            <div className="card" key={drone.id} style={{ paddingLeft: '18px' }}>
              <div className="drone-strip" style={{ background: color }} />
              <div className="card-header">
                <span className="card-title" style={{ color }}>{drone.name}</span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span className={`tag tag-${drone.status}`}>{drone.status.toUpperCase()}</span>
                  {!isRunning && (
                    <button
                      className="card-del-btn"
                      onClick={() => removeDrone(drone.id)}
                      title="Remove drone"
                    >✕</button>
                  )}
                </div>
              </div>

              <div className="card-body">
                <div className="stat">Payload <span>{drone.payload_capacity} kg</span></div>
                <div className="stat">Range <span>{drone.max_range} km</span></div>
                <div className="stat">Speed <span>{drone.speed} km/h</span></div>
                <div className="stat">Altitude <span>{drone.altitude} m</span></div>
                <div className="stat">Packages Delivered <span><strong>{drone.deliveries_count}</strong></span></div>
                <div className="stat">
                  Battery <span style={{ color: batColor }}>{bat.toFixed(1)}%</span>
                </div>
              </div>

              {/* Battery bar */}
              <div className="bat-bar">
                <div className="bat-label">
                  <span>Battery</span>
                  <span style={{ color: batColor }}>{bat.toFixed(1)}%</span>
                </div>
                <div className="bat-track">
                  <div
                    className="bat-fill"
                    style={{
                      width: `${bat}%`,
                      background: `linear-gradient(90deg, var(--purple), ${batColor})`,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DronePanel;
