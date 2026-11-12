// Weather presets. Rain lowers grip (the kart slides more), softens steering
// and costs a little top speed; night is mostly a look, with slightly less grip.
// The renderer uses the same id to tint the scene, add rain and turn on lights.

export const Weathers = {
  clear: { id: "clear", label: "Clear", grip: 1, top: 1, accel: 1, steer: 1 },
  rain: { id: "rain", label: "Rain", grip: 0.74, top: 0.97, accel: 0.94, steer: 0.93 },
  night: { id: "night", label: "Night", grip: 0.9, top: 1, accel: 1, steer: 0.98 },
};

export const WeatherOptions = Object.values(Weathers);

export function weatherFor(id) {
  return Weathers[id] ?? Weathers.clear;
}

// Copy the weather's driving numbers onto every kart. Returns the preset so the
// game loop can keep it for rendering.
export function applyWeather(karts, id) {
  const weather = weatherFor(id);
  for (const kart of karts) {
    kart.grip = weather.grip;
    kart.topScale = weather.top;
    kart.accelScale = weather.accel;
    kart.steerScale = weather.steer;
    kart.weather = weather.id;
  }
  return weather;
}
