// Online 2-player link, using the same room relay as "Our First Game"
// (a Cloudflare Worker). The relay is shared, so a room code that is already
// in use by another host is detected and a fresh code is picked automatically.
//
// Both players open a WebSocket to
//   <relay>/room/<4 digit code>?role=host|guest&key=<random>
// and the relay forwards every text message to the other side. Nothing is
// registered anywhere, so a room survives the page going to the background:
// the socket reconnects with the same key and takes its place back.
//
// Relay control messages: "R" host registered, "J" a guest is in the room,
// "A" guest accepted, "L" the other player left. "p" is our keep-alive.
// Everything else is a JSON game message.
//
// role "host"  -> owns room `roomId`, plays Blue (player 1)
// role "guest" -> joins room `roomId`, plays Red (player 2)
//
// status states:
//   waiting      host, nobody has joined yet
//   connecting   first connection attempt
//   connected    both players are in the room
//   away         the other player left (we keep waiting for them)
//   reconnecting our own link to the relay dropped and is being re-opened
//   error        gave up on something fixable only by the user (detail given)

const DefaultRelay = "wss://ourfirstgame.doha-mustafa.workers.dev";
const PingMs = 20000;
const OpenTimeoutMs = 8000;
const WakeAfterHiddenMs = 3000;
// Both players send a tiny "ping" through the relay. If nothing from the friend
// arrives for a while while we think we are connected, the socket is probably
// half-dead (common on phones) and we replace it.
const FriendPingMs = 6000;
const SilentAfterMs = 25000;
const MaxSilentAfterMs = 120000;

function relayBase() {
  try {
    // local testing only: ?relay=ws://127.0.0.1:8787
    const q = new URLSearchParams(window.location.search).get("relay");
    if (q && /^ws:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(q)) {
      return q;
    }
  } catch {
    // ignore
  }
  return DefaultRelay;
}

export function createRoomId() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
  return String(n).padStart(4, "0");
}

// The key identifies *us* in the room. Keeping it across reloads lets a
// reloaded page take its own seat back instead of being locked out.
function loadKey(role, roomId) {
  const name = `kart-key-${role}-${roomId}`;
  try {
    const saved = localStorage.getItem(name);
    if (saved) {
      return saved;
    }
  } catch {
    // storage unavailable
  }
  const key = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
    b.toString(36).padStart(2, "0"),
  ).join("");
  try {
    localStorage.setItem(name, key);
  } catch {
    // storage unavailable
  }
  return key;
}

