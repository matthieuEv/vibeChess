# vibeChess

> Wanted a lightweight web chess app with Stockfish analysis, without a subscripton on chess.com
> So i vibecoded one

## Installation
```bash
npm i
```

## Run the app
```bash
npm run dev
```
Then open the URL shown in the terminal (default http://localhost:5173).

## Key details
- The Stockfish 17.1 lite engine is already copied to `public/engine/stockfish-17.1-lite-single-03e3232.{js,wasm}`. They are served statically; don't rename or move them without updating `ENGINE_PATH` in `src/App.tsx`.
- ELO is adjusted via `UCI_LimitStrength`/`UCI_Elo`. The slider ranges from 600 to 2800.

## Chess AI

vibeChess features a fully integrated AI Coach that runs locally on your machine using **Ollama**. It can analyze your games, explain mistakes, and even control the board to demonstrate variations.

### Setup Ollama and the Model

1. **Install Ollama**: Follow the instructions at [ollama.com](https://ollama.com/) to install Ollama on your machine.
2. **Download the Model**: Open a terminal and run:
   ```bash
   ollama pull llama3.1:8b
   ```
   You can choose another model if you prefer, but make sure it's compatible with tooling. (If you choose a wrong model, the app will show an error when connecting.)

3. **Choose your model**: To choose your model, simply open the settings and enter the model name (default is `llama3.1:8b`).

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
