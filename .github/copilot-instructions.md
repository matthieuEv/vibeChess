# Copilot Instructions for vibeChess

This document provides context and guidelines for AI assistants working on the vibeChess codebase.

## Project Overview
vibeChess is a lightweight, web-based chess application built with React, Vite, and TypeScript. It features a built-in Stockfish chess engine for play and analysis, running entirely in the browser via Web Workers.

## Tech Stack
- **Framework**: React 19 + Vite 7
- **Language**: TypeScript 5.9
- **State Management**: React Hooks (`useState`, `useEffect`, `useCallback`, `useRef`)
- **Chess Logic**: `chess.js` (Game state, move validation, FEN handling)
- **Chess UI**: `react-chessboard`
- **Engine**: Stockfish 17.1 (WASM/JS) running in a Web Worker
- **Styling**: CSS (Global `App.css` with CSS Grid layout)
- **Testing**: Vitest
- **Linting**: ESLint

## Architecture & Key Components

### 1. Main Application (`src/App.tsx`)
- **Role**: The central controller. Manages game state, engine communication, and UI rendering.
- **Layout**: Implements a 3-column "Desktop" layout using CSS Grid:
  - **Sidebar**: Game controls, New Game, Analysis toggle.
  - **Main Board**: The `Chessboard` component.
  - **Info Panel**: Move history, evaluation score, and analysis lines.
- **Engine Integration**:
  - Stockfish is loaded from `public/engine/stockfish-17.1-lite-single-03e3232.js`.
  - Communication uses the UCI (Universal Chess Interface) protocol via `postMessage`.
  - **Critical Pattern**: Engine commands (`sendEngine`) must be wrapped in `useCallback` to prevent unnecessary re-initializations and satisfy `react-hooks/exhaustive-deps`.

### 2. Helper Logic (`src/chessHelpers.ts`)
- Contains pure functions for move history manipulation and analysis data structures.
- **Key Functions**:
  - `sanitizeVerboseHistory`: Replays moves to ensure validity.
  - `buildAnalysisEntriesFromVerbose`: Converts move history into a format suitable for the analysis view (FENs, move indices).

### 3. Styling (`src/App.css`)
- **Layout**: Uses a fixed CSS Grid layout (`280px 1fr 350px`) with `100vh` height and `overflow: hidden` to mimic a desktop application.
- **Theming**: Uses CSS variables for colors (e.g., `--bg-color`, `--primary-color`).
- **UI Stability**: Implements "Skeleton" loading states (`.skeleton`) to prevent layout shifts during asynchronous engine analysis.

## Coding Conventions & Patterns

### React & Hooks
- **Strict Mode**: The app runs in React Strict Mode. Ensure effects are resilient to double-invocation.
- **Dependency Arrays**: Always include all dependencies in `useEffect` and `useCallback`. Use `useRef` for values that shouldn't trigger re-renders (like the engine worker instance).
- **Memoization**: Use `useMemo` for expensive calculations, especially when deriving game state from history.

### Chess Engine (UCI)
- **Command Flow**:
  1. `uci` -> `isready` -> `ucinewgame`
  2. `position fen <fen> moves <moves>`
  3. `go depth <depth>` or `go movetime <time>`
- **Parsing**: Engine output is parsed from standard output strings (e.g., `info depth 10 score cp 50 pv e2e4...`).
- **Worker Management**: The worker is initialized once in a `useEffect`. Always terminate the old worker before creating a new one if a restart is needed.

### TypeScript
- **Strict Typing**: Avoid `any`. Use types from `chess.js` (`Move`, `Square`) and define interfaces for custom structures (e.g., `EngineMessage`, `AnalysisLine`).
- **Null Safety**: Handle potential `null` returns from `chess.js` methods (e.g., `move()`, `get()`).

### Testing
- **New Features**: For every significant feature or logic change, you must add new unit tests.
- **Test Cases**: Include multiple test cases with different values (edge cases, typical usage, invalid inputs) to ensure robustness.

### UI/UX
- **Skeleton Loading**: When displaying data that loads asynchronously (like engine analysis), use skeleton placeholders to maintain vertical rhythm and prevent layout thrashing.
- **Responsive Design**: The current layout is optimized for desktop (min-width 1024px). Mobile adaptations should use media queries to stack columns.

### Verification Workflow
- **Mandatory Checks**: After every modification, run the following commands to ensure nothing is broken:
  - `npm run build`
  - `npm run lint`
  - `npm run test`

## Common Tasks

### Adding a New Engine Feature
1. Update `App.tsx` to listen for the specific UCI token in the `onmessage` handler.
2. Add state to store the new data.
3. Update the UI to display it, ensuring a skeleton state exists if it takes time to compute.

### Modifying the Layout
1. Edit the `.app-container` grid definition in `App.css`.
2. Ensure the `Chessboard` container (`.board-container`) has explicit dimensions to allow `react-chessboard` to resize correctly.

### Debugging
- **Engine**: Check the browser console. `console.log` incoming worker messages to trace UCI protocol issues.
- **State**: Use React DevTools to inspect the `game` object (chess.js instance) and local state.