export function createOnlineSession({
  role,
  roomId,
  onStatus,
  onOpen,
  onMessage,
  onRoomChange,
}) {
  let destroyed = false;
  let ws = null;
  let retryTimer = null;
  let openTimer = null;
  let pingTimer = null;
  let tries = 0;
  let everOpen = false;
  let hadFriend = false;
  let hiddenAt = 0;
  let lastInbound = Date.now();
  let silentRounds = 0;
  let state = "";
  let current = roomId;
  let key = loadKey(role, current);

  function status(next, detail = "") {
    state = next;
    if (!destroyed) {
      onStatus(next, detail);
    }
  }

  function stopTimers() {
    clearTimeout(openTimer);
    clearInterval(pingTimer);
    openTimer = null;
    pingTimer = null;
  }

  function scheduleRetry(immediate = false) {
    if (destroyed || retryTimer) {
      return;
    }
    const wait = immediate ? 50 : Math.min(8000, 1000 * 2 ** Math.min(tries, 4));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!destroyed && !(ws && ws.readyState <= 1)) {
        tries += 1;
        connect();
      }
    }, wait);
  }

  function friendIn() {
    hadFriend = true;
    tries = 0;
    lastInbound = Date.now();
    status("connected");
    onOpen();
  }

  function handle(text) {
    if (role === "host") {
      if (text === "R") {
        everOpen = true;
        tries = 0;
        status(hadFriend ? "away" : "waiting");
        return;
      }
      if (text === "J") {
        friendIn();
        return;
      }
    } else if (text === "A") {
      everOpen = true;
      friendIn();
      return;
    }
    if (text === "L") {
      status("away");
      return;
    }
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!message || typeof message !== "object") {
      return;
    }
    lastInbound = Date.now();
    silentRounds = 0;
    if (state !== "connected") {
      // e.g. the host came back while we were waiting for it
      hadFriend = true;
      status("connected");
    }
    if (message.type !== "ping") {
      onMessage(message);
    }
  }

  function connect() {
    if (destroyed) {
      return;
    }
    const url = `${relayBase()}/room/${current}?role=${role}&key=${key}`;
    let socket;
    try {
      socket = new WebSocket(url);
    } catch {
      scheduleRetry();
      return;
    }
    ws = socket;

    // give up on a socket that never opens and try again
    openTimer = setTimeout(() => {
      if (ws === socket && socket.readyState !== 1) {
        try {
          socket.close();
        } catch {
          // ignore
        }
      }
    }, OpenTimeoutMs);

    socket.onopen = () => {
      if (ws !== socket) {
        return;
      }
      clearTimeout(openTimer);
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (ws === socket && socket.readyState === 1) {
          try {
            socket.send("p");
          } catch {
            // the close handler will take over
          }
        }
      }, PingMs);
    };

    socket.onmessage = (event) => {
      if (ws === socket) {
        handle(String(event.data));
      }
    };

    socket.onclose = (event) => {
      if (ws !== socket) {
        return;
      }
      ws = null;
      stopTimers();
      if (destroyed) {
        return;
      }
      const code = event.code;
      if (code === 4001) {
        // Host: this room code is in use by someone else.
        if (!everOpen) {
          current = createRoomId();
          key = loadKey(role, current);
          onRoomChange?.(current);
          connect();
        } else {
          status("error", "This room is being used by another player.");
        }
        return;
      }
      if (code === 4003) {
        status("error", "This room already has two players.");
        return;
      }
      if (code === 4004) {
        // Guest: the host is not in the room right now. Keep trying.
        status(everOpen ? "reconnecting" : "connecting");
        scheduleRetry();
        return;
      }
      if (code === 4002) {
        return; // replaced by our own newer connection
      }
      if (everOpen) {
        status("reconnecting");
      } else if (tries >= 5) {
        status("error", "Can't reach the game server. Retrying...");
      } else {
        status("connecting");
      }
      scheduleRetry();
    };
  }

  // Replace the socket with a fresh one (phone woke up, Wi-Fi came back...).
  // The relay lets the same key take its seat back without telling the friend.
  function reconnectNow() {
    if (destroyed) {
      return;
    }
    clearTimeout(retryTimer);
    retryTimer = null;
    tries = 0;
    stopTimers();
    const old = ws;
    ws = null;
    try {
      old?.close();
    } catch {
      // ignore
    }
    connect();
  }

  function wake() {
    if (!destroyed && (!ws || ws.readyState !== 1)) {
      reconnectNow();
    }
  }

  function onVisibility() {
    if (document.hidden) {
      hiddenAt = Date.now();
    } else if (Date.now() - hiddenAt > WakeAfterHiddenMs) {
      // A socket that sat in the background may be half-dead: take a fresh one.
      reconnectNow();
    } else {
      wake();
    }
  }
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", reconnectNow);
  window.addEventListener("pageshow", wake);

  const friendPing = setInterval(() => {
    if (destroyed || state !== "connected" || !ws || ws.readyState !== 1) {
      return;
    }
    try {
      ws.send(JSON.stringify({ type: "ping" }));
    } catch {
      // the close handler will reconnect
    }
    const limit = Math.min(MaxSilentAfterMs, SilentAfterMs * 2 ** silentRounds);
    if (Date.now() - lastInbound > limit) {
      silentRounds += 1;
      lastInbound = Date.now();
      reconnectNow();
    }
  }, FriendPingMs);

  queueMicrotask(() => {
    if (!state) {
      status(role === "host" ? "waiting" : "connecting");
    }
  });
  connect();

  return {
    get roomId() {
      return current;
    },
    // milliseconds since we last heard from the friend
    msSinceFriend() {
      return Date.now() - lastInbound;
    },
    send(message) {
      if (ws && ws.readyState === 1) {
        try {
          ws.send(JSON.stringify(message));
        } catch {
          // the close handler will reconnect
        }
      }
    },
    // Replace the socket with a fresh one; both sides re-sync on reopen.
    reconnect() {
      reconnectNow();
    },
    destroy() {
      destroyed = true;
      clearInterval(friendPing);
      stopTimers();
      clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", reconnectNow);
      window.removeEventListener("pageshow", wake);
      const old = ws;
      ws = null;
      try {
        old?.close(1000);
      } catch {
        // ignore
      }
    },
  };
}
