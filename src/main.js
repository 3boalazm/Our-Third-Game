import "./styles.css";
import "./menu.css";
import { Tracks, buildTrack, trackById } from "./track.js";
import {
  FixedStep,
  KartColors,
  KartScale,
  LiveryOptions,
  Physics,
  angleDiff,
  botInput,
  formatTime,
  makeKart,
  placeOnGrid,
  resolveContacts,
  rubberBand,
  stepKart,
} from "./game.js";
import { loadGhost, recordGhostFrame, sampleGhost, saveGhost } from "./ghost.js";
import { WeatherOptions, applyWeather } from "./weather.js";
import { challengeForDate, isChallengeDone, markChallengeDone } from "./challenges.js";
import { createRenderer } from "./render.js";
import {
  DefaultPadBindings,
  PadButtonNames,
  activeGamepad,
  bindInput,
  enableTilt,
  gamepadAvailable,
  gamepadDownButtons,
  gamepadPausePressed,
  isTouchDevice,
  normalizePadBindings,
  setPadBindings,
  readInput,
  recenterTilt,
  resetInput,
  setControls,
  setTiltOptions,
  steerNow,
  tiltNeedsPermission,
  tiltStatus,
  tiltSupported,
  usingTilt,
} from "./input.js";
import { audio } from "./audio.js";
import { initLayout, onLayout, setForceLandscape } from "./layout.js";
import { createOnlineSession, createRoomId } from "./online.js";

const LapOptions = [1, 3, 5];
const DifficultyOptions = ["easy", "normal", "hard"];
// Bot skill multiplies their top speed; the AI also drifts and uses nitro.
const BotSkills = {
  easy: [0.66, 0.71, 0.76],
  normal: [0.79, 0.84, 0.89],
  hard: [0.90, 0.96, 1.02],
};
// Tilt sensitivity is a number from 1 (calm) to 10 (twitchy). It sets how many
// degrees of tilt give full steering lock: 6 is about 24 degrees.
const SensMin = 1;
const SensMax = 10;
const SensDefault = 6;
const tiltRangeFor = (sens) => 44 - 3.4 * sens;
const CountdownSeconds = 3.2;
const SendEverySeconds = 0.05;

// ---------- settings from the address bar ----------

const params = new URLSearchParams(window.location.search);
const RoomPattern = /^\d{4}$/;

// Older versions stored low / normal / high.
function readSens(saved) {
  const n = Number(saved.tiltSens);
  if (Number.isFinite(n) && n >= SensMin && n <= SensMax) {
    return Math.round(n);
  }
  return { low: 3, normal: 6, high: 9 }[saved.sensitivity] ?? SensDefault;
}

function readRecords(raw) {
  const out = {};
  if (raw && typeof raw === "object") {
    for (const id of Tracks.map((track) => track.id)) {
      const value = Number(raw[id]);
      if (Number.isFinite(value) && value > 0) out[id] = value;
    }
  }
  return out;
}

function readPrefs() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem("kart-prefs") || "{}");
  } catch {
    // storage blocked
  }
  const laps = Number(params.get("laps") ?? saved.laps);
  return {
    laps: LapOptions.includes(laps) ? laps : 3,
    track: trackById(params.get("track") ?? saved.track).id,
    sound: saved.sound !== false,
    tipSeen: saved.tipSeen === true,
    // phone controls
    steer: saved.steer === "buttons" ? "buttons" : "tilt",
    tiltSens: readSens(saved),
    screenMode: saved.screenMode === "landscape" ? "landscape" : "auto",
    fullscreen: saved.fullscreen !== false,
    camera: saved.camera === "fixed" ? "fixed" : "chase",
    flip: saved.flip === true,
    autoDrift: saved.autoDrift !== false,
    difficulty: DifficultyOptions.includes(saved.difficulty) ? saved.difficulty : "normal",
    records: readRecords(saved.records),
    color: KartColors.includes(saved.color) ? saved.color : KartColors[0],
    livery: LiveryOptions.includes(saved.livery) ? saved.livery : "stripe",
    weather: WeatherOptions.some((w) => w.id === saved.weather) ? saved.weather : "clear",
    padBindings: normalizePadBindings(saved.padBindings),
  };
}
const prefs = readPrefs();
function recordFor(trackId) {
  return prefs.records[trackId] ?? 0;
}

// Medals are lap-time goals that scale with the length of the track.
const MedalPace = { gold: 400, silver: 340, bronze: 285 }; // pixels per second
function medalTargets(trackDef) {
  return Object.fromEntries(
    Object.entries(MedalPace).map(([tier, pace]) => [tier, trackDef.length / pace]),
  );
}
function medalForLap(trackDef, lap) {
  if (!lap) return null;
  const targets = medalTargets(trackDef);
  if (lap <= targets.gold) return "gold";
  if (lap <= targets.silver) return "silver";
  if (lap <= targets.bronze) return "bronze";
  return null;
}
function nextMedal(trackDef, lap) {
  const targets = medalTargets(trackDef);
  if (!lap || lap > targets.bronze) return { tier: "bronze", time: targets.bronze };
  if (lap > targets.silver) return { tier: "silver", time: targets.silver };
  if (lap > targets.gold) return { tier: "gold", time: targets.gold };
  return null;
}
function medalChip(tier) {
  const span = document.createElement("span");
  span.className = `medal ${tier}`;
  span.textContent = tier[0].toUpperCase();
  span.title = `${tier[0].toUpperCase()}${tier.slice(1)} medal pace`;
  return span;
}

function savePrefs() {
  try {
    localStorage.setItem("kart-prefs", JSON.stringify(prefs));
  } catch {
    // storage blocked
  }
}

const roomParam = params.get("room");
const online = RoomPattern.test(roomParam ?? "")
  ? { role: "guest", room: roomParam }
  : params.get("online") === "host"
    ? { role: "host", room: RoomPattern.test(params.get("id") ?? "") ? params.get("id") : null }
    : null;

// ---------- page skeleton ----------

const root = document.getElementById("app");
root.innerHTML = `
  <canvas id="game"></canvas>
  <div id="hud" hidden>
    <div class="hud-left">
      <div class="hud-box"><span id="lap"></span><span id="pos"></span><span id="weather" hidden></span></div>
      <div class="hud-buttons">
        <button type="button" id="pause-btn" aria-label="Pause">&#10074;&#10074;</button>
        <button type="button" id="mute-btn" aria-label="Sound on or off"></button>
        <button type="button" id="fs-btn" aria-label="Fullscreen" hidden>&#9974;</button>
      </div>
    </div>
    <div class="hud-box right">
      <span id="time"></span>
      <span id="laptime"></span>
      <span id="best"></span>
      <span id="ghost" hidden></span>
      <span id="speed"></span>
      <span id="draft" class="draft" hidden>Slipstream</span>
      <div class="nitro-widget" id="nitro-widget" data-state="ready">
        <div class="nitro-topline"><span>NITRO FUEL</span><strong id="nitro-value">30%</strong></div>
        <div class="meter" id="nitro-meter" role="progressbar" aria-label="Nitro fuel" aria-valuemin="0" aria-valuemax="100" aria-valuenow="30">
          <i id="nitro-fill"></i>
        </div>
        <span class="nitro-status" id="nitro-status">HOLD TO BOOST</span>
        <span class="nitro-help">AUTO +1.5%/SEC · DRIFT +16%/SEC (MAX +50%)</span>
        <span class="nitro-help">Clean slide 0.6s+, then release on track. Blue pads = short burst, no tank refill.</span>
      </div>
    </div>
  </div>
  <div id="net" hidden></div>
  <div id="lights" hidden><i></i><i></i><i></i></div>
  <div id="countdown" hidden></div>
  <div id="wrongway" hidden>Wrong way!</div>
  <div id="toast" hidden></div>
  <div id="tip" hidden></div>
  <div id="replay" class="replay-ui" hidden>
    <div class="replay-bar">
      <span class="replay-label">Replay</span>
      <span class="replay-track"><i></i></span>
      <button type="button" data-act="replay-exit">Exit</button>
    </div>
  </div>
  <div id="photo" class="photo-ui" hidden>
    <div class="photo-bar">
      <span class="photo-hint">Photo mode · drag or arrows to orbit · wheel to zoom · S saves · Esc exits</span>
      <button type="button" data-act="photo-save">Save photo</button>
      <button type="button" data-act="photo-exit">Exit</button>
    </div>
  </div>
  <button type="button" id="tilt-prompt" hidden>Tap to turn on tilt steering</button>
  <div id="touch" hidden>
    <div id="tilt-gauge" hidden><i></i></div>
    <div class="touch-left">
      <button type="button" class="brake" data-touch="brake" aria-label="Brake">Brake</button>
      <button type="button" class="steer" data-touch="left" aria-label="Steer left">&#9664;</button>
      <button type="button" class="steer" data-touch="right" aria-label="Steer right">&#9654;</button>
    </div>
    <div class="touch-right">
      <button type="button" class="mid" id="drift-btn" data-touch="drift" aria-label="Drift" hidden>Drift</button>
      <button type="button" class="large nitro-touch" id="nitro-touch-btn" data-touch="nitro" aria-label="Nitro boost, 30 percent charged">
        <strong>NITRO</strong><small id="nitro-button-value">30%</small>
      </button>
    </div>
  </div>
  <div id="screen"></div>
`;
const $ = (id) => document.getElementById(id);
const canvas = $("game");
const renderer = createRenderer(canvas);
const photoEl = $("photo");
const replayEl = $("replay");
const hud = {
  root: $("hud"),
  lap: $("lap"),
  pos: $("pos"),
  weather: $("weather"),
  time: $("time"),
  laptime: $("laptime"),
  best: $("best"),
  ghost: $("ghost"),
  speed: $("speed"),
  draft: $("draft"),
  nitroWidget: $("nitro-widget"),
  nitroMeter: $("nitro-meter"),
  nitroValue: $("nitro-value"),
  nitroStatus: $("nitro-status"),
  nitroButton: $("nitro-touch-btn"),
  nitroButtonValue: $("nitro-button-value"),
  nitro: $("nitro-fill"),
};
const netBadge = $("net");
const countdownEl = $("countdown");
const lightsEl = $("lights");
const wrongWayEl = $("wrongway");
const toastEl = $("toast");
const tipEl = $("tip");
const touchEl = $("touch");
const screen = $("screen");
const pauseButton = $("pause-btn");
const muteButton = $("mute-btn");
const tiltGauge = $("tilt-gauge");
const tiltPrompt = $("tilt-prompt");
const driftButton = $("drift-btn");
const fsButton = $("fs-btn");

// "Landscape": if the phone will not turn (it is locked upright), layout.js turns
// the game itself with CSS. This also asks the browser to lock the screen sideways
// where that is allowed (Android, in fullscreen).
onLayout(() => renderer.resize());
initLayout(root);
setForceLandscape(prefs.screenMode === "landscape");

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.matchMedia("(display-mode: fullscreen)").matches ||
  navigator.standalone === true;

let userLeftFullscreen = false;

