import "./styles.css";
import { Tracks, buildTrack, trackById } from "./track.js";
import {
  FixedStep,
  KartColors,
  Physics,
  angleDiff,
  botInput,
  formatTime,
  makeKart,
  placeOnGrid,
  stepKart,
} from "./game.js";
import { createRenderer } from "./render.js";
import { bindInput, isTouchDevice, readInput, resetInput } from "./input.js";
import { audio } from "./audio.js";
import { createOnlineSession, createRoomId } from "./online.js";

const LapOptions = [1, 3, 5];
const CountdownSeconds = 3.2;
const SendEverySeconds = 0.05;

// ---------- settings from the address bar ----------

const params = new URLSearchParams(window.location.search);
const RoomPattern = /^\d{4}$/;

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
    tutorialSeen: saved.tutorialSeen === true,
  };
}
const prefs = readPrefs();
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
      <div class="hud-box"><span id="lap"></span><span id="pos"></span></div>
      <div class="hud-buttons">
        <button type="button" id="pause-btn" aria-label="Pause">&#10074;&#10074;</button>
        <button type="button" id="mute-btn" aria-label="Sound on or off"></button>
      </div>
    </div>
    <div class="hud-box right">
      <span id="time"></span><span id="speed"></span>
      <div class="meter" role="img" aria-label="Nitro tank"><i id="nitro-fill"></i></div>
    </div>
  </div>
  <div id="net" hidden></div>
  <div id="countdown" hidden></div>
  <div id="toast" hidden></div>
  <div id="tip" hidden></div>
  <div id="touch" hidden>
    <div class="touch-left">
      <button type="button" data-touch="left" aria-label="Steer left">&#9664;</button>
      <button type="button" data-touch="right" aria-label="Steer right">&#9654;</button>
    </div>
    <div class="touch-right">
      <button type="button" class="small" data-touch="brake" aria-label="Brake">Brake</button>
      <button type="button" class="mid" data-touch="drift" aria-label="Drift">Drift</button>
      <button type="button" class="large" data-touch="nitro" aria-label="Nitro">Nitro</button>
    </div>
  </div>
  <div id="screen"></div>
