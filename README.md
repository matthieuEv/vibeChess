# vibeChess

> Wanted a lightweight web chess app with Stockfish analysis, without a subscripton on chess.com

## Prerequisites
- Node.js 18+ recommended
- npm (shipped with Node)

## Installation
```bash
npm i
```

## Run in dev
```bash
npm run dev
```
Then open the URL shown in the terminal (default http://localhost:5173).

## Key details
- The Stockfish 17.1 lite engine is already copied to `public/engine/stockfish-17.1-lite-single-03e3232.{js,wasm}`. They are served statically; don't rename or move them without updating `ENGINE_PATH` in `src/App.tsx`.
- ELO is adjusted via `UCI_LimitStrength`/`UCI_Elo`. The slider ranges from 600 to 2800.
- The "Analyze" button starts interactive mode: Stockfish computes lines, the board restarts from the beginning, and you navigate with the left/right arrows. At each position the best lines are displayed, and you can play variations to explore branches.

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

To create your own test FEN, you can use a chess site like [Chess FEN Viewer](https://www.redhotpawn.com/chess/chess-fen-viewer.php)

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
