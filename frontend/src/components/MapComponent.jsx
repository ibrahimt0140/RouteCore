import React, { useEffect, useRef, useState } from 'react';
import {
  MapContainer, TileLayer, Marker, Popup,
  Polyline, Circle, useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon paths for bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const DEPOT = [39.9688625, 32.7439409];

const DRONE_COLORS = [
  '#00e5ff', '#7c3aed', '#00e676', '#ffc107',
  '#ff4d6d', '#818cf8', '#34d399', '#f97316',
];

// Stage accent colors (used for route lines per stage)
const STAGE_COLORS = [
  '#00e5ff', '#ffc107', '#00e676', '#ff4d6d',
  '#818cf8', '#f97316', '#34d399', '#7c3aed',
  '#e879f9', '#38bdf8', '#fb923c', '#a3e635',
];

// Custom depot icon
const depotIcon = L.divIcon({
  className: '',
  html: `
    <div style="
      width:36px; height:36px;
      background: linear-gradient(135deg, #00e5ff, #7c3aed);
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.4);
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
      box-shadow: 0 0 16px rgba(0,229,255,0.6), 0 0 32px rgba(124,58,237,0.3);
    ">🏭</div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

const makeOrderIcon = (color, index) => L.divIcon({
  className: '',
  html: `
    <div style="
      width:28px; height:28px;
      background: ${color};
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 2px solid rgba(255,255,255,0.5);
      box-shadow: 0 0 10px ${color}88;
      display: flex; align-items: center; justify-content: center;
    ">
      <span style="transform: rotate(45deg); font-size:11px; font-weight:700; color:#000;">${index + 1}</span>
    </div>`,
  iconSize: [28, 28],
  iconAnchor: [10, 28],
});

const pendingOrderIcon = (index) => L.divIcon({
  className: '',
  html: `
    <div style="
      width:26px; height:26px;
      background: rgba(255,255,255,0.08);
      border: 1.5px solid rgba(120,150,220,0.5);
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    ">
      <span style="transform: rotate(45deg); font-size:10px; color: #aaa;">${index + 1}</span>
    </div>`,
  iconSize: [26, 26],
  iconAnchor: [9, 26],
});

// Keeps map view fresh when orders change, but prevents jumping during stage switching
const MapController = ({ orders, simStatus, selectedStage }) => {
  const map = useMap();
  const lastTotalCount = useRef(0);

  useEffect(() => {
    // Only re-zoom if:
    // 1. We are in 'idle' (generating/adding orders)
    // 2. We just finished the simulation and are showing 'all'
    if (simStatus === 'idle' || (simStatus === 'finished' && selectedStage === 'all')) {
      if (orders.length > 0) {
        const all = [DEPOT, ...orders.map(o => [o.lat, o.lon])];
        map.fitBounds(all, { padding: [40, 40], maxZoom: 14 });
      } else {
        map.setView(DEPOT, 13);
      }
    }
  }, [orders.length, simStatus, selectedStage]);
  return null;
};

/**
 * Compute which routes to render based on selectedStage.
 * Returns flat array of { droneId, color, positions, meta, stageNum }.
 */
function getVisibleRoutes(stages, selectedStage, droneColorMap) {
  if (!stages || stages.length === 0) return [];

  const result = [];

  const stagesToShow = selectedStage === 'all'
    ? stages
    : stages.filter(s => s.stage === selectedStage);

  for (const stage of stagesToShow) {
    const stageColor = STAGE_COLORS[(stage.stage - 1) % STAGE_COLORS.length];
    for (const [droneId, routeData] of Object.entries(stage.routes || {})) {
      const positions = (routeData.points || []).map(p => [p.lat, p.lng]);
      if (positions.length < 2) continue;
      result.push({
        droneId,
        color: stageColor,          // colour by stage
        droneColor: droneColorMap[droneId] || '#00e5ff',  // colour by drone (legend)
        positions,
        meta: routeData.meta,
        stageNum: stage.stage,
      });
    }
  }
  return result;
}

const MapComponent = ({ orders, drones, stages, selectedStage, simStatus }) => {
  const droneColorMap = {};
  drones.forEach((d, i) => { droneColorMap[d.id] = DRONE_COLORS[i % DRONE_COLORS.length]; });

  const visibleRoutes = getVisibleRoutes(stages, selectedStage, droneColorMap);
  const hasRoutes = visibleRoutes.length > 0;

  return (
    <div className="map-wrap" style={{ height: '100%' }}>
      <MapContainer
        center={DEPOT}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <MapController orders={orders} simStatus={simStatus} selectedStage={selectedStage} />
        {/* Light CartoDB tile layer */}
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={19}
        />

        {/* 20 km radius boundary */}
        <Circle
          center={DEPOT}
          radius={20000}
          pathOptions={{
            color: 'rgba(0, 229, 255, 0.86)',
            weight: 1.5,
            dashArray: '6 6',
            fillColor: 'rgba(0, 229, 255, 0.05)',
            fillOpacity: 1,
          }}
        />

        {/* Depot Marker */}
        <Marker position={DEPOT} icon={depotIcon}>
          <Popup>
            <div style={{ padding: '4px' }}>
              <strong style={{ color: '#00e5ff' }}>🏭 Central Depot</strong><br />
              Ostim Technical University<br />
              <span style={{ color: '#7986a3', fontSize: '11px' }}>
                {DEPOT[0].toFixed(4)}, {DEPOT[1].toFixed(4)}
              </span>
            </div>
          </Popup>
        </Marker>

        {/* Order markers */}
        {orders.map((order, i) => {
          const color = order.assigned_drone ? droneColorMap[order.assigned_drone] : null;
          const icon = color ? makeOrderIcon(color, i) : pendingOrderIcon(i);
          const droneObj = order.assigned_drone ? drones.find(d => d.id === order.assigned_drone) : null;

          return (
            <Marker key={order.id} position={[order.lat, order.lon]} icon={icon}>
              <Popup>
                <div style={{ padding: '4px' }}>
                  <strong style={{ color: color || '#7986a3' }}>
                    📦 Order #{i + 1}
                  </strong><br />
                  Weight: <strong>{order.weight} kg</strong><br />
                  Status: <span style={{ color: color || '#ffc107' }}>
                    {order.status === 'assigned' ? '✓ Assigned' : '⏳ Pending'}
                  </span><br />
                  {droneObj && (
                    <>Drone: <span style={{ color }}>{droneObj.name}</span><br /></>
                  )}
                  <span style={{ color: '#7986a3', fontSize: '11px' }}>
                    {order.lat.toFixed(4)}, {order.lon.toFixed(4)}
                  </span>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Optimized routes — coloured by stage */}
        {visibleRoutes.map(({ droneId, color, positions, meta, stageNum }, idx) => (
          <React.Fragment key={`${droneId}-stage${stageNum}-${idx}`}>
            {/* Glow shadow */}
            <Polyline
              positions={positions}
              pathOptions={{ color, weight: 8, opacity: 0.13 }}
            />
            {/* Main route line */}
            <Polyline
              positions={positions}
              pathOptions={{ color, weight: 2.5, opacity: 0.9, dashArray: '8 5' }}
            >
              <Popup>
                <div style={{ padding: '4px' }}>
                  <strong style={{ color }}>🚁 {meta?.name || droneId}</strong><br />
                  <span style={{ color: '#7986a3', fontSize: '11px' }}>Trip {stageNum}</span><br />
                  Altitude: <strong>{meta?.altitude ?? 0} m</strong><br />
                  Packages this trip: <strong>{meta?.deliveries ?? 0}</strong><br />
                  Total delivered: <strong>{meta?.total_delivered_so_far ?? 0}</strong><br />
                  Stops: <strong>{positions.length > 2 ? positions.length - 2 : 0}</strong>
                </div>
              </Popup>
            </Polyline>
          </React.Fragment>
        ))}


      </MapContainer>

      {/* Running overlay */}
      {simStatus === 'running' && (
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(4,5,10,0.85)', border: '1px solid rgba(0,229,255,0.3)',
          borderRadius: '100px', padding: '6px 16px',
          fontSize: '12px', color: '#00e5ff', fontWeight: 600,
          backdropFilter: 'blur(10px)', zIndex: 999, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span className="spin">⚙</span>
          Multi-trip Simulated Annealing running…
        </div>
      )}

      {/* Stage legend — only after finish */}
      {hasRoutes && stages.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 24, right: 10,
          background: 'rgba(4,5,10,0.88)', border: '1px solid rgba(80,130,255,0.2)',
          borderRadius: '10px', padding: '10px 14px',
          fontSize: '11px', backdropFilter: 'blur(12px)',
          zIndex: 999, maxWidth: '200px',
        }}>
          <div style={{ color: 'var(--text-muted)', marginBottom: '7px', fontWeight: 600, textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.5px' }}>
            {selectedStage === 'all' ? 'All Trips' : `Trip ${selectedStage}`}
          </div>

          {/* Stage color rows */}
          {(selectedStage === 'all' ? stages : stages.filter(s => s.stage === selectedStage)).map(s => {
            const sc = STAGE_COLORS[(s.stage - 1) % STAGE_COLORS.length];
            const droneNames = Object.keys(s.routes || {}).map(did => {
              const d = drones.find(x => x.id === did);
              return d ? d.name.split(' ').slice(0, 2).join(' ') : did;
            });
            return (
              <div key={s.stage} style={{ marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <div style={{ width: '18px', height: '3px', background: sc, borderRadius: '2px', flexShrink: 0 }} />
                  <span style={{ color: '#dde', fontWeight: 700, fontSize: '11px' }}>Trip {s.stage}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                    {Object.values(s.routes || {}).reduce((a, r) => a + (r.points?.length > 2 ? r.points.length - 2 : 0), 0)} orders
                  </span>
                </div>
                <div style={{ paddingLeft: '25px', color: 'var(--text-muted)', fontSize: '10px', lineHeight: 1.4 }}>
                  {droneNames.join(', ')}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MapComponent;
