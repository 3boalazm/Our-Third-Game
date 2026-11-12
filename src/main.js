import "./styles.css";
import { Tracks, buildTrack, trackById } from "./track.js";
import {
  KartColors,
  angleDiff,
  botInput,
  formatTime,
  makeKart,
  placeOnGrid,
  stepKart,
} from "./game.js";
import { createRenderer } from "./render.js";
import { bindInput, isTouchDevice, readInput } from "./input.js";
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
    <div class="hud-box"><span id="lap"></span><span id="pos"></span></div>
    <div class="hud-box right"><span id="time"></span><span id="speed"></span></div>
  </div>
  <div id="net" hidden></div>
  <div id="countdown" hidden></div>
  <div id="touch" hidden>
    <button type="button" data-touch="left" aria-label="Steer left">&#9664;</button>
    <button type="button" data-touch="brake" aria-label="Brake">Brake</button>
    <button type="button" data-touch="right" aria-label="Steer right">&#9654;</button>
  </div>
  <div id="screen"></div>
`;
const $ = (id) => document.getElementById(id);
const canvas = $("game");
const renderer = createRenderer(canvas);
const hud = { root: $("hud"), lap: $("lap"), pos: $("pos"), time: $("time"), speed: $("speed") };
const netBadge = $("net");
const countdownEl = $("countdown");
const touchEl = $("touch");
const screen = $("screen");
bindInput(touchEl);

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

function startDemo(trackId) {
  const t = track(trackId);
  const karts = [0, 1, 2].map((i) =>
    makeKart({ id: `d${i}`, name: "", color: KartColors[i + 2], bot: true, skill: 0.78 + i * 0.06 }),
  );
  karts.forEach((kart, i) => placeOnGrid(kart, t, i));
  world = { state: "demo", track: t, karts, laps: 99, raceTime: 0 };
  me = null;
  remote = null;
}

function startRace({ trackId, laps, kartsSpec }) {
  hideResults();
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

function update(dt, now) {
  if (!world) return;
  const { track: t, karts } = world;

  if (world.state === "demo") {
    for (const kart of karts) {
      stepKart(kart, botInput(kart, t), dt, t, true);
    }
    return;
  }

  if (world.state === "countdown") {
    world.countdown -= dt;
    if (world.countdown <= 0) {
      world.state = "racing";
      world.goFlash = 0.9;
    }
  } else if (world.state === "racing") {
    world.raceTime += dt;
    world.goFlash = Math.max(0, (world.goFlash ?? 0) - dt);
  }

  const racing = world.state === "racing";
  for (const kart of karts) {
    if (kart.isRemote) {
      updateRemote(dt, now);
      continue;
    }
    let input;
    if (kart.isMe && !kart.finished && !(import.meta.env.DEV && window.__kartAuto)) {
      input = readInput();
    } else {
      input = botInput(kart, t);
      if (kart.isMe) {
        input.gas = kart.speed < 330; // coast round after finishing
      }
    }
    stepKart(kart, input, dt, t, racing || kart.finished);
    if (racing && checkFinish(kart) && kart === me) {
      session?.send({ t: "fin", time: kart.finishTime });
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
        ? "Touch: you accelerate automatically. Use the arrows to steer and Brake to slow down."
        : "Keyboard: arrow keys or WASD to drive, Down or S to brake."
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

function hostStartsRace() {
  if (online?.role !== "host" || netState !== "connected") {
    return;
  }
  session.send({ t: "go", track: prefs.track, laps: prefs.laps });
  startOnlineRace(prefs.track, prefs.laps);
}

// ---------- results ----------

function hideResults() {
  resultsEl?.remove();
  resultsEl = null;
}

function showResults() {
  if (resultsEl) return;
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
    const id = trackById(message.track).id;
    const laps = LapOptions.includes(message.laps) ? message.laps : 3;
    prefs.track = id;
    prefs.laps = laps;
    startOnlineRace(id, laps);
  } else if (message.t === "s" && remote && world?.state !== "demo") {
    if ([message.x, message.y, message.a, message.v, message.p].every(Number.isFinite)) {
      remote.target = {
        x: message.x,
        y: message.y,
        a: message.a,
        v: message.v,
        p: message.p,
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
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt, now);
  updateHud();
  if (world) {
    renderer.draw({ track: world.track, karts: world.karts, me }, dt);
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
    step(dt, now = performance.now()) {
      update(dt, now);
      updateHud();
    },
  };
}
