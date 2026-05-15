from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
import math
import random
import uuid
import time

app = FastAPI(title="RouteCore Drone Delivery API", version="3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Constants ────────────────────────────────────────────────────────────────
DEPOT_LAT = 39.9688625
DEPOT_LON = 32.7439409
MAX_RADIUS_KM = 12.0
EARTH_RADIUS_KM = 6371.0

# ─── Models ──────────────────────────────────────────────────────────────────

class Drone(BaseModel):
    id: str
    name: str
    payload_capacity: float   # kg
    max_range: float          # km
    battery_capacity: float   # %
    current_battery: float    # %
    speed: float              # km/h
    altitude: float           # meters
    deliveries_count: int = 0 # cumulative
    current_load: int = 0     # current mission
    status: str = "idle"

class DroneCreate(BaseModel):
    name: str
    payload_capacity: float
    max_range: float
    battery_capacity: float = 100.0
    speed: float = 40.0
    altitude: Optional[float] = None

class Order(BaseModel):
    id: str
    lat: float
    lon: float
    weight: float             # kg
    status: str = "pending"
    assigned_drone: Optional[str] = None
    distance_to_depot: float = 0.0

class OrderCreate(BaseModel):
    weight: float

class SimulationStatus(BaseModel):
    status: str               # "idle" | "running" | "finished"
    progress: float           # 0-100
    iteration: int
    total_iterations: int
    current_cost: float
    best_cost: float
    temperature: float
    result: Optional[Dict[str, Any]] = None

# ─── State ───────────────────────────────────────────────────────────────────

drones: List[Drone] = [
    Drone(id="d1", name="SkySwift X1",    payload_capacity=5.0,  max_range=20.0, battery_capacity=100.0, current_battery=100.0, speed=40.0, altitude=112.5, deliveries_count=0, current_load=0),
    Drone(id="d2", name="HeavyLift H2",   payload_capacity=15.0, max_range=15.0, battery_capacity=100.0, current_battery=100.0, speed=30.0, altitude=105.0, deliveries_count=0, current_load=0),
    Drone(id="d3", name="RangeMaster R3", payload_capacity=8.0,  max_range=30.0, battery_capacity=100.0, current_battery=100.0, speed=50.0, altitude=118.2, deliveries_count=0, current_load=0),
]

orders: List[Order] = []

sim_status = SimulationStatus(
    status="idle",
    progress=0.0,
    iteration=0,
    total_iterations=0,
    current_cost=0.0,
    best_cost=0.0,
    temperature=0.0,
)

# ─── Helpers ─────────────────────────────────────────────────────────────────

def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Returns distance in km between two (lat, lon) points."""
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1))
         * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def generate_random_location(center_lat: float, center_lon: float, max_radius_km: float):
    """
    Returns (lat, lon) within max_radius_km of (center_lat, center_lon).
    Uses proper geographic calculation with Haversine guarantee.
    """
    while True:
        r = random.uniform(1.0, max_radius_km)
        theta = random.uniform(0, 2 * math.pi)
        delta_lat = math.degrees(r / EARTH_RADIUS_KM)
        delta_lon = math.degrees(r / (EARTH_RADIUS_KM * math.cos(math.radians(center_lat))))
        lat = center_lat + delta_lat * math.sin(theta)
        lon = center_lon + delta_lon * math.cos(theta)
        if haversine(center_lat, center_lon, lat, lon) <= max_radius_km:
            return lat, lon


def _seed_orders():
    """Populate initial orders."""
    global orders
    weights = [2.0, 4.0, 6.0, 1.5, 3.5, 7.5]
    for i, w in enumerate(weights, 1):
        lat, lon = generate_random_location(DEPOT_LAT, DEPOT_LON, MAX_RADIUS_KM)
        dist = round(haversine(DEPOT_LAT, DEPOT_LON, lat, lon), 2)
        orders.append(Order(id=f"o{i}", lat=lat, lon=lon, weight=w, distance_to_depot=dist))


_seed_orders()

# ─── Cost / SA ────────────────────────────────────────────────────────────────

def route_cost(route_order_ids: List[str], order_map: Dict[str, Order],
               drone: Drone) -> tuple:
    """
    Returns (distance_km, energy, penalty).
    Energy ∝ distance × weight.
    """
    if not route_order_ids:
        return 0.0, 0.0, 0.0

    clat, clon = DEPOT_LAT, DEPOT_LON
    total_dist = 0.0
    total_weight = 0.0
    energy = 0.0

    for oid in route_order_ids:
        o = order_map[oid]
        d = haversine(clat, clon, o.lat, o.lon)
        total_dist += d
        energy += d * o.weight
        total_weight += o.weight
        clat, clon = o.lat, o.lon

    # Return to depot
    total_dist += haversine(clat, clon, DEPOT_LAT, DEPOT_LON)

    penalty = 0.0
    if total_weight > drone.payload_capacity:
        penalty += 10000.0 + (total_weight - drone.payload_capacity) * 10000.0
    if total_dist > drone.max_range:
        penalty += 10000.0 + (total_dist - drone.max_range) * 10000.0

    return total_dist, energy, penalty


def total_cost(solution: Dict[str, List[str]], order_map: Dict[str, Order],
               drone_map: Dict[str, Drone]) -> float:
    cost = 0.0
    for drone_id, oids in solution.items():
        d, e, p = route_cost(oids, order_map, drone_map[drone_id])
        cost += d + e * 0.1 + p
    return cost


def generate_neighbor(solution: Dict[str, List[str]], drone_ids: List[str]) -> Dict[str, List[str]]:
    """Generate a neighbor by either: swap orders between drones, or reorder within a drone."""
    neighbor = {k: list(v) for k, v in solution.items()}
    op = random.random()

    if op < 0.5:
        src_ids = [did for did, oids in neighbor.items() if oids]
        if not src_ids:
            return neighbor
        src = random.choice(src_ids)
        tgt = random.choice(drone_ids)
        idx = random.randrange(len(neighbor[src]))
        oid = neighbor[src].pop(idx)
        neighbor[tgt].append(oid)

    elif op < 0.8:
        nonempty = [did for did, oids in neighbor.items() if oids]
        if len(nonempty) < 2:
            return neighbor
        d1, d2 = random.sample(nonempty, 2)
        i1 = random.randrange(len(neighbor[d1]))
        i2 = random.randrange(len(neighbor[d2]))
        neighbor[d1][i1], neighbor[d2][i2] = neighbor[d2][i2], neighbor[d1][i1]

    else:
        nonempty = [did for did, oids in neighbor.items() if len(oids) >= 2]
        if not nonempty:
            return neighbor
        did = random.choice(nonempty)
        i, j = sorted(random.sample(range(len(neighbor[did])), 2))
        neighbor[did][i:j+1] = neighbor[did][i:j+1][::-1]

    return neighbor


def run_sa_for_trip(
    current_drones: List[Drone],
    remaining_orders: List[Order],
) -> tuple:
    """
    Run one SA pass over remaining_orders using current_drones.
    Returns best_solution: {drone_id: [order_ids]}.
    """
    global sim_status
    order_map = {o.id: o for o in remaining_orders}
    drone_map = {d.id: d for d in current_drones}
    drone_ids = [d.id for d in current_drones]

    solution = {did: [] for did in drone_ids}
    shuffled = list(remaining_orders)
    random.shuffle(shuffled)
    for i, o in enumerate(shuffled):
        solution[drone_ids[i % len(drone_ids)]].append(o.id)

    current_cost_val = total_cost(solution, order_map, drone_map)
    best_solution = {k: list(v) for k, v in solution.items()}
    best_cost_val = current_cost_val

    T = 1000.0
    T_min = 0.5
    cooling = 0.995
    
    sim_status.total_iterations = int(math.log(T_min / T) / math.log(cooling))

    cost_history = []
    while T > T_min:
        neighbor = generate_neighbor(solution, drone_ids)
        nc = total_cost(neighbor, order_map, drone_map)
        delta = nc - current_cost_val
        if delta < 0 or random.random() < math.exp(-delta / T):
            solution = neighbor
            current_cost_val = nc
            if nc < best_cost_val:
                best_solution = {k: list(v) for k, v in solution.items()}
                best_cost_val = nc
        
        # Update status periodically or at least once per T change
        sim_status.current_cost = round(current_cost_val, 2)
        sim_status.best_cost = round(best_cost_val, 2)
        sim_status.temperature = round(T, 2)
        
        # Sample cost history to avoid huge lists
        if len(cost_history) < 500:
             cost_history.append(current_cost_val)
        
        T *= cooling

    return best_solution, order_map, drone_map, cost_history


def enforce_hard_constraints(
    best_solution: Dict[str, List[str]],
    order_map: Dict[str, Order],
    drone_map: Dict[str, Drone],
) -> Dict[str, List[str]]:
    """
    Remove orders from routes that violate payload/range constraints.
    Returns a clean solution with only feasible assignments.
    """
    clean = {}
    for did, oids in best_solution.items():
        current_oids = list(oids)
        dist, energy, penalty = route_cost(current_oids, order_map, drone_map[did])
        while penalty > 0 and current_oids:
            heaviest = max(current_oids, key=lambda id: order_map[id].weight)
            current_oids.remove(heaviest)
            dist, energy, penalty = route_cost(current_oids, order_map, drone_map[did])
        if current_oids:
            clean[did] = current_oids
    return clean


def build_stage_routes(
    clean_solution: Dict[str, List[str]],
    order_map: Dict[str, Order],
    drone_map: Dict[str, Drone],
    trip_number: int,
    cumulative_deliveries: Dict[str, int],
) -> tuple:
    """
    Build route payloads for one trip/stage.
    Returns (routes_dict, drone_metrics_dict, assignments_dict).
    """
    routes: Dict[str, Dict] = {}
    drone_metrics: Dict[str, Dict] = {}
    assignments: Dict[str, List[str]] = {}

    for did, oids in clean_solution.items():
        dist, energy, penalty = route_cost(oids, order_map, drone_map[did])
        if penalty > 0 or not oids:
            continue

        assignments[did] = oids
        total_so_far = cumulative_deliveries.get(did, 0) + len(oids)
        route_meta = {
            "id": did,
            "name": drone_map[did].name,
            "altitude": drone_map[did].altitude,
            "deliveries": len(oids),
            "total_delivered_so_far": total_so_far,
            "trip": trip_number,
        }
        route = {"points": [{"lat": DEPOT_LAT, "lng": DEPOT_LON}], "meta": route_meta}
        for oid in oids:
            o = order_map[oid]
            route["points"].append({"lat": o.lat, "lng": o.lon})
        route["points"].append({"lat": DEPOT_LAT, "lng": DEPOT_LON})
        routes[did] = route

        battery_used = min(100.0, (dist / drone_map[did].max_range) * 100)
        drone_metrics[did] = {
            "distance": round(dist, 2),
            "energy": round(energy, 2),
            "penalty": 0.0,
            "battery_used": round(battery_used, 1),
            "remaining_battery": round(max(0.0, 100.0 - battery_used), 1),
        }

    return routes, drone_metrics, assignments


def run_simulated_annealing(current_drones: List[Drone], current_orders: List[Order]):
    """
    Multi-trip SA loop.
    Each iteration is one 'trip' (stage): drones are assigned orders, fly routes,
    return to depot, recharge, and the next trip handles remaining unserved orders.
    Continues until all orders are served or no progress can be made.
    """
    global sim_status

    if not current_drones or not current_orders:
        sim_status.status = "finished"
        return

    # Stages: list of {stage_number, routes, drone_metrics, assignments}
    all_stages: List[Dict] = []
    remaining_orders = list(current_orders)
    cumulative_deliveries: Dict[str, int] = {d.id: 0 for d in current_drones}
    total_orders = len(current_orders)
    served_order_ids: set = set()

    trip_number = 1
    MAX_TRIPS = 20  # safety cap

    full_cost_history = []
    while remaining_orders and trip_number <= MAX_TRIPS:
        # Update progress based on how many orders have been served
        sim_status.progress = round((len(served_order_ids) / total_orders) * 90, 1)
        sim_status.iteration = trip_number

        # Run SA for this trip
        best_solution, order_map, drone_map, stage_cost_history = run_sa_for_trip(current_drones, remaining_orders)
        full_cost_history.extend(stage_cost_history)

        # Enforce hard constraints
        clean = enforce_hard_constraints(best_solution, order_map, drone_map)

        # Collect all order IDs that will be delivered this trip
        delivered_this_trip: set = set()
        for did, oids in clean.items():
            delivered_this_trip.update(oids)

        if not delivered_this_trip:
            # No orders can be served — stop (infeasible remaining orders)
            break

        # Build stage route data
        routes, drone_metrics, assignments = build_stage_routes(
            clean, order_map, drone_map, trip_number, cumulative_deliveries
        )

        # Update cumulative delivery counts
        for did, oids in assignments.items():
            cumulative_deliveries[did] = cumulative_deliveries.get(did, 0) + len(oids)

        # Record this stage
        stage_total_dist = sum(v["distance"] for v in drone_metrics.values())
        stage_total_energy = sum(v["energy"] for v in drone_metrics.values())
        all_stages.append({
            "stage": trip_number,
            "routes": routes,
            "drone_metrics": drone_metrics,
            "assignments": assignments,
            "total_distance": round(stage_total_dist, 2),
            "total_energy": round(stage_total_energy, 2),
            "total_cost": round(stage_total_dist + stage_total_energy * 0.1, 3),
        })

        served_order_ids.update(delivered_this_trip)

        # Remove served orders from remaining
        remaining_orders = [o for o in remaining_orders if o.id not in delivered_this_trip]

        # Reset drones (battery recharge, payload cleared) for next trip
        for d in current_drones:
            d.current_battery = d.battery_capacity

        trip_number += 1

    # ── Merge all-stages view ──────────────────────────────────────────────────
    # "all" routes: for each drone accumulate all trips into a single route entry list
    all_routes_flat: Dict[str, List[Dict]] = {}
    for stage in all_stages:
        for did, route in stage["routes"].items():
            if did not in all_routes_flat:
                all_routes_flat[did] = []
            all_routes_flat[did].append(route)

    # Assign final statuses to the global orders list
    for o in orders:
        if o.id in served_order_ids:
            o.status = "assigned"
            # Find which drone served this order
            for stage in all_stages:
                for did, oids in stage["assignments"].items():
                    if o.id in oids:
                        o.assigned_drone = did
                        break
        else:
            o.status = "pending"

    # Update global drone stats
    for d in drones:
        d.deliveries_count += cumulative_deliveries.get(d.id, 0)
        d.current_load = 0
        total_trips = sum(1 for s in all_stages if d.id in s["assignments"])
        d.status = "delivering" if total_trips > 0 else "idle"
        # Battery after all trips (simplified: reset to full since they recharge)
        d.current_battery = d.battery_capacity

    # Totals across all stages
    total_dist_all = sum(s["total_distance"] for s in all_stages)
    total_energy_all = sum(s["total_energy"] for s in all_stages)

    sim_status.status = "finished"
    sim_status.progress = 100.0
    sim_status.best_cost = round(total_dist_all + total_energy_all * 0.1, 3)
    sim_status.result = {
        "stages": all_stages,
        "all_routes": all_routes_flat,   # drone_id -> [route_per_stage]
        "total_stages": len(all_stages),
        "total_orders": total_orders,
        "served_orders": len(served_order_ids),
        "unserved_orders": total_orders - len(served_order_ids),
        "total_distance": round(total_dist_all, 2),
        "total_energy": round(total_energy_all, 2),
        "total_cost": round(total_dist_all + total_energy_all * 0.1, 3),
        "cost_history": full_cost_history,
    }


# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/drones", response_model=List[Drone])
async def get_drones():
    return drones


@app.post("/drones", response_model=Drone)
async def add_drone(data: DroneCreate):
    new_id = f"d{uuid.uuid4().hex[:6]}"
    drone = Drone(
        id=new_id,
        name=data.name,
        payload_capacity=data.payload_capacity,
        max_range=data.max_range,
        battery_capacity=data.battery_capacity,
        current_battery=data.battery_capacity,
        speed=data.speed,
        altitude=data.altitude if data.altitude is not None else round(random.uniform(100.0, 120.0), 1),
    )
    drones.append(drone)
    return drone


@app.delete("/drones/{drone_id}")
async def remove_drone(drone_id: str):
    global drones
    before = len(drones)
    drones = [d for d in drones if d.id != drone_id]
    if len(drones) == before:
        raise HTTPException(status_code=404, detail="Drone not found")
    return {"message": "Drone removed"}


@app.get("/orders", response_model=List[Order])
async def get_orders():
    return orders


@app.post("/orders", response_model=Order)
async def add_order(data: OrderCreate):
    if not drones:
        raise HTTPException(status_code=400, detail="No drones available to evaluate order feasibility")
    
    max_cap = max(d.payload_capacity for d in drones)
    max_rng = max(d.max_range for d in drones)

    if data.weight <= 0 or data.weight > max_cap:
        raise HTTPException(status_code=400, detail=f"Weight must be between 0 and {max_cap} kg (max drone capacity)")

    # Keep trying locations until one is within range of at least one drone
    attempts = 0
    while attempts < 100:
        lat, lon = generate_random_location(DEPOT_LAT, DEPOT_LON, MAX_RADIUS_KM)
        dist = round(haversine(DEPOT_LAT, DEPOT_LON, lat, lon), 2)
        if (dist * 2) <= max_rng:
            new_id = f"o{uuid.uuid4().hex[:6]}"
            order = Order(id=new_id, lat=round(lat, 6), lon=round(lon, 6), weight=data.weight, distance_to_depot=dist)
            orders.append(order)
            return order
        attempts += 1
    
    raise HTTPException(status_code=400, detail="Could not generate a reachable location for this order given current drone ranges")


@app.delete("/orders/{order_id}")
async def remove_order(order_id: str):
    global orders
    before = len(orders)
    orders = [o for o in orders if o.id != order_id]
    if len(orders) == before:
        raise HTTPException(status_code=404, detail="Order not found")
    return {"message": "Order removed"}


@app.post("/generate-orders")
async def generate_orders(count: int = 6):
    """Generate N random orders that are all feasible for the current fleet."""
    global orders
    if not drones:
        raise HTTPException(status_code=400, detail="No drones available. Create drones first.")
    if count < 1 or count > 100:
        raise HTTPException(status_code=400, detail="Count must be 1-100")
    
    max_cap = max(d.payload_capacity for d in drones)
    max_rng = max(d.max_range for d in drones)

    orders.clear()
    for i in range(count):
        # Retry until order is feasible
        while True:
            lat, lon = generate_random_location(DEPOT_LAT, DEPOT_LON, MAX_RADIUS_KM)
            dist = round(haversine(DEPOT_LAT, DEPOT_LON, lat, lon), 2)
            
            # Use random weight but cap at 10kg OR max drone capacity (whichever is smaller)
            weight_cap = min(10.0, max_cap)
            weight = round(random.uniform(1.0, weight_cap), 1)
            
            # Check feasibility (round trip distance must be <= max range of at least one drone)
            if (dist * 2) <= max_rng:
                orders.append(Order(
                    id=f"o{uuid.uuid4().hex[:6]}",
                    lat=round(lat, 6),
                    lon=round(lon, 6),
                    weight=weight,
                    distance_to_depot=dist,
                ))
                break
    return orders


@app.post("/generate-drones")
async def generate_drones(count: int = 3):
    """Generate N random drones."""
    global drones
    if count < 1 or count > 20:
        raise HTTPException(status_code=400, detail="Count must be 1-20")
    names = ["SkySwift", "HeavyLift", "RangeMaster", "StealthWing", "NightHawk",
             "ThunderBolt", "SilverArrow", "GhostRider", "IronEagle", "SwiftDart"]
    drones.clear()
    for i in range(count):
        drones.append(Drone(
            id=f"d{uuid.uuid4().hex[:6]}",
            name=f"{random.choice(names)} {chr(65+i)}",
            payload_capacity=round(random.uniform(5.0, 20.0), 1),
            max_range=round(random.uniform(10.0, 30.0), 1),
            battery_capacity=100.0,
            current_battery=100.0,
            speed=round(random.uniform(30.0, 60.0), 1),
            altitude=round(random.uniform(100.0, 120.0), 1),
            deliveries_count=0,
        ))
    return drones


@app.post("/simulate")
async def start_simulation(background_tasks: BackgroundTasks):
    global sim_status
    if sim_status.status == "running":
        raise HTTPException(status_code=409, detail="Simulation already running")
    if not drones:
        raise HTTPException(status_code=400, detail="No drones configured")
    if not orders:
        raise HTTPException(status_code=400, detail="No orders to optimize")

    max_drone_capacity = max(d.payload_capacity for d in drones)
    max_drone_range = max(d.max_range for d in drones)
    for o in orders:
        if o.weight > max_drone_capacity:
            raise HTTPException(
                status_code=400,
                detail=f"Order {o.id} ({o.weight}kg) is too heavy. Max drone payload is {max_drone_capacity}kg."
            )
        if (o.distance_to_depot * 2) > max_drone_range:
            raise HTTPException(
                status_code=400,
                detail=f"Order {o.id} is {o.distance_to_depot:.1f}km away (requires {o.distance_to_depot * 2:.1f}km round-trip). Max drone range is {max_drone_range}km."
            )

    # Reset state
    for d in drones:
        d.current_battery = d.battery_capacity
        d.status = "idle"
    for o in orders:
        o.status = "pending"
        o.assigned_drone = None

    sim_status = SimulationStatus(
        status="running",
        progress=0.0,
        iteration=0,
        total_iterations=0,
        current_cost=0.0,
        best_cost=0.0,
        temperature=1000.0,
    )

    snap_drones = [d.copy() for d in drones]
    snap_orders = [o.copy() for o in orders]
    background_tasks.add_task(run_simulated_annealing, snap_drones, snap_orders)
    return {"message": "Simulation started"}


@app.get("/status", response_model=SimulationStatus)
async def get_status():
    return sim_status


@app.post("/reset")
async def reset():
    global sim_status, drones, orders
    sim_status = SimulationStatus(
        status="idle", progress=0.0, iteration=0,
        total_iterations=0, current_cost=0.0, best_cost=0.0, temperature=0.0
    )
    for d in drones:
        d.current_battery = d.battery_capacity
        d.deliveries_count = 0
        d.current_load = 0
        d.status = "idle"
    for o in orders:
        o.status = "pending"
        o.assigned_drone = None
    return {"message": "Reset complete"}


@app.get("/depot")
async def get_depot():
    return {"lat": DEPOT_LAT, "lon": DEPOT_LON, "name": "Ostim Technical University"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
