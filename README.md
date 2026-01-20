# vibeChess

Local-first chess app: Maia for play, Stockfish for analysis.

## Features
- Maia human-like engine for play (ELO 1100-1900)
- Stockfish analysis mode with multi-PV suggestions
- Electron desktop build with engines downloaded on first launch
- Debug mode to start from a custom FEN

## Prerequisites
- Node.js 18+
- npm

## Install
```bash
npm i
```

## Run
- Web dev server: `npm run dev`
- Build a desktop app: `npm run electron:build`

## Online mode (WebSocket)
The client expects a WebSocket relay server at `VITE_WS_URL` (default: `ws://localhost:8080/ws`).

Example:
```bash
VITE_WS_URL=ws://localhost:8080/ws npm run dev
```

For the server, see `server/readme.md`.

## Engine downloads (packaged app)
- On first launch the app downloads Stockfish, Zerofish, and Maia weights into `~/.vibeChess`.
- Defaults:
  - Stockfish: `https://cdn.jsdelivr.net/npm/stockfish@17.1.0/src/`
  - Zerofish: `https://cdn.jsdelivr.net/npm/zerofish@0.0.36/dist/`
  - Maia weights: `https://github.com/CSSLab/maia-chess/releases/download/v1.0/`
- Override per engine with `VIBE_STOCKFISH_DOWNLOAD_BASE_URL`, `VIBE_ZEROFISH_DOWNLOAD_BASE_URL`, or `VIBE_MAIA_DOWNLOAD_BASE_URL`.
- Files are stored under `~/.vibeChess/engine` and `~/.vibeChess/maia`.

## Dev engine setup (Vite dev server)
If you run `npm run dev` in a browser (no Electron), download the engine assets into `public/engine` and `public/maia`:

```bash
npm run engines:download
```

Optional override for the asset host:

```bash
STOCKFISH_DOWNLOAD_BASE_URL=https://your-host/stockfish/ \\
ZEROFISH_DOWNLOAD_BASE_URL=https://your-host/zerofish/ \\
MAIA_DOWNLOAD_BASE_URL=https://your-host/maia/ \\
npm run engines:download
```

## Debug mode

A development mode allows loading a FEN position at startup for quick testing.

Start in debug mode:

```bash
npm run debug
```

Behavior:
- When opened with `VITE_DEBUG=1`, the app will show a prompt allowing you to enter a FEN string.
- Leaving the prompt empty will reuse the previously saved FEN from localStorage.
- Canceling the prompt keeps the fallback position (the standard starting position).
- A valid FEN is saved under the `vibeChess.debug-fen` key in `localStorage`.

Example test FEN:

```
rnbqk3/ppppp2P/8/8/8/8/PPPPPPP1/RNBQKBNR b KQkq - 0 1
```

To clear the saved position from the browser console:

```js
localStorage.removeItem('vibeChess.debug-fen')
```

## Troubleshooting

### macOS: "App is damaged and can't be opened"
If you download the app from GitHub releases and get this error on macOS, it's because the app is not signed with a paid Apple Developer certificate. To fix it:

1. Move the app to your `/Applications` folder.
2. Open a terminal and run:
   ```bash
   xattr -cr /Applications/vibeChess.app
   ```
This removes the "quarantine" flag that macOS applies to downloaded files.
