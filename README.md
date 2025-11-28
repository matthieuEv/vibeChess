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

## AI Assistant Setup (Optional)
vibeChess includes a local AI coach powered by [Ollama](https://ollama.com/).

1. **Install Ollama**: Download and install from [ollama.com](https://ollama.com/).
2. **Pull a Model**: Open your terminal and run:
   ```bash
   ollama run llama3.2
   ```
   (You can use other models like `mistral` or `gemma`, but make sure to select them in the app settings).
3. **Connect**: The app connects to `http://localhost:11434` by default. If the connection fails, ensure Ollama is running.

**Note on CORS**: If you see connection errors in the browser console, you might need to launch Ollama with:
```bash
OLLAMA_ORIGINS="*" ollama serve
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
