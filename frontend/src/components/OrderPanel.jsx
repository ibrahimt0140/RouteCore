import React, { useState } from 'react';

const API = 'http://localhost:8000';

const DRONE_COLORS = [
  '#00e5ff', '#7c3aed', '#00e676', '#ffc107',
  '#ff4d6d', '#818cf8', '#34d399', '#f97316',
];

const OrderPanel = ({ orders, drones, onRefresh, simStatus }) => {
  const [showForm, setShowForm] = useState(false);
  const [genCount, setGenCount] = useState(6);
  const [weight, setWeight] = useState('3');
  const [loading, setLoading] = useState(false);

  const addOrder = async () => {
    const w = parseFloat(weight);
    if (!w || w <= 0 || w > 50) return;
    setLoading(true);
    try {
      await fetch(`${API}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight: w }),
      });
      setWeight('3');
      setShowForm(false);
      onRefresh();
    } finally { setLoading(false); }
  };

  const removeOrder = async (id) => {
    await fetch(`${API}/orders/${id}`, { method: 'DELETE' });
    onRefresh();
  };

  const generateOrders = async () => {
    setLoading(true);
    try {
      await fetch(`${API}/generate-orders?count=${genCount}`, { method: 'POST' });
      onRefresh();
    } finally { setLoading(false); }
  };

  const isRunning = simStatus === 'running';

  // Build drone index for color lookup
  const droneColorMap = {};
  drones.forEach((d, i) => {
    droneColorMap[d.id] = DRONE_COLORS[i % DRONE_COLORS.length];
  });

  const totalWeight = orders.reduce((s, o) => s + o.weight, 0);

  return (
    <div className="glass side-panel">
      {/* Header */}
      <div className="panel-header">
        <div className="panel-title">
          <span>📦</span> Orders
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            {orders.length} · {totalWeight.toFixed(1)} kg
          </span>
        </div>
        <div className="panel-subtitle">Delivery assignments</div>

        {/* Generate row */}
        <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className="num-spinner">
            <button onClick={() => setGenCount(c => Math.max(1, c - 1))}>−</button>
            <span>{genCount}</span>
            <button onClick={() => setGenCount(c => Math.min(30, c + 1))}>+</button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={generateOrders} disabled={isRunning || loading}>
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
            <div className="add-form-title">New Order</div>
            <div className="form-group" style={{ marginBottom: '10px' }}>
              <label className="form-label">Weight (kg)</label>
              <input
                className="field field-sm"
                type="number" min="0.1" max="50" step="0.1"
                value={weight}
                onChange={e => setWeight(e.target.value)}
                placeholder="e.g. 3.5"
              />
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '10px' }}>
              📍 Location auto-generated within 20 km of depot
            </div>
            <button className="btn btn-primary btn-sm" onClick={addOrder} disabled={loading}>
              {loading ? '⏳ Adding…' : '✓ Add Order'}
            </button>
          </div>
        )}

        {/* Order cards */}
        {orders.length === 0 && (
          <div className="empty">
            <div className="empty-icon">📦</div>
            No orders yet.<br />Generate or add orders above.
          </div>
        )}

        {orders.map((order) => {
          const droneColor = order.assigned_drone ? droneColorMap[order.assigned_drone] : null;
          const droneObj = order.assigned_drone ? drones.find(d => d.id === order.assigned_drone) : null;

          return (
            <div className="card" key={order.id} style={{ paddingLeft: droneColor ? '18px' : '13px' }}>
              {droneColor && <div className="drone-strip" style={{ background: droneColor }} />}

              <div className="card-header">
                <span className="card-title" style={{ fontSize: '12px' }}>
                  📍 {order.lat.toFixed(4)}, {order.lon.toFixed(4)}
                </span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span className={`tag tag-${order.status}`}>
                    {order.status === 'assigned' ? '✓ Assigned' : '⏳ Pending'}
                  </span>
                  {!isRunning && (
                    <button className="card-del-btn" onClick={() => removeOrder(order.id)} title="Remove order">✕</button>
                  )}
                </div>
              </div>

              <div className="card-body">
                <div className="stat">Weight <span>{order.weight} kg</span></div>
                <div className="stat">Dist <span>{order.distance_to_depot !== undefined ? order.distance_to_depot.toFixed(1) : '—'} km</span></div>
                <div className="stat">
                  Drone{' '}
                  <span style={{ color: droneColor || 'var(--text-muted)' }}>
                    {droneObj ? droneObj.name.split(' ')[0] : '—'}
                  </span>
                </div>
              </div>

              {/* Distance from depot indicator */}
              <div style={{
                marginTop: '8px', fontSize: '10px', color: 'var(--text-dim)',
                display: 'flex', gap: '8px', alignItems: 'center',
              }}>
                <span>ID: <code style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{order.id}</code></span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OrderPanel;