// Fullscreen as far as the browser allows: Android Chrome and desktop obey, an
// installed app is already fullscreen, iPhone Safari only allows it for installed apps.
async function startImmersive() {
  if (!isTouchDevice) {
    return;
  }
  if (prefs.fullscreen && !userLeftFullscreen && !document.fullscreenElement && !isStandalone()) {
    try {
      await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
    } catch {
      // not allowed here
    }
  }
  if (prefs.screenMode === "landscape") {
    try {
      await screen.orientation?.lock?.("landscape");
    } catch {
      // locking is not supported: layout.js rotates the game instead
    }
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    userLeftFullscreen = true;
    document.exitFullscreen?.();
  } else {
    userLeftFullscreen = false;
    document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
  }
}
fsButton.hidden = !document.fullscreenEnabled || isStandalone();
fsButton.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && world && ["countdown", "racing"].includes(world.state)) {
    userLeftFullscreen = true; // the player left on purpose: don't force them back in
  }
});
window.addEventListener("keydown", (event) => {
  if (replay) {
    if (event.code === "Escape" || event.code === "KeyR" || event.code === "KeyP") {
      event.preventDefault();
      event.stopImmediatePropagation();
      exitReplay();
    }
    return;
  }
  if (photo) {
    if (event.repeat) return;
    if (event.code === "Escape" || event.code === "KeyV" || event.code === "KeyP") {
      event.preventDefault();
      exitPhotoMode();
    } else if (event.code === "KeyS") {
      event.preventDefault();
      savePhoto();
    } else if (event.code === "ArrowLeft" || event.code === "KeyA") {
      event.preventDefault();
      photo.orbit -= 0.12;
    } else if (event.code === "ArrowRight" || event.code === "KeyD") {
      event.preventDefault();
      photo.orbit += 0.12;
    } else if (event.code === "ArrowUp" || event.code === "KeyW" || event.code === "Equal") {
      event.preventDefault();
      photo.zoom = Math.min(2.4, photo.zoom + 0.08);
    } else if (event.code === "ArrowDown" || event.code === "KeyQ" || event.code === "Minus") {
      event.preventDefault();
      photo.zoom = Math.max(0.65, photo.zoom - 0.08);
    }
    event.stopImmediatePropagation();
    return;
  }
  if (event.code === "KeyV" && !event.repeat && !paused) {
    enterPhotoMode();
    return;
  }
  if (event.code === "KeyR" && !event.repeat && !paused && replayBuffer.length >= 20) {
    enterReplay();
    return;
  }
  if (event.code === "KeyF" && !event.repeat && document.fullscreenEnabled) {
    toggleFullscreen();
  }
  if (event.code === "KeyC" && !event.repeat) {
    prefs.camera = prefs.camera === "chase" ? "fixed" : "chase";
    savePrefs();
    applyControls();
  }
});

// A tap during a race re-tries fullscreen (the first tap may have been used for permissions).
window.addEventListener("pointerup", () => {
  if (!photo && !replay && world && ["countdown", "racing"].includes(world.state)) {
    startImmersive();
  }
});
bindInput(touchEl, {
  onPause: () => {
    if (photo) exitPhotoMode();
    else togglePause();
  },
});

// Apply the phone control settings (steering mode, sensitivity, auto-drift).
function applyControls() {
  setControls({ steer: prefs.steer, autoDrift: prefs.autoDrift });
  setTiltOptions({ range: tiltRangeFor(prefs.tiltSens), flip: prefs.flip });
  driftButton.hidden = prefs.autoDrift;
  setForceLandscape(prefs.screenMode === "landscape");
  setPadBindings(prefs.padBindings);
  renderer.setCameraMode(prefs.camera);
  document.body.dataset.steer = prefs.steer === "tilt" ? "tilt" : "buttons";
}
applyControls();
// Android needs no permission; iPhones ask on the first tap (see below).
if (isTouchDevice && prefs.steer === "tilt" && !tiltNeedsPermission()) {
  enableTilt();
}
tiltPrompt.addEventListener("click", async () => {
  await enableTilt();
  tiltPrompt.hidden = true;
  lobbyRefresh();
});

// Browsers only allow sound after a tap or key press.
function unlockAudio() {
  audio.unlock();
  if (isTouchDevice && prefs.steer === "tilt") {
    enableTilt(); // iPhones only allow this from a tap
  }
  window.removeEventListener("pointerdown", unlockAudio);
  window.removeEventListener("keydown", unlockAudio);
}
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);
audio.setMuted(!prefs.sound);
function renderMute() {
  muteButton.textContent = prefs.sound ? "\u{1F50A}" : "\u{1F507}";
}
renderMute();
muteButton.addEventListener("click", () => {
  prefs.sound = !prefs.sound;
  audio.setMuted(!prefs.sound);
  savePrefs();
  renderMute();
});
pauseButton.addEventListener("click", () => togglePause());
photoEl.querySelector('[data-act="photo-exit"]').addEventListener("click", exitPhotoMode);
photoEl.querySelector('[data-act="photo-save"]').addEventListener("click", savePhoto);
replayEl.querySelector('[data-act="replay-exit"]').addEventListener("click", exitReplay);

// drag to orbit the photo camera, wheel to zoom
canvas.addEventListener("pointerdown", (event) => {
  if (!photo) return;
  photo.dragging = true;
  photo.lastX = event.clientX;
  canvas.setPointerCapture?.(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!photo?.dragging) return;
  photo.orbit -= (event.clientX - photo.lastX) * 0.009;
  photo.lastX = event.clientX;
});
canvas.addEventListener("pointerup", () => {
  if (photo) photo.dragging = false;
});
canvas.addEventListener("pointercancel", () => {
  if (photo) photo.dragging = false;
});
window.addEventListener(
  "wheel",
  (event) => {
    if (!photo) return;
    event.preventDefault();
    photo.zoom = Math.max(0.65, Math.min(2.4, photo.zoom - event.deltaY * 0.0012));
  },
  { passive: false },
);

// ---------- world ----------

const trackCache = new Map();
function track(id) {
  if (!trackCache.has(id)) {
    trackCache.set(id, buildTrack(trackById(id)));
  }
  return trackCache.get(id);
}

let world = null;
let netState = online ? "connecting" : "offline";
let netDetail = "";
let session = null;
let me = null;
let remote = null;
let sendTimer = 0;
let resultsEl = null;
let resultsTimer = 0;
let lobbyRefresh = () => {};
let paused = false;
let wrongWay = 0;
let wrongWarned = false;
let installPrompt = null; // the browser's "install app" offer, kept for our button
let justInstalled = false;
let refreshInstall = () => {};
let pauseEl = null;
let tick = 0;
let photo = null;
let replay = null;
let replayBuffer = [];
let replayClock = 0;
let padRemap = null;
let padRemapRender = null;

let lastInput = { gas: false };
let previousHudRank = 0;
let toastText = "";
let toastKind = "boost";
let toastUntil = 0;
function showToast(text, kind = "boost", ms = 1100) {
  toastText = text;
  toastKind = kind;
  toastUntil = performance.now() + ms;
}

function startDemo(trackId) {
  const t = track(trackId);
  const karts = [0, 1, 2].map((i) =>
    makeKart({ id: `d${i}`, name: "", color: KartColors[i + 2], bot: true, skill: 0.78 + i * 0.06 }),
  );
  karts.forEach((kart, i) => placeOnGrid(kart, t, i));
  world = { state: "demo", track: t, karts, laps: 99, raceTime: 0 };
  me = null;
  remote = null;
  renderer.particles.clear();
  renderer.resetCamera();
  renderer.resetMarks(karts);
  countdownEl.hidden = true;
  lightsEl.hidden = true;
  wrongWayEl.hidden = true;
  toastEl.hidden = true;
}

function startRace({ trackId, laps, kartsSpec, mode = "race", weather = prefs.weather, daily = false }) {
  padRemap = null;
  padRemapRender = null;
  replayBuffer = [];
  replayClock = 0;
  hideResults();
  hidePause();
  paused = false;
  resetInput();
  previousHudRank = 0;
  renderer.particles.clear();
  screen.replaceChildren();
  const t = track(trackId);
  const karts = kartsSpec.map((spec) => makeKart(spec));
  karts.forEach((kart, slot) => placeOnGrid(kart, t, slot));
  me = karts.find((kart) => kart.isMe);
  remote = karts.find((kart) => kart.isRemote) ?? null;
  if (remote) {
    remote.target = null;
  }
  const savedGhost = mode === "trial" ? loadGhost(t.def.id) : null;
  const weatherDef = applyWeather(karts, weather);
  world = {
    state: "countdown",
    mode,
    daily,
    track: t,
    karts,
    laps,
    raceTime: 0,
    countdown: CountdownSeconds,
    ghost: savedGhost?.frames ?? null,
    ghostTime: savedGhost?.time ?? 0,
    ghostPos: null,
    lapFrames: [],
    newGhost: false,
    newRecord: false,
    weather: weatherDef,
  };
  sendTimer = 0;
  wrongWay = 0;
  wrongWarned = false;
  renderer.resetMarks(karts);
  renderer.resetCamera();
  hud.root.hidden = false;
  touchEl.hidden = !isTouchDevice;
  showTip();
}

// One-time hint about the new controls, shown during the first countdown.
function showTip() {
  if (prefs.tipSeen) {
    return;
  }
  prefs.tipSeen = true;
  savePrefs();
  let text =
    "Nitro starts at 30%. Hold Space to spend it; it slowly refills when unused. Drift through a corner, then release on the road for a faster refill. Blue pads are separate short boosts.";
  if (isTouchDevice) {
    text = prefs.steer === "tilt"
      ? "Nitro starts at 30%. Hold Nitro to spend it. Turn hard to slide, then straighten on the road to refill faster. Blue pads give a separate short boost."
      : "Nitro starts at 30%. Hold Nitro to spend it. Hold Drift through a turn, then release on the road to refill faster. Blue pads give a separate short boost.";
  }
  tipEl.textContent = text;
  tipEl.hidden = false;
  setTimeout(() => {
    tipEl.hidden = true;
  }, 9000);
}

function botColors(count) {
  const colors = [];
  for (let i = 0; colors.length < count && i < KartColors.length * 2; i += 1) {
    const color = KartColors[(i + 2) % KartColors.length];
    if (color !== prefs.color && !colors.includes(color)) colors.push(color);
  }
  return colors;
}

function startSolo() {
  const skills = BotSkills[prefs.difficulty] ?? BotSkills.normal;
  const colors = botColors(3);
  startRace({
    trackId: prefs.track,
    laps: prefs.laps,
    kartsSpec: [
      { id: "b1", name: "Zip", color: colors[0], bot: true, skill: skills[0] },
      { id: "b2", name: "Bolt", color: colors[1], bot: true, skill: skills[1] },
      { id: "b3", name: "Turbo", color: colors[2], bot: true, skill: skills[2] },
      { id: "me", name: "You", color: prefs.color, livery: prefs.livery, isMe: true },
    ],
  });
}

function startTimeTrial() {
  startRace({
    trackId: prefs.track,
    laps: prefs.laps,
    mode: "trial",
    kartsSpec: [{ id: "me", name: "You", color: prefs.color, livery: prefs.livery, isMe: true }],
  });
}

function startDailyChallenge() {
  const challenge = challengeForDate();
  startRace({
    trackId: challenge.trackId,
    laps: challenge.laps,
    mode: "trial",
    weather: "clear",
    daily: true,
    kartsSpec: [{ id: "me", name: "You", color: prefs.color, livery: prefs.livery, isMe: true }],
  });
}

function startOnlineRace(trackId, laps) {
  const hostKart = { id: "host", name: "Host", color: KartColors[0] };
  const guestKart = { id: "guest", name: "Guest", color: KartColors[1] };
  const mine = online.role === "host" ? hostKart : guestKart;
  const theirs = online.role === "host" ? guestKart : hostKart;
  mine.isMe = true;
  mine.name = "You";
  theirs.isRemote = true;
  theirs.name = "Friend";
  startRace({ trackId, laps, kartsSpec: [hostKart, guestKart], weather: "clear" });
}

// ---------- ranking ----------

function standings() {
  return [...world.karts].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress - a.progress;
  });
}

