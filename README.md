# vibeChess

> Wanted a lightweight web chess app with Stockfish analysis, without a subscripton on chess.com
> So i vibecoded one

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

## AI Coach Setup (Local LLM)

vibeChess features a fully integrated AI Coach that runs locally on your machine using **Ollama**. It can analyze your games, explain mistakes, and even control the board to demonstrate variations.

### 1. Install Ollama
Download and install Ollama from [ollama.com](https://ollama.com/). This service runs the AI models locally.

### 2. Download a Model
Open your terminal and pull a model. We recommend `llama3.2` for a good balance of speed and intelligence, but `mistral` or `gemma` work well too.

```bash
# Recommended
ollama pull llama3.2

# Alternatives
ollama pull mistral
ollama pull gemma2
```

### 3. Configure CORS (Important!)
By default, browsers block web pages from talking to local servers. You need to allow vibeChess to talk to Ollama.

**Mac/Linux:**
Stop Ollama (if running) and restart it with this environment variable:
```bash
OLLAMA_ORIGINS="*" ollama serve
```

**Windows:**
1. Quit Ollama from the taskbar.
2. Open PowerShell as Administrator.
3. Run:
   ```powershell
   [Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*", "User")
   ```
4. Restart Ollama.

### 4. Connect in vibeChess
1. Open vibeChess.
2. Click the **Settings** button in the sidebar.
3. Go to the **Chess AI** tab.
4. If Ollama is running, you should see "Connected".
5. Select your model (e.g., `llama3.2`) from the dropdown.

## 🧠 AI Features

Once connected, you can chat with the AI in the bottom-right panel.

- **Position Analysis**: Ask "What do you think of this position?" or "Who is winning?". The AI uses Stockfish's evaluation to give you a grounded answer.
- **Mistake Explanation**: Ask "Why was my last move a mistake?". The AI will analyze the move you played vs the best move.
- **Navigation**: Ask "Go back to the start" or "Show me the last move".
- **Variations**: Ask "Show me what happens if I play Nx5". The AI can play moves on the board to demonstrate lines.

**Pro Tip**: The AI has access to the game history and engine evaluation. It's not just guessing; it's reading the board!

## Troubleshooting

### macOS: "App is damaged and can't be opened"
If you download the app from GitHub releases and get this error on macOS, it's because the app is not signed with a paid Apple Developer certificate. To fix it:

1. Move the app to your `/Applications` folder.
2. Open a terminal and run:
   ```bash
   xattr -cr /Applications/vibeChess.app
   ```
This removes the "quarantine" flag that macOS applies to downloaded files.
