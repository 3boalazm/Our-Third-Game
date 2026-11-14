// Garage loadouts: chassis and workshop kits have real race-time effects.
export const GarageVehicles = [
  { id: "sprint", name: "Sprint GT", className: "LIGHTWEIGHT", description: "Fast launch · sharp cornering", speed: 0.96, accel: 1.12, handling: 1.12, shape: "sprint", cost: 0 },
  { id: "apex", name: "Apex R", className: "ALL-ROUNDER", description: "A balanced choice for every circuit", speed: 1, accel: 1, handling: 1, shape: "apex", cost: 0 },
  { id: "thunder", name: "Thunder XR", className: "POWER CLASS", description: "High top speed · heavier handling", speed: 1.09, accel: 0.94, handling: 0.91, shape: "thunder", cost: 1200 },
];
export const GarageTunes = [
  { id: "balanced", name: "Balanced", description: "Factory setup", speed: 1, accel: 1, handling: 1, nitro: 1, cost: 0 },
  { id: "engine", name: "Engine kit", description: "+4% speed · +5% launch", speed: 1.04, accel: 1.05, handling: 0.97, nitro: 1, cost: 0 },
  { id: "suspension", name: "Grip kit", description: "+12% cornering grip", speed: 0.97, accel: 1, handling: 1.12, nitro: 1, cost: 450 },
  { id: "nitro", name: "Nitro kit", description: "+25% boost duration", speed: 1, accel: 1, handling: 1, nitro: 1.25, cost: 650 },
];
export function vehicleById(id) { return GarageVehicles.find((item) => item.id === id) ?? GarageVehicles[1]; }
export function tuneById(id) { return GarageTunes.find((item) => item.id === id) ?? GarageTunes[0]; }
export function loadoutStats(vehicleId, tuneId) {
  const vehicle = vehicleById(vehicleId);
  const tune = tuneById(tuneId);
  return {
    speed: Math.round(vehicle.speed * tune.speed * 100),
    accel: Math.round(vehicle.accel * tune.accel * 100),
    handling: Math.round(vehicle.handling * tune.handling * 100),
    nitro: Math.round(tune.nitro * 100),
  };
}
