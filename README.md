# Kart Race

A small top-down kart racing game for the browser. Race three bots on your own, or race a friend online from anywhere (phone or computer).

- Two tracks (Sunny Loop, Twisty Hills), 1 / 3 / 5 laps
- Keyboard: arrow keys or WASD, Down or S to brake
- Phone: the kart accelerates by itself, you steer with the on-screen arrows and brake with the Brake button
- Online: the host gets a 4 digit room and an invite link, the friend opens it and plays from any network

## Run

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
```

Build for production with `npm run build` (output in `dist`). `npm test` checks that every track is a clean loop that does not run into itself.

## How online play works

Both players connect to a small room relay (a Cloudflare Worker, the same one used by "Our First Game", `wss://ourfirstgame.doha-mustafa.workers.dev`). Each browser drives its own kart and sends its position about 20 times per second; the other browser draws it smoothly. The link re-opens by itself if a player's connection drops or the phone goes to the background. Races are not saved: if someone reloads in the middle of a race, the host can start a rematch.

`/check.html` tests the connection from your own network (reaching the relay, a second player joining, moves both ways, 20 seconds of stability).

## Project layout

- `src/track.js` track definitions, spline sampling, nearest-point lookup
- `src/game.js` kart physics, bot driver, lap progress
- `src/render.js` canvas drawing and minimap
- `src/input.js` keyboard and touch controls
- `src/online.js` relay client with automatic reconnect
- `src/main.js` menus, lobby, race flow, results, online messages