function ordinal(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

// ---------- per-frame update ----------

function updateRemote(dt, now) {
  const target = remote.target;
  if (!target) return;
  const age = Math.min(0.25, (now - target.t) / 1000);
  const tx = target.x + Math.cos(target.a) * target.v * age;
  const ty = target.y + Math.sin(target.a) * target.v * age;
  const follow = Math.min(1, dt * 14);
  if (Math.hypot(tx - remote.x, ty - remote.y) > 500) {
    remote.x = tx;
    remote.y = ty;
  } else {
    remote.x += (tx - remote.x) * follow;
    remote.y += (ty - remote.y) * follow;
  }
  remote.a += angleDiff(target.a, remote.a) * follow;
  remote.speed = target.v;
  remote.nitroOn = target.nitroOn;
  remote.drifting = target.drifting;
  if (!remote.finished) {
    remote.progress = target.p;
  }
}

function checkFinish(kart) {
  if (!kart.finished && kart.progress >= world.laps * world.track.N) {
    kart.finished = true;
    kart.finishTime = world.raceTime;
    return true;
  }
  return false;
}

// Every time a kart crosses the line, store that lap. The personal best is
// kept in localStorage, so the next race starts with a target to beat.
function noteLap(kart) {
  const N = world.track.N;
  while (kart.lapsDone < world.laps && kart.progress >= (kart.lapsDone + 1) * N) {
    const lapTime = world.raceTime - kart.lapStart;
    kart.lapStart = world.raceTime;
    kart.lapsDone += 1;
    kart.lastLap = lapTime;
    kart.lapTimes.push(lapTime);
    const improved = !kart.bestLap || lapTime < kart.bestLap;
    if (improved) kart.bestLap = lapTime;
    if (kart === me) {
      if (world.mode === "trial") finishGhostLap(lapTime);
      if (improved) notePersonalBest(lapTime);
      else if (world.laps > 1) {
        const final = kart.lapsDone === world.laps - 1;
        showToast(final ? "Final lap!" : `Lap ${kart.lapsDone}/${world.laps}`, "lap", 1200);
      }
    }
  }
}

// A time-trial lap is also a recording: keep it as this track's ghost when it
// is faster than the one already saved.
function finishGhostLap(lapTime) {
  const frames = world.lapFrames;
  if (frames.length > 1) {
    recordGhostFrame(frames, lapTime, me.x, me.y, me.a);
    if (!world.ghostTime || lapTime < world.ghostTime - 0.001) {
      world.ghost = frames;
      world.ghostTime = lapTime;
      world.newGhost = true;
      saveGhost(world.track.def.id, lapTime, frames);
    }
  }
  world.lapFrames = [];
}

function recordTrialPoint() {
  if (!world || world.mode !== "trial" || world.state !== "racing" || !me || me.finished) return;
  recordGhostFrame(
    world.lapFrames,
    Math.max(0, world.raceTime - me.lapStart),
    me.x,
    me.y,
    me.a,
  );
}

function updateGhost() {
  if (!world || world.mode !== "trial") return;
  if (!world.ghost || !me || world.state !== "racing" || me.finished) {
    world.ghostPos = null;
    return;
  }
  const t = Math.max(0, world.raceTime - me.lapStart);
  world.ghostPos = t <= world.ghostTime + 0.25 ? sampleGhost(world.ghost, t) : null;
}

function handleBumpEvents(kart) {
  if (kart.bump > 90) {
    const fx = renderer.particles;
    for (let i = 0; i < 6; i += 1) {
      fx.emit("spark", kart.x, kart.y, rand(320), rand(320), 0.28, 2.5, "#ffd36b");
    }
    if (kart === me) {
      renderer.shake(Math.min(9, kart.bump / 75));
      audio.crash(Math.min(1, kart.bump / 700));
      vibrate(12);
    }
  }
  kart.bump = 0;
}

function notePersonalBest(lapTime) {
  const id = world.track.def.id;
  const record = recordFor(id);
  if (!record || lapTime < record) {
    prefs.records[id] = lapTime;
    savePrefs();
    world.newRecord = true;
    showToast(`Track record  ${formatTime(lapTime)}`, "record", 2200);
    audio.record();
  } else {
    showToast(`Best lap  ${formatTime(lapTime)}`, "good", 1600);
    audio.lap();
  }
}

// A kart pointing against the road (after a spin or while reversing) gets a
// warning rather than silently losing places.
function updateWrongWay(dt, racing) {
  if (!racing || !me || me.finished || me.speed < 70) {
    wrongWay = Math.max(0, wrongWay - dt * 2);
    return;
  }
  const s = world.track.samples[me.lastIdx];
  const forward = me.vx * s.tx + me.vy * s.ty;
  if (forward < -30) {
    wrongWay += dt;
    if (wrongWay > 0.8 && !wrongWarned) {
      wrongWarned = true;
      audio.warn();
    }
  } else {
    wrongWay = Math.max(0, wrongWay - dt * 2.5);
    if (wrongWay === 0) wrongWarned = false;
  }
}

function vibrate(ms) {
  if (prefs.sound && navigator.vibrate) {
    navigator.vibrate(ms);
  }
}

const SmokeColors = ["#f2f2f2", "#d8d8d8"];
const FlameColors = ["#ffd36b", "#ff8a3d", "#7fd1ff"];
const GrassColors = ["#2f7a3a", "#6bbf5a", "#8a6b3a"];
const rand = (spread) => (Math.random() - 0.5) * spread;

// Smoke, flames, grass and sparks for one kart on this physics step.
function emitEffects(kart) {
  const fx = renderer.particles;
  const cos = Math.cos(kart.a);
  const sin = Math.sin(kart.a);
  const rear = 22 * KartScale;
  const rearX = kart.x - cos * rear;
  const rearY = kart.y - sin * rear;

  if (kart.drifting && kart.speed > 180) {
    for (const side of [-1, 1]) {
      fx.emit(
        "smoke",
        rearX - sin * side * 11 * KartScale,
        rearY + cos * side * 11 * KartScale,
        rand(40) - cos * 30,
        rand(40) - sin * 30,
        0.55,
        6,
        SmokeColors[tick % 2],
        26,
      );
    }
  }
  if (kart.nitroOn) {
    fx.emit(
      "flame",
      rearX - cos * 8,
      rearY - sin * 8,
      -cos * 170 + rand(50),
      -sin * 170 + rand(50),
      0.3,
      10,
      FlameColors[tick % 3],
    );
  } else if (kart.boostTimer > 0 && tick % 2 === 0) {
    fx.emit("flame", rearX, rearY, -cos * 90 + rand(40), -sin * 90 + rand(40), 0.22, 6, FlameColors[2]);
  }
  if (kart.drafting && kart.speed > 240 && tick % 3 === 0) {
    // thin white streaks peeling off the front of the kart while it drafts
    for (const side of [-1, 1]) {
      fx.emit(
        "spark",
        kart.x + cos * 26 * KartScale - sin * side * 12 * KartScale,
        kart.y + sin * 26 * KartScale + cos * side * 12 * KartScale,
        -cos * (kart.speed * 0.7) - sin * side * 40,
        -sin * (kart.speed * 0.7) + cos * side * 40,
        0.24,
        2,
        "rgba(255,255,255,0.9)",
      );
    }
  }
  if (kart.offRoad && kart.speed > 140 && tick % 2 === 0) {
    fx.emit(
      "grass",
      rearX,
      rearY,
      rand(120) - cos * 70,
      rand(120) - sin * 70,
      0.45,
      4,
      GrassColors[tick % 3],
    );
  }
}

// Sounds, vibration, sparks and camera shake for things that happened this step.
function handleKartEvents(kart) {
  const mine = kart === me;
  if (kart.hit > 120) {
    const fx = renderer.particles;
    for (let i = 0; i < 6; i += 1) {
      fx.emit("spark", kart.x, kart.y, rand(420), rand(420), 0.35, 3, "#ffd36b");
    }
    if (mine) {
      renderer.shake(Math.min(16, kart.hit / 35));
      audio.crash(kart.hit / 500);
      vibrate(30);
    }
  }
  kart.hit = 0;
  if (kart.padHit) {
    const fx = renderer.particles;
    for (let i = 0; i < 10; i += 1) {
      fx.emit(
        "flame",
        kart.x - Math.cos(kart.a) * 18,
        kart.y - Math.sin(kart.a) * 18,
        rand(260) - Math.cos(kart.a) * 180,
        rand(260) - Math.sin(kart.a) * 180,
        0.35,
        8,
        i % 2 === 0 ? "#9fe4ff" : "#ffffff",
      );
    }
    if (mine) {
      showToast("PAD BOOST · NO FUEL REFILL", "pad", 1200);
      audio.pad();
      vibrate(12);
      renderer.shake(2.5);
    }
    kart.padHit = 0;
  }
  if (kart.driftReward > 0) {
    if (mine) {
      const gain = Math.round((kart.driftNitroReward ?? 0) * 100);
      showToast(gain > 0 ? `DRIFT REFILL +${gain}% NITRO` : "Drift burst!", "boost", 1300);
      audio.boost();
      vibrate(20);
    }
    kart.driftReward = 0;
    kart.driftNitroReward = 0;
  }
  if (mine && kart.nitroOn && !kart.wasNitro) {
    audio.boost();
    vibrate(15);
  }
  kart.wasNitro = kart.nitroOn;
}

const RubberStrength = { easy: 0.5, normal: 1, hard: 1.15 };

function updateRubberBand(karts) {
  const strength = RubberStrength[prefs.difficulty] ?? 1;
  for (const kart of karts) {
    if (!kart.bot || kart.finished || !me) {
      kart.rubber = 1;
      continue;
    }
    kart.rubber = rubberBand(kart, me, world.track.N, strength);
  }
}

function pollPadRemap() {
  if (!padRemap) return;
  const pad = activeGamepad();
  if (!pad) return;
  const down = new Set(gamepadDownButtons(pad));
  if (!padRemap.armed) {
    if (down.size === 0) padRemap.armed = true;
    padRemap.last = down;
    return;
  }
  for (const button of down) {
    if (padRemap.last.has(button)) continue;
    const { action } = padRemap;
    const previous = prefs.padBindings[action];
    prefs.padBindings = normalizePadBindings({ ...prefs.padBindings, [action]: button });
    for (const other of Object.keys(prefs.padBindings)) {
      if (other !== action && prefs.padBindings[other] === button) {
        prefs.padBindings[other] = previous;
      }
    }
    setPadBindings(prefs.padBindings);
    savePrefs();
    padRemap = null;
    padRemapRender?.();
    padRemapRender = null;
    showToast(`Gamepad: ${action} is now ${PadButtonNames[button] ?? `#${button}`}`, "info", 1800);
    return;
  }
  padRemap.last = down;
}

function update(dt, now) {
  if (!world) return;
  const { track: t, karts } = world;
  tick += 1;
  renderer.particles.update(dt);

  if (world.state === "demo") {
    for (const kart of karts) {
      stepKart(kart, botInput(kart, t), dt, t, true, karts);
      if (tick % 3 === 0) emitEffects(kart);
      kart.hit = 0;
      kart.driftReward = 0;
    }
    resolveContacts(karts);
    for (const kart of karts) kart.bump = 0;
    return;
  }

  if (world.state === "countdown") {
    world.countdown -= dt;
    const n = Math.ceil(world.countdown - 0.2);
    if (n !== world.lastCount) {
      world.lastCount = n;
      if (n > 0) audio.countdown(false);
    }
    if (world.countdown <= 0) {
      world.state = "racing";
      world.goFlash = 0.9;
      recenterTilt(); // however you are holding the phone right now is "straight"
      if (isTouchDevice && prefs.steer === "tilt" && !usingTilt()) {
        toastText = "Tilt not available: use the arrows";
        toastUntil = performance.now() + 2500;
      }
      audio.countdown(true);
      setTimeout(() => {
        tipEl.hidden = true;
      }, 4000);
    }
  } else if (world.state === "racing") {
    world.raceTime += dt;
    world.goFlash = Math.max(0, (world.goFlash ?? 0) - dt);
  }

  const racing = world.state === "racing";
  if (world.mode !== "demo") updateRubberBand(karts);
  for (const kart of karts) {
    if (kart.isRemote) {
      updateRemote(dt, now);
      emitEffects(kart);
      continue;
    }
    let input;
    if (kart.isMe && !kart.finished && !(import.meta.env.DEV && window.__kartAuto)) {
      input = readInput(dt);
      lastInput = input;
    } else {
      input = botInput(kart, t);
      if (kart.isMe) {
        input.gas = kart.speed < 330; // coast round after finishing
        input.nitro = false;
        lastInput = input;
      }
    }
    stepKart(kart, input, dt, t, racing || kart.finished, karts);
    emitEffects(kart);
    handleKartEvents(kart);
    if (racing) noteLap(kart);
    if (racing && checkFinish(kart) && kart === me) {
      session?.send({ t: "fin", time: kart.finishTime });
      audio.finish(standings().indexOf(me) === 0);
      showResults();
    }
  }

  resolveContacts(karts);
  for (const kart of karts) handleBumpEvents(kart);
  recordTrialPoint();
  updateGhost();
  rememberReplay(dt);
  updateWrongWay(dt, racing);

  if (session && me && (racing || me.finished)) {
    sendTimer -= dt;
    if (sendTimer <= 0) {
      sendTimer = SendEverySeconds;
      session.send({
        t: "s",
        x: Math.round(me.x),
        y: Math.round(me.y),
        a: Math.round(me.a * 100) / 100,
        v: Math.round(me.speed),
        p: Math.round(me.progress * 10) / 10,
        f: me.finished ? me.finishTime : 0, // repeated, so a lost "fin" message heals itself
        m: (me.nitroOn ? 1 : 0) | (me.drifting ? 2 : 0), // effects: nitro flame, drift smoke
        b: Math.round(me.bestLap * 1000) / 1000, // best lap so far
      });
    }
  }

  if (resultsEl) {
    resultsTimer -= dt;
    if (resultsTimer <= 0) {
      resultsTimer = 0.4;
      fillResults();
    }
  }
}

// ---------- HUD ----------

const lastHud = {};
function setText(key, element, text) {
  if (lastHud[key] !== text) {
    lastHud[key] = text;
    element.textContent = text;
  }
}

function updateHud() {
  if (!world || !me || world.state === "demo") {
    return;
  }
  const lap = Math.max(1, Math.min(world.laps, Math.floor(me.progress / world.track.N) + 1));
  const rank = standings().indexOf(me) + 1;
  if (previousHudRank && rank < previousHudRank && world.mode !== "trial") {
    showToast(`OVERTAKE! ${ordinal(rank)} PLACE`, "good", 950);
  }
  previousHudRank = rank;
  setText("lap", hud.lap, `Lap ${lap}/${world.laps}`);
  setText(
    "pos",
    hud.pos,
    world.mode === "trial" ? "Time trial" : `${ordinal(rank)} of ${world.karts.length}`,
  );
  setText("time", hud.time, formatTime(Math.max(0, world.raceTime)));
  const lapNow = me.finished ? me.lastLap : Math.max(0, world.raceTime - me.lapStart);
  setText("laptime", hud.laptime, `Lap ${formatTime(lapNow)}`);
  setText("best", hud.best, me.bestLap ? `Best ${formatTime(me.bestLap)}` : "Best --:--.---");
  const ghostLine = world.mode === "trial" && world.ghostTime ? `Ghost ${formatTime(world.ghostTime)}` : "";
  hud.ghost.hidden = !ghostLine;
  if (ghostLine) setText("ghost", hud.ghost, ghostLine);
  const weatherName =
    world.weather && world.weather.id !== "clear" ? world.weather.label : "";
  hud.weather.hidden = !weatherName;
  if (weatherName) setText("weather", hud.weather, weatherName);
  setText("speed", hud.speed, `${Math.round(me.speed / 4)} km/h`);
  hud.draft.hidden = !me.drafting;

  const nitroPercent = Math.round(me.nitro * 100);
  const nitroReady = me.nitro > Physics.nitroStartMin;
  hud.nitro.style.width = `${nitroPercent}%`;
  hud.nitro.classList.toggle("on", me.nitroOn);
  hud.nitro.classList.toggle("low", !nitroReady);
  hud.nitroWidget.dataset.state = me.nitroOn
    ? "active"
    : me.boostTimer > 0
      ? "burst"
      : me.drifting
        ? "drifting"
        : nitroReady
          ? "ready"
          : "low";
  setText("nitro-value", hud.nitroValue, `${nitroPercent}%`);
  hud.nitroMeter.setAttribute("aria-valuenow", String(nitroPercent));

  let nitroStatus = "HOLD NITRO TO BOOST";
  if (me.nitroOn) {
    nitroStatus = "BOOSTING · FUEL DRAINING";
  } else if (me.boostTimer > 0 && me.boostSource === "pad") {
    nitroStatus = "BLUE PAD · TEMPORARY BOOST";
  } else if (me.boostTimer > 0 && me.boostSource === "drift") {
    nitroStatus = "DRIFT BURST · NITRO REFILLED";
  } else if (me.drifting) {
    nitroStatus = me.driftTime >= Physics.driftMinTime
      ? "RELEASE ON TRACK · BANK NITRO"
      : "KEEP SLIDING · 0.6S MIN";
  } else if (!nitroReady) {
    nitroStatus = `LOW · NEED MORE THAN ${Math.round(Physics.nitroStartMin * 100)}%`;
  } else if (me.nitro >= 0.99) {
    nitroStatus = "FULL TANK · READY";
  }
  setText("nitro-status", hud.nitroStatus, nitroStatus);
  setText("nitro-button-value", hud.nitroButtonValue, `${nitroPercent}%`);
  hud.nitroButton.dataset.state = me.nitroOn ? "active" : nitroReady ? "ready" : "low";
  hud.nitroButton.setAttribute(
    "aria-label",
    nitroReady
      ? `Nitro boost, ${nitroPercent} percent charged. Hold to use.`
      : `Nitro boost, ${nitroPercent} percent charged. Need more than ${Math.round(Physics.nitroStartMin * 100)} percent to activate.`,
  );

  // live drift read-out, or the last "boost" message
  const nowMs = performance.now();
  if (me.drifting && me.driftTime > 0.25) {
    toastEl.hidden = false;
    toastEl.dataset.kind = me.driftTime >= Physics.driftMinTime ? "good" : "warm";
    setText("toast", toastEl, `Drift ${me.driftTime.toFixed(1)}s`);
  } else if (toastUntil > nowMs) {
    toastEl.hidden = false;
    toastEl.dataset.kind = toastKind;
    setText("toast", toastEl, toastText);
  } else {
    toastEl.hidden = true;
  }

  // phone steering: show the tilt gauge, or the arrows when tilt isn't in use
  const tilting = usingTilt();
  document.body.dataset.steer = tilting ? "tilt" : "buttons";
  tiltGauge.hidden = !tilting;
  if (tilting) {
    tiltGauge.firstElementChild.style.left = `${50 + steerNow() * 50}%`;
  }
  tiltPrompt.hidden = !(
    isTouchDevice &&
    prefs.steer === "tilt" &&
    world.state === "countdown" &&
    tiltSupported() &&
    tiltStatus() === "idle"
  );

  if (world.state === "countdown") {
    const n = Math.ceil(world.countdown - 0.2);
    countdownEl.hidden = false;
    setText("cd", countdownEl, n > 0 ? String(n) : "GO!");
    lightsEl.hidden = false;
    lightsEl.dataset.lit = String(Math.max(0, Math.min(3, n)));
    lightsEl.classList.remove("go");
  } else if ((world.goFlash ?? 0) > 0) {
    countdownEl.hidden = false;
    setText("cd", countdownEl, "GO!");
    lightsEl.hidden = false;
    lightsEl.dataset.lit = "3";
    lightsEl.classList.add("go");
  } else {
    countdownEl.hidden = true;
    lightsEl.hidden = true;
  }

  wrongWayEl.hidden = !(wrongWay > 0.8 && world.state === "racing");

  if (online) {
    netBadge.hidden = false;
    let text = "Friend: connected";
    let level = "ok";
    if (netState !== "connected") {
      text = netState === "away" ? "Friend left the game" : "Reconnecting...";
      level = "bad";
    } else if (session.msSinceFriend() > 3000) {
      text = "Friend: weak connection";
      level = "warn";
    }
    setText("net", netBadge, text);
    netBadge.dataset.level = level;
  }
}

// ---------- screens ----------

function card(html) {
  const element = document.createElement("section");
  element.className = "card";
  element.innerHTML = html;
  return element;
}

function showScreen(element) {
  screen.replaceChildren(element);
}

// "Camera" setting: behind the kart (road ahead is up) or a fixed map.
function cameraGroup() {
  const group = document.createElement("div");
  group.className = "group";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "Camera";
  const holder = document.createElement("div");
  const render = () =>
    holder.replaceChildren(
      choice(
        [{ value: "chase", text: "Behind the kart" }, { value: "fixed", text: "Fixed map" }],
        prefs.camera,
        (value) => {
          prefs.camera = value;
          savePrefs();
          applyControls();
          render();
        },
        "Camera",
      ),
    );
  render();
  group.append(label, holder);
  return group;
}

// A labelled range slider. onInput runs while dragging, onChange when released.
function slider({ min, max, value, label, onInput, onChange }) {
  const row = document.createElement("div");
  row.className = "slider";
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = "1";
  input.value = String(value);
  input.setAttribute("aria-label", label);
  const out = document.createElement("output");
  out.textContent = `${value}/${max}`;
  input.addEventListener("input", () => {
    const next = Number(input.value);
    out.textContent = `${next}/${max}`;
    onInput(next);
  });
  input.addEventListener("change", () => onChange?.(Number(input.value)));
  row.append(input, out);
  return row;
}

const ColorNames = ["Blue", "Red", "Green", "Orange", "Purple", "Teal"];

function swatches(selected, onPick) {
  const row = document.createElement("div");
  row.className = "swatches";
  row.setAttribute("role", "radiogroup");
  row.setAttribute("aria-label", "Kart colour");
  KartColors.forEach((color, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    button.style.background = color;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-label", ColorNames[i] ?? `Colour ${i + 1}`);
    button.setAttribute("aria-checked", String(color === selected));
    button.classList.toggle("active", color === selected);
    button.addEventListener("click", () => onPick(color));
    row.append(button);
  });
  return row;
}

function choice(options, selected, onPick, label) {
  const row = document.createElement("div");
  row.className = "choices";
  row.setAttribute("role", "radiogroup");
  row.setAttribute("aria-label", label);
  options.forEach(({ value, text }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "radio";
    button.textContent = text;
    button.setAttribute("aria-checked", String(value === selected));
    button.classList.toggle("active", value === selected);
    button.addEventListener("click", () => onPick(value));
    row.append(button);
  });
  return row;
}

function showMenu() {
  hud.root.hidden = true;
  touchEl.hidden = true;
  netBadge.hidden = true;
  countdownEl.hidden = true;
  hideResults();
  hidePause();
  paused = false;
  audio.silence();
  startDemo(prefs.track);

  const element = card(`
    <div class="menu-shell">
      <header class="menu-topbar">
        <div class="brand-lockup"><span class="brand-mark">K</span><span class="brand-copy"><small>ARCADE MOTORSPORT</small><strong>KART RACE</strong></span></div>
        <nav class="menu-nav" aria-label="Main navigation">
          <button type="button" class="menu-tab active" data-menu-page="home"><span>01</span> Home</button>
          <button type="button" class="menu-tab" data-menu-page="tracks"><span>02</span> Tracks</button>
          <button type="button" class="menu-tab" data-menu-page="garage"><span>03</span> Garage</button>
          <button type="button" class="menu-tab" data-menu-page="records"><span>04</span> Records</button>
          <button type="button" class="menu-tab" data-menu-page="settings"><span>05</span> Settings</button>
        </nav>
        <div class="menu-top-actions"><span class="menu-online-indicator"><i></i> READY TO RACE</span><button type="button" class="menu-install" data-act="install" hidden>Install app ↗</button></div>
      </header>
      <main class="menu-pages">
        <section class="menu-page active" data-menu-screen="home">
          <div class="home-layout">
            <section class="menu-hero" data-role="menu-hero" data-track="sunny">
              <div class="hero-topline"><span class="eyebrow">YOUR NEXT RACE STARTS HERE</span><span class="hero-season">NO. 001 <b>—</b> OPEN CIRCUIT</span></div>
              <div class="hero-copy">
                <span class="hero-kicker">PUSH YOUR LIMITS</span><h1>READY<br><em>TO RACE?</em></h1>
                <p>Pick your line. Hit the boost. Own the track.</p>
                <div class="hero-selected-track"><span class="track-pin"></span><span data-role="hero-track">Sunny Loop</span><span class="hero-separator">/</span><span data-role="hero-meta">3 LAPS · NORMAL · CLEAR</span></div>
                <button type="button" class="hero-cta" data-act="solo"><span>START RACING</span><b>↗</b></button>
                <div class="hero-secondary-actions">
                  <button type="button" data-act="trial"><span class="action-icon">◷</span><span><strong>TIME TRIAL</strong><small data-role="trial-sub">Set a lap. Chase your ghost.</small></span><b>→</b></button>
                  <button type="button" data-act="online"><span class="action-icon">◎</span><span><strong>RACE A FRIEND</strong><small>Challenge someone online.</small></span><b>→</b></button>
                </div>
              </div>
              <div class="hero-track-stamp"><span>TRACK</span><strong data-role="hero-track-stamp">SUNNY LOOP</strong><i>01 / 03</i></div>
              <div class="hero-bottom-line"><span>ARCADE RACING EXPERIENCE</span><span>DRIFT · BOOST · REPEAT</span></div>
            </section>
            <aside class="home-sidebar">
              <section class="menu-side-card daily-side-card"><div class="side-card-heading"><span class="eyebrow">FRESH EVERY DAY</span><span class="side-live">LIVE</span></div><h2>DAILY<br>CHALLENGE</h2><p>One lap. One target. Make it count.</p><div data-slot="daily"></div></section>
              <section class="menu-side-card track-side-card"><div class="side-card-heading"><span class="eyebrow">CURRENT CIRCUIT</span><span class="side-index">01 / 03</span></div><strong data-role="track-preview-name">Sunny Loop</strong><p data-slot="record" class="record"></p><button type="button" class="text-action" data-menu-page="tracks">EXPLORE TRACKS <b>↗</b></button></section>
              <section class="menu-side-card garage-side-card"><div class="garage-side-mark">✳</div><div><span class="eyebrow">MAKE IT YOURS</span><strong>YOUR KART</strong><small>Colour · livery · identity</small></div><button type="button" class="round-arrow" data-menu-page="garage" aria-label="Open garage">↗</button></section>
            </aside>
          </div>
          <div class="home-footer-stats"><span><b>03</b> UNIQUE TRACKS</span><span><b>06</b> KART COLOURS</span><span><b>∞</b> PERSONAL BESTS TO BEAT</span><span class="profile-progress" data-role="profile-stats">0 / 3 TRACK RECORDS SET</span></div>
        </section>
        <section class="menu-page" data-menu-screen="tracks" hidden>
          <div class="page-heading"><div><span class="eyebrow">CHOOSE YOUR BATTLEFIELD</span><h1>THE TRACKS</h1><p>Every circuit has its own rhythm. Find yours.</p></div><span class="page-index">02 <i>/</i> 05</span></div>
          <div class="tracks-layout">
            <section class="menu-panel track-picker-panel"><div class="panel-heading"><span>01 / SELECT CIRCUIT</span><span>3 CIRCUITS AVAILABLE</span></div><div data-slot="track" class="track-choice-slot"></div><div class="selected-track-record"><span class="eyebrow">YOUR PERSONAL BEST</span><p data-role="track-record-summary">No lap record yet. Set your first time.</p></div></section>
            <section class="menu-panel race-setup-panel"><div class="panel-heading"><span>02 / RACE SETUP</span><span>MAKE IT YOUR RACE</span></div>
              <div class="setup-field"><span class="field-label">LAPS</span><div data-slot="laps"></div></div>
              <div class="setup-field"><span class="field-label">RIVAL DIFFICULTY</span><div data-slot="difficulty"></div></div>
              <div class="setup-field"><span class="field-label">WEATHER CONDITIONS</span><div data-slot="weather"></div></div>
              <div class="setup-note"><span>✦</span><p>Rain reduces grip and top speed. Night racing changes the atmosphere. Choose your conditions before you hit the grid.</p></div>
              <button type="button" class="panel-primary-action" data-act="solo">RACE THIS SETUP <b>↗</b></button>
            </section>
          </div>
        </section>
        <section class="menu-page" data-menu-screen="garage" hidden>
          <div class="page-heading"><div><span class="eyebrow">YOUR MACHINE. YOUR STYLE.</span><h1>THE GARAGE</h1><p>Build a kart that looks as fast as it drives.</p></div><span class="page-index">03 <i>/</i> 05</span></div>
          <div class="garage-layout">
            <section class="garage-showcase"><span class="eyebrow">PLAYER KART · CUSTOM BUILD</span>
              <div class="garage-kart-symbol" data-role="garage-kart" data-livery="stripe">
                <svg viewBox="0 0 420 260" role="img" aria-label="Your kart preview">
                  <ellipse cx="210" cy="143" rx="164" ry="86" fill="rgba(0,0,0,.35)"/>
                  <g fill="#080d15" stroke="rgba(220,235,255,.22)" stroke-width="4">
                    <rect x="71" y="62" width="70" height="52" rx="17"/><rect x="279" y="62" width="70" height="52" rx="17"/>
                    <rect x="71" y="162" width="70" height="52" rx="17"/><rect x="279" y="162" width="70" height="52" rx="17"/>
                  </g>
                  <path d="M210 25 C174 25 157 55 148 82 L118 111 Q104 125 118 146 L144 181 Q155 220 210 229 Q265 220 276 181 L302 146 Q316 125 302 111 L272 82 C263 55 246 25 210 25Z" fill="var(--kart-color,#5d91ef)" stroke="rgba(235,245,255,.8)" stroke-width="5"/>
                  <path d="M174 91 Q210 67 246 91 L258 137 Q210 153 162 137Z" fill="#101a2a" stroke="rgba(230,241,255,.35)" stroke-width="4"/>
                  <path class="kart-stripe kart-stripe-main" d="M203 34 L217 34 L230 86 L210 91 L190 86Z" fill="#f3f7ff" opacity=".92"/>
                  <path class="kart-stripe kart-stripe-side" d="M157 111 L170 108 L184 178 L170 180Z" fill="#f3f7ff" opacity=".8"/>
                  <path d="M181 188 Q210 202 239 188" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="5" stroke-linecap="round"/>
                  <circle cx="210" cy="177" r="12" fill="#0b1422" stroke="rgba(255,255,255,.65)" stroke-width="3"/>
                </svg>
              </div>
              <div class="showcase-caption"><span>YOUR CURRENT BUILD</span><strong data-role="garage-colour-name">BLUE / RACING STRIPE</strong></div>
            </section>
            <section class="menu-panel garage-options"><div class="panel-heading"><span>01 / BODY COLOUR</span><span>6 FINISHES</span></div><div data-slot="color"></div><div class="garage-divider"></div><div class="panel-heading"><span>02 / LIVERY</span><span>3 DESIGNS</span></div><div data-slot="livery"></div><div class="garage-tip"><span>✦</span> Your kart is saved automatically and will be ready on the starting grid.</div><button type="button" class="panel-primary-action" data-menu-page="home">BACK TO HOME <b>↗</b></button></section>
          </div>
        </section>
        <section class="menu-page" data-menu-screen="records" hidden>
          <div class="page-heading"><div><span class="eyebrow">THE CLOCK NEVER LIES</span><h1>YOUR RECORDS</h1><p>Every lap is a new chance to beat your best.</p></div><span class="page-index">04 <i>/</i> 05</span></div>
          <div class="records-summary"><div><span class="eyebrow">TRACKS MASTERED</span><strong data-role="records-count">0/3</strong></div><div><span class="eyebrow">GOLD MEDALS</span><strong data-role="gold-count">0</strong></div><div><span class="eyebrow">PERSONAL BESTS</span><strong data-role="best-count">0</strong></div></div>
          <div class="records-grid" data-slot="records"></div>
        </section>
        <section class="menu-page" data-menu-screen="settings" hidden>
          <div class="page-heading"><div><span class="eyebrow">MAKE YOURSELF COMFORTABLE</span><h1>SETTINGS</h1><p>Fine-tune the way you play.</p></div><span class="page-index">05 <i>/</i> 05</span></div>
          <div class="settings-layout">
            <section class="menu-panel"><div class="panel-heading"><span>CONTROLLER SETUP</span><span>GAMEPAD</span></div><p class="settings-intro">Connect a controller, then select an action and press the button you want to assign.</p><div data-slot="pad"></div></section>
            ${isTouchDevice ? `<section class="menu-panel mobile-settings"><div class="panel-heading"><span>TOUCH & MOTION</span><span>MOBILE</span></div>
              <div class="setup-field"><span class="field-label">STEERING</span><div data-slot="steer"></div></div>
              <div class="setup-field" data-tilt-only><span class="field-label">TILT SENSITIVITY</span><div data-slot="sens"></div></div>
              <div class="setup-field" data-tilt-only><span class="field-label">TILT DIRECTION</span><div data-slot="flip"></div></div>
              <div class="setup-field"><span class="field-label">DRIFT</span><div data-slot="drift"></div></div>
              <div class="setup-field"><span class="field-label">CAMERA</span><div data-slot="camera"></div></div>
              <div class="setup-field"><span class="field-label">SCREEN ORIENTATION</span><div data-slot="screen"></div></div>
              <div class="setup-field"><span class="field-label">FULLSCREEN</span><div data-slot="fullscreen"></div></div>
            </section>` : ""}
            <section class="menu-panel controls-guide"><div class="panel-heading"><span>QUICK CONTROLS</span><span>HOW TO PLAY</span></div>
              <div class="control-guide-row"><kbd>WASD</kbd><span>Steer and accelerate</span></div><div class="control-guide-row"><kbd>SHIFT</kbd><span>Hold while turning to drift</span></div><div class="control-guide-row"><kbd>SPACE</kbd><span>Fire your nitro boost</span></div><div class="control-guide-row"><kbd>P / ESC</kbd><span>Pause the race</span></div><div class="control-guide-row"><kbd>C</kbd><span>Switch camera mode</span></div>
              <p class="settings-intro">A clean drift charges your nitro. Blue pads give you a free boost, and following a rival closely creates a slipstream.</p>
            </section>
          </div>
        </section>
      </main>
      <footer class="menu-footer"><span>KART RACE <i>·</i> BUILT FOR THE NEXT LAP</span><a href="check.html">CONNECTION CHECK ↗</a><span>ARCADE MOTORSPORT SYSTEMS</span></footer>
    </div>
  `);
  element.classList.add("menu-card");
  const activateMenuPage = (page) => {
    element.querySelectorAll("[data-menu-screen]").forEach((section) => {
      const active = section.dataset.menuScreen === page;
      section.hidden = !active;
      section.classList.toggle("active", active);
    });
    element.querySelectorAll("[data-menu-page]").forEach((button) => {
      button.classList.toggle("active", button.dataset.menuPage === page);
      if (button.matches(".menu-tab")) button.setAttribute("aria-current", button.dataset.menuPage === page ? "page" : "false");
    });
    if (page === "records") renderRecords();
  };
  element.querySelectorAll("[data-menu-page]").forEach((button) => {
    button.addEventListener("click", () => activateMenuPage(button.dataset.menuPage));
  });
  const recordLine = element.querySelector('[data-slot="record"]');
  const renderRecord = () => {
    const built = track(prefs.track);
    const best = recordFor(prefs.track);
    recordLine.replaceChildren();
    if (best) {
      const medal = medalForLap(built, best);
      if (medal) recordLine.append(medalChip(medal));
      const text = document.createElement("span");
      text.textContent = `Best lap ${formatTime(best)}`;
      recordLine.append(text);
    } else {
      recordLine.textContent = "No lap record yet: set one!";
    }
    const goal = nextMedal(built, best);
    if (goal) {
      const target = document.createElement("span");
      target.className = "goal";
      target.textContent = `${goal.tier[0].toUpperCase()}${goal.tier.slice(1)} under ${formatTime(goal.time)}`;
      recordLine.append(target);
    }
  };

  const recordsSlot = element.querySelector('[data-slot="records"]');
  const renderRecords = () => {
    if (!recordsSlot) return;
    const rows = Tracks.map((trackDef) => {
      const built = track(trackDef.id);
      const best = recordFor(trackDef.id);
      return { trackDef, best, medal: best ? medalForLap(built, best) : null, next: nextMedal(built, best) };
    });
    const mastered = rows.filter((row) => row.best).length;
    const golds = rows.filter((row) => row.medal === "gold").length;
    element.querySelector('[data-role="records-count"]').textContent = `${mastered}/3`;
    element.querySelector('[data-role="gold-count"]').textContent = String(golds);
    element.querySelector('[data-role="best-count"]').textContent = String(mastered);
    element.querySelector('[data-role="profile-stats"]').textContent = `${mastered} / 3 TRACK RECORDS SET`;
    recordsSlot.replaceChildren(...rows.map(({ trackDef, best, medal, next }, index) => {
      const card = document.createElement("article");
      card.className = `record-track-card track-${trackDef.id}`;
      const top = document.createElement("div"); top.className = "record-track-top";
      const number = document.createElement("span"); number.textContent = `0${index+1}`;
      const badge = document.createElement("span"); badge.className = medal ? `record-medal ${medal}` : "record-medal empty";
      badge.textContent = medal ? medal.toUpperCase() : "NO MEDAL";
      top.append(number,badge);
      const name = document.createElement("h2"); name.textContent = trackDef.name;
      const bestLine = document.createElement("p"); bestLine.className = "record-best-time"; bestLine.textContent = best ? formatTime(best) : "--:--.---";
      const note = document.createElement("p"); note.className = "record-next-goal";
      note.textContent = next ? `NEXT: ${next.tier.toUpperCase()} UNDER ${formatTime(next.time)}` : "GOLD MEDAL EARNED";
      const action = document.createElement("button"); action.type = "button"; action.className = "record-race-action";
      action.textContent = best ? "BEAT THIS TIME ↗" : "SET A RECORD ↗";
      action.addEventListener("click", () => {
        prefs.track = trackDef.id; savePrefs(); startDemo(trackDef.id); activateMenuPage("tracks"); renderChoices();
      });
      card.append(top,name,bestLine,note,action); return card;
    }));
  };

  const dailySlot = element.querySelector('[data-slot="daily"]');
  const renderDaily = () => {
    const challenge = challengeForDate();
    const built = track(challenge.trackId);
    const target = medalTargets(built)[challenge.tier];
    const done = isChallengeDone(challenge.day);
    dailySlot.replaceChildren();
    const button = document.createElement("button");
    button.type = "button";
    button.className = `daily-card${done ? " done" : ""}`;
    button.innerHTML = `<span class="daily-label">Daily challenge${done ? " · done" : ""}</span>
      <strong>${challenge.tier[0].toUpperCase()}${challenge.tier.slice(1)} lap at ${challenge.trackName}</strong>
      <span>${done ? "See you tomorrow" : `Beat ${formatTime(target)} · one lap time trial`}</span>`;
    button.addEventListener("click", () => {
      userLeftFullscreen = false;
      startImmersive();
      startDailyChallenge();
    });
    dailySlot.append(button);
  };
  const padSlot = element.querySelector('[data-slot="pad"]');
  const renderPad = () => {
    if (!padSlot) return;
    const wrap = document.createElement("div");
    wrap.className = "pad-binds";
    const rows = [
      ["gas", "Gas"],
      ["brake", "Brake"],
      ["drift", "Drift"],
      ["nitro", "Nitro"],
    ];
    for (const [action, label] of rows) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pad-bind";
      if (padRemap?.action === action) button.classList.add("active");
      const index = prefs.padBindings[action];
      button.innerHTML = `<span>${label}</span><strong>${
        padRemap?.action === action ? "Press a button…" : PadButtonNames[index] ?? `#${index}`
      }</strong>`;
      button.addEventListener("click", () => {
        if (!gamepadAvailable()) {
          showToast("Connect a controller first", "info", 1800);
          return;
        }
        padRemap = { action, last: new Set(), armed: false };
        padRemapRender = renderPad;
        renderPad();
      });
      wrap.append(button);
    }
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "pad-reset";
    reset.textContent = "Reset buttons";
    reset.addEventListener("click", () => {
      prefs.padBindings = { ...DefaultPadBindings };
      setPadBindings(prefs.padBindings);
      savePrefs();
      padRemap = null;
      padRemapRender = null;
      renderPad();
    });
    wrap.append(reset);
    padSlot.replaceChildren(wrap);
  };

  const renderChoices = () => {
    renderPad();
    element.querySelector('[data-slot="track"]').replaceChildren(
      choice(
        Tracks.map((tr) => ({ value: tr.id, text: tr.name })),
        prefs.track,
        (value) => {
          prefs.track = value;
          savePrefs();
          startDemo(value);
          renderChoices();
        },
        "Track",
      ),
    );
    renderRecord();
    renderDaily();
    element.querySelector('[data-slot="laps"]').replaceChildren(
      choice(
        LapOptions.map((n) => ({ value: n, text: String(n) })),
        prefs.laps,
        (value) => {
          prefs.laps = value;
          savePrefs();
          renderChoices();
        },
        "Laps",
      ),
    );
    element.querySelector('[data-slot="difficulty"]').replaceChildren(
      choice(
        [
          { value: "easy", text: "Easy" },
          { value: "normal", text: "Normal" },
          { value: "hard", text: "Hard" },
        ],
        prefs.difficulty,
        (value) => {
          prefs.difficulty = value;
          savePrefs();
          renderChoices();
        },
        "Rival difficulty",
      ),
    );
    element.querySelector('[data-slot="weather"]').replaceChildren(
      choice(
        WeatherOptions.map((w) => ({ value: w.id, text: w.label })),
        prefs.weather,
        (value) => {
          prefs.weather = value;
          savePrefs();
          renderChoices();
        },
        "Weather",
      ),
    );
    element.querySelector('[data-slot="color"]').replaceChildren(
      swatches(prefs.color, (value) => {
        prefs.color = value;
        savePrefs();
        renderChoices();
      }),
    );
    element.querySelector('[data-slot="livery"]').replaceChildren(
      choice(
        [
          { value: "stripe", text: "Racing stripe" },
          { value: "twin", text: "Twin stripes" },
          { value: "clean", text: "Clean" },
        ],
        prefs.livery,
        (value) => {
          prefs.livery = value;
          savePrefs();
          renderChoices();
        },
        "Livery",
      ),
    );
    const ghost = loadGhost(prefs.track);
    element.querySelector('[data-role="trial-sub"]').textContent = ghost
      ? `Race your ghost · ${formatTime(ghost.time)}`
      : "No rivals. Set a lap to make a ghost.";
    const selectedTrack = trackById(prefs.track);
    element.querySelector('[data-role="hero-track"]').textContent = selectedTrack.name;
    element.querySelector('[data-role="hero-track-stamp"]').textContent = selectedTrack.name.toUpperCase();
    element.querySelector('[data-role="track-preview-name"]').textContent = selectedTrack.name;
    element.querySelector('[data-role="menu-hero"]').dataset.track = selectedTrack.id;
    element.querySelector('[data-role="hero-meta"]').textContent = `${prefs.laps} LAPS · ${prefs.difficulty.toUpperCase()} · ${WeatherOptions.find((item) => item.id === prefs.weather)?.label.toUpperCase() ?? "CLEAR"}`;
    const best = recordFor(prefs.track);
    element.querySelector('[data-role="track-record-summary"]').textContent = best
      ? `${formatTime(best)} · ${medalForLap(track(prefs.track), best)?.toUpperCase() ?? "PERSONAL BEST"}`
      : "No lap record yet. Set your first time.";
    element.querySelector('[data-role="garage-colour-name"]').textContent = `${ColorNames[KartColors.indexOf(prefs.color)] ?? "CUSTOM"} / ${prefs.livery.toUpperCase()}`;
    const garageKart = element.querySelector('[data-role="garage-kart"]');
    garageKart.style.setProperty("--kart-color", prefs.color);
    garageKart.dataset.livery = prefs.livery;
    renderRecords();
  };
  renderChoices();
  if (isTouchDevice) {
    const renderControls = () => {
      const set = (key, value) => {
        prefs[key] = value;
        savePrefs();
        applyControls();
        if (prefs.steer === "tilt") enableTilt();
        renderControls();
      };
      element.querySelector('[data-slot="steer"]').replaceChildren(
        choice(
          [{ value: "tilt", text: "Tilt" }, { value: "buttons", text: "Arrows" }],
          prefs.steer,
          (value) => set("steer", value),
          "Steering",
        ),
      );
      element.querySelector('[data-slot="sens"]').replaceChildren(
        slider({
          min: SensMin,
          max: SensMax,
          value: prefs.tiltSens,
          label: "Tilt sensitivity",
          onInput: (value) => {
            prefs.tiltSens = value;
            applyControls();
          },
          onChange: savePrefs,
        }),
      );
      element.querySelector('[data-slot="flip"]').replaceChildren(
        choice(
          [{ value: false, text: "Normal" }, { value: true, text: "Flipped" }],
          prefs.flip,
          (value) => set("flip", value),
          "Tilt direction",
        ),
      );
      element.querySelector('[data-slot="drift"]').replaceChildren(
        choice(
          [{ value: true, text: "Automatic" }, { value: false, text: "Button" }],
          prefs.autoDrift,
          (value) => set("autoDrift", value),
          "Drift",
        ),
      );
      element.querySelector('[data-slot="camera"]').replaceChildren(
        choice(
          [{ value: "chase", text: "Behind the kart" }, { value: "fixed", text: "Fixed map" }],
          prefs.camera,
          (value) => set("camera", value),
          "Camera",
        ),
      );
      element.querySelector('[data-slot="screen"]').replaceChildren(
        choice(
          [{ value: "auto", text: "As the phone is" }, { value: "landscape", text: "Landscape" }],
          prefs.screenMode,
          (value) => {
            set("screenMode", value);
            startImmersive();
          },
          "Screen",
        ),
      );
      element.querySelector('[data-slot="fullscreen"]').replaceChildren(
        choice(
          [{ value: true, text: "On" }, { value: false, text: "Off" }],
          prefs.fullscreen,
          (value) => {
            set("fullscreen", value);
            if (value) {
              userLeftFullscreen = false;
              startImmersive();
            } else if (document.fullscreenElement) {
              document.exitFullscreen?.();
            }
          },
          "Fullscreen",
        ),
      );
      element.querySelectorAll("[data-tilt-only]").forEach((row) => {
        row.hidden = prefs.steer !== "tilt";
      });
    };
    renderControls();
  }
  const installButton = element.querySelector('[data-act="install"]');
  refreshInstall = () => {
    installButton.hidden = isStandalone() || justInstalled;
  };
  refreshInstall();
  installButton.addEventListener("click", installApp);
  element.querySelectorAll('[data-act="solo"]').forEach((button) => {
    button.addEventListener("click", () => {
      if (isTouchDevice && prefs.steer === "tilt") enableTilt();
      userLeftFullscreen = false;
      startImmersive();
      startSolo();
    });
  });
  element.querySelector('[data-act="trial"]').addEventListener("click", () => {
    if (isTouchDevice && prefs.steer === "tilt") enableTilt();
    userLeftFullscreen = false;
    startImmersive();
    startTimeTrial();
  });
  element.querySelector('[data-act="online"]').addEventListener("click", () => {
    window.location.href = `${window.location.pathname}?online=host&laps=${prefs.laps}&track=${prefs.track}`;
  });
  showScreen(element);
}

function inviteUrl() {
  return `${window.location.origin}${window.location.pathname}?room=${session.roomId}`;
}

const netText = {
  waiting: "Waiting for your friend to join...",
  connecting: "Connecting...",
  connected: "Friend connected",
  away: "Your friend left. Waiting for them to come back...",
  reconnecting: "Connection lost. Reconnecting...",
};

function showLobby() {
  hud.root.hidden = true;
  touchEl.hidden = true;
  netBadge.hidden = true;
  countdownEl.hidden = true;
  const isHost = online.role === "host";
  startDemo(prefs.track);

  const element = card(`
    <h1>${isHost ? "Invite a friend" : "Joining a race"}</h1>
    <p class="sub" data-role="info"></p>
    <p class="status" data-role="status"></p>
    <div class="tilt-row" data-role="tilt" hidden>
      <span></span>
      <button type="button">Turn on tilt steering</button>
    </div>
    <div class="invite" data-role="invite" hidden>
      <input type="text" readonly aria-label="Invite link">
      <button type="button" data-role="copy">Copy link</button>
      <button type="button" data-role="share" hidden>Share</button>
    </div>
    <button type="button" class="big primary" data-act="start" hidden><strong>Start race</strong><span>Both players are ready</span></button>
    <a class="footer" data-role="menu">&larr; Menu</a>
  `);
  element.querySelector('[data-role="menu"]').href = window.location.pathname;
  const status = element.querySelector('[data-role="status"]');
  const info = element.querySelector('[data-role="info"]');
  const invite = element.querySelector('[data-role="invite"]');
  const input = invite.querySelector("input");
  const startButton = element.querySelector('[data-act="start"]');

  const tiltRow = element.querySelector('[data-role="tilt"]');
  tiltRow.querySelector("button").addEventListener("click", async () => {
    await enableTilt();
    lobbyRefresh();
  });
  lobbyRefresh = () => {
    // phone: say whether tilt steering is ready (iPhones need a tap to allow it)
    const wantsTilt = isTouchDevice && prefs.steer === "tilt";
    tiltRow.hidden = !wantsTilt;
    if (wantsTilt) {
      const status = tiltStatus();
      const ready = status === "granted";
      const unavailable = status === "unsupported" || !tiltSupported();
      tiltRow.querySelector("span").textContent = ready
        ? "Tilt steering is ready"
        : unavailable
          ? "No motion sensor: you will steer with the arrows"
          : status === "denied"
            ? "Tilt was blocked: you will steer with the arrows"
            : "Tilt steering needs your OK";
      tiltRow.querySelector("button").hidden = ready || unavailable || status === "denied";
    }
    status.textContent = netState === "error" ? netDetail || "Connection problem." : netText[netState] ?? "";
    status.dataset.state = netState;
    info.textContent = isHost
      ? `${trackById(prefs.track).name} · ${prefs.laps} lap${prefs.laps > 1 ? "s" : ""} · Room ${session?.roomId ?? ""}`
      : "The host picks the track and starts the race.";
    invite.hidden = !(isHost && (netState === "waiting" || netState === "away"));
    startButton.hidden = !(isHost && netState === "connected");
    if (session && isHost) {
      input.value = inviteUrl();
    }
  };

  const copy = invite.querySelector('[data-role="copy"]');
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(input.value);
      copy.textContent = "Copied!";
      setTimeout(() => {
        copy.textContent = "Copy link";
      }, 1800);
    } catch {
      input.select();
    }
  });
  input.addEventListener("focus", () => input.select());
  if (navigator.share) {
    const share = invite.querySelector('[data-role="share"]');
    share.hidden = false;
    share.addEventListener("click", () => {
      navigator.share({ title: "Kart Race", url: input.value }).catch(() => {});
    });
  }
  startButton.addEventListener("click", () => {
    if (isTouchDevice && prefs.steer === "tilt") enableTilt();
    userLeftFullscreen = false;
    startImmersive();
    hostStartsRace();
  });

  showScreen(element);
  lobbyRefresh();
}

// The "go" message is repeated until the friend confirms it, so a message that
// gets lost on the way can never leave them stuck in the lobby.
let currentRaceId = 0;
let goAcked = 0;
let goTimer = null;

function hostStartsRace() {
  if (online?.role !== "host" || netState !== "connected") {
    return;
  }
  const message = { t: "go", id: Date.now(), track: prefs.track, laps: prefs.laps };
  currentRaceId = message.id;
  startOnlineRace(prefs.track, prefs.laps);
  clearInterval(goTimer);
  let tries = 0;
  session.send(message);
  goTimer = setInterval(() => {
    tries += 1;
    if (goAcked === message.id || tries > 12) {
      clearInterval(goTimer);
      return;
    }
    session.send(message);
  }, 700);
}

// ---------- pause ----------

function hidePause() {
  pauseEl?.remove();
  pauseEl = null;
}

function rememberReplay(dt) {
  if (!world || world.mode === "demo" || online || world.state !== "racing") return;
  replayClock += dt;
  if (replayClock < 1 / 20) return;
  replayClock = 0;
  replayBuffer.push({
    t: world.raceTime,
    karts: world.karts.map((kart) => ({
      x: kart.x,
      y: kart.y,
      a: kart.a,
      color: kart.color,
      livery: kart.livery,
      name: kart.name,
      speed: kart.speed,
      drifting: kart.drifting,
      nitroOn: kart.nitroOn,
      boostTimer: kart.boostTimer,
      isMe: kart.isMe,
    })),
  });
  if (replayBuffer.length > 240) replayBuffer.shift();
}

function sampleReplay(time) {
  const frames = replay.frames;
  let i = 0;
  while (i < frames.length - 2 && frames[i + 1].t <= time) i += 1;
  const a = frames[i];
  const b = frames[Math.min(frames.length - 1, i + 1)];
  const span = b.t - a.t || 1;
  const f = Math.max(0, Math.min(1, (time - a.t) / span));
  return a.karts.map((kart, index) => {
    const next = b.karts[index] ?? kart;
    return {
      ...kart,
      x: kart.x + (next.x - kart.x) * f,
      y: kart.y + (next.y - kart.y) * f,
      a: kart.a + angleDiff(next.a, kart.a) * f,
    };
  });
}

function enterReplay() {
  if (
    replay ||
    photo ||
    online ||
    !world ||
    world.state !== "racing" ||
    replayBuffer.length < 20
  ) {
    return;
  }
  hidePause();
  paused = true;
  const first = replayBuffer[0].t;
  replay = {
    frames: replayBuffer,
    time: 0,
    start: first,
    duration: Math.max(0.5, replayBuffer[replayBuffer.length - 1].t - first),
    orbit: 0,
  };
  document.body.classList.add("replay-mode");
  replayEl.hidden = false;
  resetInput();
  audio.silence();
  renderer.resetCamera();
}

function exitReplay() {
  if (!replay) return;
  replay = null;
  paused = false;
  document.body.classList.remove("replay-mode");
  replayEl.hidden = true;
  resetInput();
  renderer.resetCamera();
}

function drawReplay(dt) {
  replay.time += dt;
  if (replay.time > replay.duration) replay.time = 0;
  replay.orbit += dt * 0.12;
  const time = replay.start + replay.time;
  const karts = sampleReplay(time);
  const meReplay = karts.find((kart) => kart.isMe) ?? karts[0];
  renderer.draw(
    {
      track: world.track,
      karts,
      me: meReplay,
      ghost: null,
      weather: world.weather,
      photo: { orbit: replay.orbit, zoom: 1.12 },
    },
    dt,
  );
  const fill = replayEl.querySelector("i");
  if (fill) fill.style.width = `${Math.min(100, (replay.time / replay.duration) * 100)}%`;
}

function enterPhotoMode() {
  if (
    photo ||
    online ||
    !world ||
    !["racing", "countdown"].includes(world.state) ||
    resultsEl
  ) {
    return;
  }
  hidePause();
  paused = true;
  photo = { orbit: 0, zoom: 1.35, dragging: false, lastX: 0 };
  resetInput();
  audio.silence();
  document.body.classList.add("photo-mode");
  photoEl.hidden = false;
}

function exitPhotoMode() {
  if (!photo) return;
  photo = null;
  paused = false;
  document.body.classList.remove("photo-mode");
  photoEl.hidden = true;
  resetInput();
}

function savePhoto() {
  if (!photo) return;
  const url = renderer.snapshot();
  if (!url) return;
  const link = document.createElement("a");
  link.href = url;
  link.download = `kart-photo-${Date.now()}.png`;
  document.body.append(link);
  link.click();
  link.remove();
}

function showPause() {
  if (pauseEl || resultsEl || !world || !["racing", "countdown"].includes(world.state)) {
    return;
  }
  const solo = !online;
  const lap = Math.max(1, Math.min(world.laps, Math.floor(me?.progress / world.track.N) + 1));
  const place = me ? standings().indexOf(me) + 1 : 1;
  const sessionLabel = world.mode === "trial" ? "TIME TRIAL" : solo ? "QUICK RACE" : "ONLINE RACE";
  const progressLabel = world.mode === "trial" ? `LAP ${lap}` : `P${place} · LAP ${lap}/${world.laps}`;
  const panel = card(`
    <div class="pause-topline"><span>RACE CONTROL</span><span class="pause-status">${solo ? "PAUSED" : "LIVE SESSION"}</span></div>
    <h1>${solo ? "Take a breather." : "Race menu."}</h1>
    <p class="pause-sub">${solo ? "Your race is safely paused. Jump back in when you're ready." : "Your rival keeps moving while this menu is open."}</p>
    <div class="pause-context">
      <div><small>CIRCUIT</small><strong>${world.track.def.name}</strong></div>
      <div><small>SESSION</small><strong>${sessionLabel}</strong></div>
      <div><small>PROGRESS</small><strong>${progressLabel}</strong></div>
    </div>
    <button type="button" class="big primary pause-resume" data-act="resume"><strong>RESUME RACE</strong><span>Back to the track <b>↗</b></span></button>
    <div class="pause-action-grid">
      ${solo && replayBuffer.length >= 20 ? `<button type="button" class="big pause-action" data-act="replay"><strong>Replay last 10 s</strong><span>Watch the action again</span></button>` : ""}
      ${solo ? `<button type="button" class="big pause-action" data-act="photo"><strong>Photo mode</strong><span>Capture your best angle</span></button>` : ""}
      ${solo ? `<button type="button" class="big pause-action" data-act="restart"><strong>Restart ${world.mode === "trial" ? "time trial" : "race"}</strong><span>Start this session over</span></button>` : ""}
      ${usingTilt() ? `<button type="button" class="big pause-action" data-act="recenter"><strong>Recenter tilt</strong><span>Reset your phone position</span></button>` : ""}
    </div>
    <div class="pause-adjustments"><span class="pause-adjust-label">QUICK SETTINGS</span></div>
    <a class="pause-quit" data-role="menu">${solo ? "Quit to menu" : "Leave race"} <b>↗</b></a>
  `);
  panel.classList.add("pause-card");
  panel.querySelector('[data-role="menu"]').href = window.location.pathname;

  const adjustments = panel.querySelector(".pause-adjustments");
  if (isTouchDevice && prefs.steer === "tilt") {
    const group = document.createElement("div");
    group.className = "group pause-setting-group";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = "Tilt sensitivity";
    group.append(
      label,
      slider({
        min: SensMin,
        max: SensMax,
        value: prefs.tiltSens,
        label: "Tilt sensitivity",
        onInput: (value) => {
          prefs.tiltSens = value;
          applyControls();
        },
        onChange: savePrefs,
      }),
    );
    adjustments.append(group);
  }
  const camera = cameraGroup();
  camera.classList.add("pause-setting-group");
  adjustments.append(camera);

  panel.querySelector('[data-act="resume"]').addEventListener("click", () => togglePause());
  panel.querySelector('[data-act="recenter"]')?.addEventListener("click", () => {
    recenterTilt();
    togglePause();
  });
  panel.querySelector('[data-act="replay"]')?.addEventListener("click", enterReplay);
  panel.querySelector('[data-act="photo"]')?.addEventListener("click", enterPhotoMode);
  panel.querySelector('[data-act="restart"]')?.addEventListener("click", () => {
    if (world?.mode === "trial") {
      if (world.daily) startDailyChallenge();
      else startTimeTrial();
    } else {
      startSolo();
    }
  });
  const wrap = document.createElement("div");
  wrap.className = "overlay pause-overlay";
  wrap.append(panel);
  screen.append(wrap);
  pauseEl = wrap;
}

function togglePause() {
  if (photo) {
    exitPhotoMode();
    return;
  }
  if (replay) {
    exitReplay();
    return;
  }
  if (pauseEl) {
    hidePause();
    paused = false;
    return;
  }
  if (!world || !["racing", "countdown"].includes(world.state) || resultsEl) {
    return;
  }
  showPause();
  if (pauseEl && !online) {
    paused = true; // online races can't be frozen: the friend keeps driving
    audio.silence();
    resetInput();
  }
}

// A solo race should not run on while the tab is hidden.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && !online && !paused) {
    togglePause();
  }
});

// ---------- results ----------

function hideResults() {
  resultsEl?.remove();
  resultsEl = null;
}

function showResults() {
  if (resultsEl) return;
  hidePause();
  paused = false;
  const trial = world?.mode === "trial";
  const panel = card(`
    <h1 data-role="title"></h1>
    <p class="results-sub" data-role="bestlap"></p>
    <ol class="results" data-role="rows"></ol>
    <div class="row-buttons">
      <button type="button" class="big primary" data-act="again"></button>
      <a class="big" data-role="menu">Menu</a>
    </div>
    <p class="hint" data-role="note"></p>
  `);
  panel.classList.add("results-card");
  panel.querySelector('[data-role="menu"]').href = window.location.pathname;
  const again = panel.querySelector('[data-act="again"]');
  if (online && online.role === "guest") {
    again.disabled = true;
    again.textContent = "Waiting for host";
    panel.querySelector('[data-role="note"]').textContent = "The host can start a rematch.";
  } else {
    again.textContent = trial ? "Try again" : online ? "Rematch" : "Race again";
    panel.querySelector('[data-role="note"]').textContent = trial
      ? world.daily
        ? "The daily challenge is counted for today; Try again keeps the same challenge."
        : "Beat the ghost and it is saved on this track."
      : "";
    again.addEventListener("click", () => {
      if (online) {
        hostStartsRace();
      } else if (trial) {
        if (world.daily) startDailyChallenge();
        else startTimeTrial();
      } else {
        startSolo();
      }
    });
  }
  const wrap = document.createElement("div");
  wrap.className = "overlay";
  wrap.append(panel);
  screen.replaceChildren(wrap);
  resultsEl = wrap;
  resultsTimer = 0;
  fillResults();
}

function fillResults() {
  if (!resultsEl || !world || !me) return;
  const order = standings();
  const place = order.indexOf(me) + 1;
  const done = order.every((kart) => kart.finished);
  const trial = world.mode === "trial";
  const title = resultsEl.querySelector('[data-role="title"]');
  title.textContent = trial
    ? me.bestLap
      ? `Best lap ${formatTime(me.bestLap)}`
      : "Time trial"
    : place === 1
      ? done
        ? "You won!"
        : "You finished 1st!"
      : `You finished ${ordinal(place)}`;
  const recordLine = resultsEl.querySelector('[data-role="bestlap"]');
  recordLine.replaceChildren();
  if (me.bestLap) {
    const best = document.createElement("span");
    best.textContent = `Your best lap ${formatTime(me.bestLap)}`;
    recordLine.append(best);
    const medal = medalForLap(world.track, me.bestLap);
    if (medal) recordLine.append(medalChip(medal));
  }
  if (world.newRecord) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "New track record";
    recordLine.append(badge);
  }
  if (world.newGhost) {
    const badge = document.createElement("span");
    badge.className = "badge ghost";
    badge.textContent = "New ghost saved";
    recordLine.append(badge);
  }
  const challenge = challengeForDate();
  const tierRank = { bronze: 1, silver: 2, gold: 3 };
  const earned = me.bestLap ? medalForLap(world.track, me.bestLap) : null;
  const challengeEarned =
    !online &&
    challenge.trackId === world.track.def.id &&
    earned &&
    tierRank[earned] >= tierRank[challenge.tier];
  if (challengeEarned) {
    markChallengeDone(challenge.day);
    if (isChallengeDone(challenge.day)) {
      const badge = document.createElement("span");
      badge.className = "badge daily-done";
      badge.textContent = "Daily challenge complete";
      recordLine.append(badge);
    }
  }
  const rows = resultsEl.querySelector('[data-role="rows"]');
  rows.replaceChildren(
    ...order.map((kart, i) => {
      const li = document.createElement("li");
      if (kart === me) li.className = "me";
      const dot = document.createElement("i");
      dot.style.background = kart.color;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = trial ? kart.name : `${i + 1}. ${kart.name}`;
      const lap = document.createElement("span");
      lap.className = "lap";
      lap.textContent = kart.bestLap ? formatTime(kart.bestLap) : "--:--.---";
      lap.title = "Best lap";
      const time = document.createElement("span");
      time.className = "time";
      time.textContent = kart.finished ? formatTime(kart.finishTime) : "racing...";
      li.append(dot, name, lap, time);
      return li;
    }),
  );
}

// ---------- online wiring ----------

function handleMessage(message) {
  if (message.t === "go" && online?.role === "guest") {
    session.send({ t: "goack", id: message.id });
    if (message.id !== currentRaceId) {
      currentRaceId = message.id;
      const id = trackById(message.track).id;
      const laps = LapOptions.includes(message.laps) ? message.laps : 3;
      prefs.track = id;
      prefs.laps = laps;
      startOnlineRace(id, laps);
    }
  } else if (message.t === "goack") {
    goAcked = message.id;
  } else if (message.t === "s" && remote && world?.state !== "demo") {
    if ([message.x, message.y, message.a, message.v, message.p].every(Number.isFinite)) {
      remote.target = {
        x: message.x,
        y: message.y,
        a: message.a,
        v: message.v,
        p: message.p,
        nitroOn: (message.m & 1) === 1,
        drifting: (message.m & 2) === 2,
        bestLap: Number.isFinite(message.b) ? message.b : 0,
        t: performance.now(),
      };
      if (!remote.seen) {
        remote.seen = true;
        remote.x = message.x;
        remote.y = message.y;
        remote.a = message.a;
      }
      if (message.f > 0 && !remote.finished) {
        remote.finished = true;
        remote.finishTime = message.f;
      }
      if (Number.isFinite(message.b) && message.b > 0) {
        remote.bestLap = message.b;
      }
    }
  } else if (message.t === "fin" && remote && Number.isFinite(message.time)) {
    remote.finished = true;
    remote.finishTime = message.time;
  }
}

if (online) {
  let roomId = online.room ?? createRoomId();
  if (online.role === "host") {
    window.history.replaceState(
      null,
      "",
      `?online=host&id=${roomId}&laps=${prefs.laps}&track=${prefs.track}`,
    );
  }
  session = createOnlineSession({
    role: online.role,
    roomId,
    onStatus(state, detail) {
      netState = state;
      netDetail = detail;
      lobbyRefresh();
    },
    onOpen() {},
    onMessage: handleMessage,
    onRoomChange(next) {
      roomId = next;
      window.history.replaceState(
        null,
        "",
        `?online=host&id=${next}&laps=${prefs.laps}&track=${prefs.track}`,
      );
      lobbyRefresh();
    },
  });
  showLobby();
} else {
  showMenu();
}

// ---------- install (PWA) ----------

const isIOS =
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault(); // keep it for our own button
  installPrompt = event;
  refreshInstall();
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  justInstalled = true;
  refreshInstall();
});

async function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    refreshInstall();
    return;
  }
  // No install prompt available (iPhone Safari, or the browser hasn't offered it yet).
  const steps = isIOS
    ? "<li>Tap the <strong>Share</strong> button in Safari (the square with an arrow).</li><li>Choose <strong>Add to Home Screen</strong>.</li><li>Open <strong>Kart Race</strong> from your home screen: it runs fullscreen.</li>"
    : "<li>Open the browser menu (the three dots).</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li><li>Open <strong>Kart Race</strong> from your home screen: it runs fullscreen.</li>";
  const panel = card(`
    <h1>Install the app</h1>
    <ol class="steps">${steps}</ol>
    <button type="button" class="big primary" data-act="close"><strong>Got it</strong></button>
  `);
  const wrap = document.createElement("div");
  wrap.className = "overlay";
  wrap.append(panel);
  panel.querySelector('[data-act="close"]').addEventListener("click", () => wrap.remove());
  screen.append(wrap);
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// ---------- main loop ----------

let last = performance.now();
let accumulator = 0;
let frameAverage = 1 / 60;
let slowFrames = 0;
let lowQuality = false;

function updateAudio() {
  if (!world || !me || paused || world.state === "demo") {
    audio.silence();
    return;
  }
  const counting = world.state === "countdown";
  audio.engine({
    speed01: me.speed / Physics.maxSpeed,
    throttle: counting ? 0.15 : lastInput.gas || me.nitroOn ? 1 : 0.2,
    nitro: me.nitroOn,
    drifting: me.drifting,
    offRoad: me.offRoad,
  });
}

function frame(now) {
  const frameDt = Math.min(0.1, (now - last) / 1000);
  last = now;

  pollPadRemap();

  if (replay) {
    drawReplay(frameDt);
    requestAnimationFrame(frame);
    return;
  }

  // Start on a gamepad opens/closes the pause menu, just like P.
  if (gamepadPausePressed()) togglePause();

  // The physics always advances in equal slices, whatever the screen's frame rate.
  if (!paused) {
    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= FixedStep && steps < 6) {
      update(FixedStep, now);
      accumulator -= FixedStep;
      steps += 1;
    }
    if (steps === 6) {
      accumulator = 0; // too far behind (slow phone): drop the backlog
    }
  }
  updateHud();
  updateAudio();
  if (world) {
    renderer.draw(
      {
        track: world.track,
        karts: world.karts,
        me,
        ghost: world.ghostPos,
        weather: world.weather,
        photo,
        showStartMarker: world.state === "countdown" || (world.goFlash ?? 0) > 0,
      },
      paused && !photo ? 0 : frameDt,
    );
  }

  // Slow device? Draw at a lower resolution instead of stuttering.
  frameAverage += (frameDt - frameAverage) * 0.05;
  if (!lowQuality && !paused && world?.state === "racing" && frameAverage > 1 / 38) {
    slowFrames += 1;
    if (slowFrames > 120) {
      lowQuality = true;
      renderer.setMaxDpr(1);
    }
  } else {
    slowFrames = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener("pagehide", () => session?.destroy());

if (import.meta.env.DEV) {
  // Development only: lets automated checks inspect the race and drive the kart.
  window.__kart = {
    get world() {
      return world;
    },
    get me() {
      return me;
    },
    get remote() {
      return remote;
    },
    // advance the simulation without waiting for animation frames
    step(dt = FixedStep, now = performance.now()) {
      const count = Math.max(1, Math.round(dt / FixedStep));
      for (let i = 0; i < count; i += 1) {
        update(FixedStep, now);
      }
      updateHud();
    },
  };
}