`;
const $ = (id) => document.getElementById(id);
const canvas = $("game");
const renderer = createRenderer(canvas);
const hud = {
  root: $("hud"),
  lap: $("lap"),
  pos: $("pos"),
  time: $("time"),
  speed: $("speed"),
  nitro: $("nitro-fill"),
};
const netBadge = $("net");
const countdownEl = $("countdown");
const toastEl = $("toast");
const tipEl = $("tip");
const touchEl = $("touch");
const screen = $("screen");
const pauseButton = $("pause-btn");
const muteButton = $("mute-btn");
bindInput(touchEl, { onPause: () => togglePause() });

// Browsers only allow sound after a tap or key press.
function unlockAudio() {
  audio.unlock();
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
let pauseEl = null;
let tick = 0;
let lastInput = { gas: false };
let toastText = "";
let toastUntil = 0;

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
}

function startRace({ trackId, laps, kartsSpec }) {
  hideResults();
  hidePause();
  paused = false;
  resetInput();
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
  world = { state: "countdown", track: t, karts, laps, raceTime: 0, countdown: CountdownSeconds };
  sendTimer = 0;
  hud.root.hidden = false;
  touchEl.hidden = !isTouchDevice;
  showTip();
}

// One-time hint about the new controls, shown during the first countdown.
function showTip() {
  if (prefs.tutorialSeen) {
    return;
  }
  prefs.tutorialSeen = true;
  savePrefs();
  tipEl.textContent = isTouchDevice
    ? "Hold Drift while steering through a corner, let go to charge Nitro, then hold Nitro on the straights."
    : "Hold Shift while turning to drift. Let go to charge nitro, then hold Space to boost.";
  tipEl.hidden = false;
  setTimeout(() => {
    tipEl.hidden = true;
  }, 9000);
}

function startSolo() {
  startRace({
    trackId: prefs.track,
    laps: prefs.laps,
    kartsSpec: [
      { id: "b1", name: "Zip", color: KartColors[2], bot: true, skill: 0.84 },
      { id: "b2", name: "Bolt", color: KartColors[3], bot: true, skill: 0.9 },
      { id: "b3", name: "Turbo", color: KartColors[4], bot: true, skill: 0.96 },
      { id: "me", name: "You", color: KartColors[0], isMe: true },
    ],
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
  startRace({ trackId, laps, kartsSpec: [hostKart, guestKart] });
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
  const rearX = kart.x - cos * 22;
  const rearY = kart.y - sin * 22;

  if (kart.drifting && kart.speed > 180) {
    for (const side of [-1, 1]) {
      fx.emit(
        "smoke",
        rearX - sin * side * 11,
        rearY + cos * side * 11,
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
  if (kart.driftReward > 0) {
    if (mine) {
      toastText = "Drift boost!";
      toastUntil = performance.now() + 1100;
      audio.boost();
      vibrate(20);
    }
    kart.driftReward = 0;
  }
  if (mine && kart.nitroOn && !kart.wasNitro) {
    audio.boost();
    vibrate(15);
  }
  kart.wasNitro = kart.nitroOn;
}

function update(dt, now) {
  if (!world) return;
  const { track: t, karts } = world;
  tick += 1;
  renderer.particles.update(dt);

  if (world.state === "demo") {
    for (const kart of karts) {
      stepKart(kart, botInput(kart, t), dt, t, true);
      if (tick % 3 === 0) emitEffects(kart);
      kart.hit = 0;
      kart.driftReward = 0;
    }
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
    stepKart(kart, input, dt, t, racing || kart.finished);
    emitEffects(kart);
    handleKartEvents(kart);
    if (racing && checkFinish(kart) && kart === me) {
      session?.send({ t: "fin", time: kart.finishTime });
      audio.finish(standings().indexOf(me) === 0);
      showResults();
    }
  }

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
  setText("lap", hud.lap, `Lap ${lap}/${world.laps}`);
  setText("pos", hud.pos, `${ordinal(rank)} of ${world.karts.length}`);
  setText("time", hud.time, formatTime(Math.max(0, world.raceTime)));
  setText("speed", hud.speed, `${Math.round(me.speed / 4)} km/h`);
  hud.nitro.style.width = `${Math.round(me.nitro * 100)}%`;
  hud.nitro.classList.toggle("on", me.nitroOn);
  hud.nitro.classList.toggle("low", me.nitro < 0.12);

  // live drift read-out, or the last "boost" message
  const nowMs = performance.now();
  if (me.drifting && me.driftTime > 0.25) {
    toastEl.hidden = false;
    toastEl.dataset.kind = me.driftTime >= Physics.driftMinTime ? "good" : "warm";
    setText("toast", toastEl, `Drift ${me.driftTime.toFixed(1)}s`);
  } else if (toastUntil > nowMs) {
    toastEl.hidden = false;
    toastEl.dataset.kind = "boost";
    setText("toast", toastEl, toastText);
  } else {
    toastEl.hidden = true;
  }

  if (world.state === "countdown") {
    const n = Math.ceil(world.countdown - 0.2);
    countdownEl.hidden = false;
    setText("cd", countdownEl, n > 0 ? String(n) : "GO!");
  } else if ((world.goFlash ?? 0) > 0) {
    countdownEl.hidden = false;
    setText("cd", countdownEl, "GO!");
  } else {
    countdownEl.hidden = true;
  }

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
    <h1>Kart Race</h1>
    <p class="sub">Drive fast, stay on the road, beat your friends.</p>
    <div class="group"><span class="label">Track</span><div data-slot="track"></div></div>
    <div class="group"><span class="label">Laps</span><div data-slot="laps"></div></div>
    <button type="button" class="big primary" data-act="solo"><strong>Race against bots</strong><span>3 bots, one lap or more</span></button>
    <button type="button" class="big" data-act="online"><strong>Race a friend online</strong><span>Get an invite link, play from anywhere</span></button>
    <p class="hint">${
      isTouchDevice
        ? "Touch: the kart accelerates by itself. Steer with the arrows, hold Drift in corners, then use Nitro."
        : "Keyboard: arrows or WASD drive, Shift drifts, Space is nitro, P pauses."
    }</p>
    <a class="footer" href="check.html">Connection check</a>
  `);
  const renderChoices = () => {
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
  };
  renderChoices();
  element.querySelector('[data-act="solo"]').addEventListener("click", startSolo);
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

  lobbyRefresh = () => {
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
  startButton.addEventListener("click", hostStartsRace);

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

function showPause() {
  if (pauseEl || resultsEl || !world || !["racing", "countdown"].includes(world.state)) {
    return;
  }
  const solo = !online;
  const panel = card(`
    <h1>${solo ? "Paused" : "Race menu"}</h1>
    <p class="sub">${solo ? "The race is frozen." : "The race keeps going while this is open."}</p>
    <button type="button" class="big primary" data-act="resume"><strong>Resume</strong></button>
    ${solo ? '<button type="button" class="big" data-act="restart"><strong>Restart race</strong></button>' : ""}
    <a class="big" data-role="menu"><strong>${solo ? "Quit to menu" : "Leave race"}</strong></a>
  `);
  panel.querySelector('[data-role="menu"]').href = window.location.pathname;
  panel.querySelector('[data-act="resume"]').addEventListener("click", () => togglePause());
  panel.querySelector('[data-act="restart"]')?.addEventListener("click", startSolo);
  const wrap = document.createElement("div");
  wrap.className = "overlay";
  wrap.append(panel);
  screen.append(wrap);
  pauseEl = wrap;
}

function togglePause() {
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
  const panel = card(`
    <h1 data-role="title"></h1>
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
    again.textContent = online ? "Rematch" : "Race again";
    again.addEventListener("click", () => {
      if (online) {
        hostStartsRace();
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
  const title = resultsEl.querySelector('[data-role="title"]');
  title.textContent =
    place === 1 ? (done ? "You won!" : "You finished 1st!") : `You finished ${ordinal(place)}`;
  const rows = resultsEl.querySelector('[data-role="rows"]');
  rows.replaceChildren(
    ...order.map((kart, i) => {
      const li = document.createElement("li");
      if (kart === me) li.className = "me";
      const dot = document.createElement("i");
      dot.style.background = kart.color;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = `${i + 1}. ${kart.name}`;
      const time = document.createElement("span");
      time.className = "time";
      time.textContent = kart.finished ? formatTime(kart.finishTime) : "racing...";
      li.append(dot, name, time);
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
    renderer.draw({ track: world.track, karts: world.karts, me }, paused ? 0 : frameDt);
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
