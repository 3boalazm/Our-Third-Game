# Kart Race

A small top-down kart racing game for the browser. Race three bots on your own, or race a friend online from anywhere (phone or computer).

- Three tracks (Sunny Loop, Twisty Hills, Sunset Ridge), each with its own scenery and grass tones, 1 / 3 / 5 laps and Easy / Normal / Hard rivals. Wide roads (about 290 px) with gentle bends: `npm test` fails if any bend is tighter than 250 px
- **Boost pads:** three per lap, on the straights. Drive over the blue chevrons for a free, short boost (the bots use them too)
- **Slipstream:** tuck in right behind a rival for extra acceleration and top speed. A small "Slipstream" tag appears in the HUD while it is working
- **Contact:** karts rub and bump instead of driving through each other. A hit costs a little speed and throws a few sparks; your friend's kart only ever pushes you, it never moves on your screen
- **Time trial and ghost:** race alone against the clock. Your fastest lap is saved as a translucent ghost that you can chase on the next attempt, and the menu shows which ghost time you are up against
- **Medals:** every track has bronze, silver and gold lap-time targets scaled to its length. The best-lap line in the menu shows your medal and the next target
- **Kart colour:** pick one of six colours in the menu; the bots are assigned different ones. The choice is remembered
- **Lap times and records:** the HUD shows the current lap and your best lap, and the menu remembers the best lap on each track. Beat it and the race calls out a new track record; the results list every kart's best lap
- **Weather:** pick Clear, Rain or Night. Rain adds streaks and a wet tint, costs a little top speed and, more importantly, **grip**: the kart slides more and steering is softer. Night darkens the track and turns on the headlights. Weather is saved with the rest of the menu choices (online races stay clear so both players get the same physics)
- **Daily challenge:** one deterministic challenge per day, shown on the start menu: a bronze, silver or gold lap at one of the tracks. The card starts a one-lap time trial on that track, and turning in the required lap marks the day done
- **Photo mode and replay:** pause a solo race to freeze the action. Photo mode hides the HUD, centres the kart and lets you drag or use the arrow keys to orbit, zoom with the wheel, save a PNG (S) and leave with Esc. Replay plays the last ~10 seconds from a slowly orbiting cinematic camera, with a progress bar and its own exit button
- **Gamepad:** any standard-mapping controller can drive: left stick steers, RT/A accelerates, LT/B brakes, X or RB drifts, Y or LB fires nitro, Start pauses. Open **Gamepad** in the menu to remap Gas, Brake, Drift and Nitro: click a row, then press the button you want
- **Smarter bots:** rivals drift through real corners, use the nitro they earn and spend it on straights. Gentle rubber-banding gives a bot that is far behind a little more top speed and eases one that is far ahead, so a race stays a race
- **Camera:** by default the camera sits behind the kart, so the road ahead always runs up the screen (also in landscape). "Fixed map" (Controls or the Pause menu, or the C key) keeps the map still instead
- Keyboard: arrows or WASD drive, Down/S brake, **Shift** drift, **Space** nitro, P or Esc pause
- Phone: the kart accelerates by itself and you **tilt the phone like a steering wheel**. Only two buttons are used: **Nitro** (right thumb) and **Brake** (left thumb). Drift is automatic when you turn hard. In Controls (start menu) you can switch to on-screen arrows, set the **tilt sensitivity** (1-10 slider, also in the Pause menu), flip the tilt direction, bring back a Drift button, or choose **Landscape** (fullscreen + screen lock where the browser allows it; on iPhone a "turn your phone" card is shown). iPhones ask for motion access once; Pause has a "Recenter tilt" button
- **Drift**: hold Drift while steering through a corner to slide. A clean slide of 0.6 s or more, released on the road, charges the nitro tank and gives a short mini-boost. Crashing or leaving the road cancels the reward
- **Nitro**: hold to boost (about 3 s from a full tank). The tank slowly refills on its own, much faster with good drifts
- **Track-side details:** trees, bushes, rocks, tyre stacks, a grandstand and start-line flags, start lights, skid marks that stay on the road, and a minimap that also shows the boost pads. Decorations are placed from a fixed seed and are never on the road
- **Wrong way:** turn round and a warning pulses instead of quietly losing places
- Sound effects are synthesised in the browser (no audio files, and no music); the speaker button mutes them
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

Build for production with `npm run build` (output in `dist`). `npm test` checks that every track is a clean loop that does not run into itself, that boost pads and scenery are off the road and out of each other's way, and runs the physics tests (acceleration, frame-rate independence, wall, nitro, drift rewards, boost pads, slipstream, kart contact, lap progress), the ghost playback/recording maths, the daily-challenge selection, the gamepad mapping and remapping, the weather grip multipliers, rubber-banding, and the tilt-angle maths for every screen orientation with Node's built-in test runner.

## How online play works

Both players connect to a small room relay (a Cloudflare Worker, the same one used by "Our First Game", `wss://ourfirstgame.doha-mustafa.workers.dev`). Each browser drives its own kart and sends its position about 20 times per second; the other browser draws it smoothly. The link re-opens by itself if a player's connection drops or the phone goes to the background. Races are not saved: if someone reloads in the middle of a race, the host can start a rematch.

`/check.html` tests the connection from your own network (reaching the relay, a second player joining, moves both ways, 20 seconds of stability).

## Project layout

- `src/track.js` track definitions, spline sampling, nearest-point lookup
- `src/game.js` kart physics (fixed 1/60 s step), drift, nitro, bot driver, lap progress
- `src/particles.js` smoke, flames, grass and sparks (fixed-size pool)
- `src/audio.js` engine, drift, nitro and crash sounds made with Web Audio
- `tests/` physics, ghost, weather, gamepad and daily-challenge tests
- `src/render.js` canvas drawing, the baked grass/scenery layer, skid marks and minimap
- `src/scenery.js` seeded trees, bushes, rocks, tyre stacks, grandstand and start-line flags
- `src/ghost.js` saves, samples and replays the best-lap ghost
- `src/weather.js` Clear / Rain / Night presets and the grip multipliers they apply
- `src/challenges.js` deterministic daily challenge and its per-day storage
- `src/input.js` keyboard, touch buttons, tilt (gyroscope) steering and gamepad mapping
- `src/layout.js` rotates the game sideways for the Landscape option
- `public/sw.js`, `public/manifest.webmanifest`, `public/icons/` the installable app; `python scripts/make-icons.py` regenerates the icons
- `src/online.js` relay client with automatic reconnect
- `src/main.js` menus, lobby, race flow, results, online messages
