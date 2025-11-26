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
