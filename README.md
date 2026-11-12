# Kart Race

A small top-down kart racing game for the browser. Race three bots on your own, or race a friend online from anywhere (phone or computer).

- Two tracks (Sunny Loop, Twisty Hills), 1 / 3 / 5 laps. Wide roads (about 290 px) with gentle bends: `npm test` fails if any bend is tighter than 250 px
- **Camera:** by default the camera sits behind the kart, so the road ahead always runs up the screen (also in landscape). "Fixed map" (Controls or the Pause menu, or the C key) keeps the map still instead
- Keyboard: arrows or WASD drive, Down/S brake, **Shift** drift, **Space** nitro, P or Esc pause
- Phone: the kart accelerates by itself and you **tilt the phone like a steering wheel**. Only two buttons are used: **Nitro** (right thumb) and **Brake** (left thumb). Drift is automatic when you turn hard. In Controls (start menu) you can switch to on-screen arrows, set the **tilt sensitivity** (1-10 slider, also in the Pause menu), flip the tilt direction, bring back a Drift button, or choose **Landscape** (fullscreen + screen lock where the browser allows it; on iPhone a "turn your phone" card is shown). iPhones ask for motion access once; Pause has a "Recenter tilt" button
- **Drift**: hold Drift while steering through a corner to slide. A clean slide of 0.6 s or more, released on the road, charges the nitro tank and gives a short mini-boost. Crashing or leaving the road cancels the reward
- **Nitro**: hold to boost (about 3 s from a full tank). The tank slowly refills on its own, much faster with good drifts
- Sound effects are synthesised in the browser (no audio files); the speaker button mutes them
- **Install as an app (PWA):** the start menu has an "Install the app" button (Android/Chrome/desktop use the browser's install prompt; on iPhone it shows the Share > Add to Home Screen steps). The installed app opens **fullscreen** and the solo game works offline (a service worker caches the game; online races still need the connection)
- **Fullscreen:** a button in the race HUD (or the F key) and, on phones, the game asks for fullscreen when a race starts (Controls > Fullscreen can turn that off)
- **Landscape without turning the phone:** Controls > Screen > Landscape. If the phone is locked upright the game rotates itself sideways with CSS, following how the phone is held (gravity sensor), and tilt steering is adjusted to match. Where the browser allows it, the screen is also locked to landscape
- Online: the host gets a 4 digit room and an invite link, the friend opens it and plays from any network

## Run

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
```

Build for production with `npm run build` (output in `dist`). `npm test` checks that every track is a clean loop that does not run into itself and runs the physics tests (acceleration, frame-rate independence, wall, nitro, drift rewards, lap progress) and the tilt-angle maths for every screen orientation with Node's built-in test runner.

## How online play works

Both players connect to a small room relay (a Cloudflare Worker, the same one used by "Our First Game", `wss://ourfirstgame.doha-mustafa.workers.dev`). Each browser drives its own kart and sends its position about 20 times per second; the other browser draws it smoothly. The link re-opens by itself if a player's connection drops or the phone goes to the background. Races are not saved: if someone reloads in the middle of a race, the host can start a rematch.

`/check.html` tests the connection from your own network (reaching the relay, a second player joining, moves both ways, 20 seconds of stability).

## Project layout

- `src/track.js` track definitions, spline sampling, nearest-point lookup
- `src/game.js` kart physics (fixed 1/60 s step), drift, nitro, bot driver, lap progress
- `src/particles.js` smoke, flames, grass and sparks (fixed-size pool)
- `src/audio.js` engine, drift, nitro and crash sounds made with Web Audio
- `tests/` physics tests
- `src/render.js` canvas drawing and minimap
- `src/input.js` keyboard, touch buttons and tilt (gyroscope) steering
- `src/layout.js` rotates the game sideways for the Landscape option
- `public/sw.js`, `public/manifest.webmanifest`, `public/icons/` the installable app; `python scripts/make-icons.py` regenerates the icons
- `src/online.js` relay client with automatic reconnect
- `src/main.js` menus, lobby, race flow, results, online messages
