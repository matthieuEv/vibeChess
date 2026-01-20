import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Chess } from 'chess.js'
import type { Move, PieceSymbol, Square } from 'chess.js'
import { Chessboard, defaultPieces } from 'react-chessboard'
import './App.css'
import {
  buildAnalysisEntriesFromVerbose,
  type AnalysisEntry,
} from './chessHelpers'
import AnalysisArrowLayer, { type ArrowToDraw } from './components/AnalysisArrowLayer'
import InfoPanel from './components/InfoPanel'
import OnlinePanel from './components/OnlinePanel'
import Sidebar from './components/Sidebar'
import { type ColorChoice, type GameMode, type PlayerColor } from './chess/types'
import { buildGameOverText, clamp, findKingSquare, isPlayerVictory, uciToSan } from './chess/utils'
import {
  getMaiaEngine,
  MAIA_DEFAULT_ELO,
  snapMaiaElo,
  setMaiaAssetPaths,
  type MaiaElo,
  type MaiaEngine,
} from './engine/maiaEngine'
import {
  ensureEngineAssets,
  type EngineAssets,
  type EngineDownloadEvent,
} from './engine/engineAssets'
import { loadPlayerConfig, savePlayerConfig, type PlayerConfig } from './playerConfig'
import Settings, { BOARD_THEMES, type BoardThemeKey } from './Settings'
import { WsClient, type OnlineRole, type WsStatus } from './online/wsClient'

type Suggestion = {
  uci: string
  from: Square
  to: Square
  score: number
  san: string
}

type PendingPromotion = {
  from: Square
  to: Square
}

type EngineDownloadState = {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  visible: boolean
  totalFiles?: number
  currentFileLabel?: string
  currentFileIndex?: number
  currentFileTotal?: number | null
  currentFileReceived?: number
  overallTotal?: number | null
  overallReceived?: number
  error?: string | null
}

const ANALYSIS_THINK_TIME_MS = 1200
const DEBUG_MODE = import.meta.env.DEV && import.meta.env.VITE_DEBUG === '1'
const E2E_MODE = import.meta.env.VITE_E2E === '1'
const DEFAULT_WS_URL = (() => {
  const envWsUrl = import.meta.env.VITE_WS_URL
  if (typeof envWsUrl === 'string') {
    const trimmed = envWsUrl.trim()
    if (trimmed) return trimmed
  }
  if (import.meta.env.DEV) return 'ws://localhost:8080/ws'
  const prodUrl = 'wss://vibechess.matthieu-evain.fr/ws'
  if (import.meta.env.PROD) return prodUrl
  if (typeof window === 'undefined') return prodUrl
  const host = window.location.host
  if (!host) return prodUrl
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${host}/ws`
})()
const DEBUG_FEN_STORAGE_KEY = 'vibeChess.debug-fen'
const getCachedDebugFen = () => {
  if (!DEBUG_MODE) return null
  try {
    return localStorage.getItem(DEBUG_FEN_STORAGE_KEY)
  } catch {
    return null
  }
}
const storeDebugFen = (fen: string) => {
  if (!DEBUG_MODE) return
  try {
    localStorage.setItem(DEBUG_FEN_STORAGE_KEY, fen)
  } catch {
    // Ignore storage failures in debug mode.
  }
}
const createGameFromFen = (fen: string) => {
  try {
    const game = new Chess()
    game.load(fen)
    return game
  } catch {
    return null
  }
}

const normalizeGameIdInput = (value: string) => {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const left = cleaned.slice(0, 4)
  const right = cleaned.slice(4, 8)
  if (!right) return left
  return `${left}-${right}`
}

const isValidGameId = (value: string) => /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(value)

const createClientMoveId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `mv_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
}

const promptForDebugFen = (fallbackFen: string) => {
  if (!DEBUG_MODE) return fallbackFen
  const input = window.prompt('Debug FEN (leave empty to reuse previous):', fallbackFen)
  if (input === null) return fallbackFen
  const trimmed = input.trim()
  if (!trimmed) return fallbackFen
  const game = createGameFromFen(trimmed)
  if (!game) {
    window.alert('Invalid FEN. Using previous position.')
    return fallbackFen
  }
  return game.fen()
}

const pickE2EMove = (fen: string) => {
  try {
    const chess = new Chess(fen)
    const moves = chess.moves({ verbose: true }) as Move[]
    if (!moves.length) return null
    const preferred =
      chess.turn() === 'w'
        ? ['e2e4', 'd2d4', 'c2c4', 'g1f3']
        : ['e7e5', 'd7d5', 'c7c5', 'g8f6']
    const moveSet = new Set(
      moves.map((move) => `${move.from}${move.to}${move.promotion ?? ''}`),
    )
    for (const uci of preferred) {
      if (moveSet.has(uci)) return uci
    }
    const first = moves[0]
    return `${first.from}${first.to}${first.promotion ?? ''}`
  } catch {
    return null
  }
}

const buildE2ESuggestions = (fen: string, multiPv: number): Suggestion[] => {
  try {
    const chess = new Chess(fen)
    const moves = chess.moves({ verbose: true }) as Move[]
    return moves.slice(0, multiPv).map((move, idx) => ({
      uci: `${move.from}${move.to}${move.promotion ?? ''}`,
      from: move.from as Square,
      to: move.to as Square,
      score: 100 - idx * 10,
      san: move.san,
    }))
  } catch {
    return []
  }
}

function App() {
  const gameRef = useRef(new Chess())
  const analysisGameRef = useRef<Chess | null>(null)
  const [boardFen, setBoardFen] = useState(gameRef.current.fen())
  const [playerColor, setPlayerColor] = useState<PlayerColor>('white')
  const [colorChoice, setColorChoice] = useState<ColorChoice>('white')
  const [gameMode, setGameMode] = useState<GameMode>('vs-maia')
  const [gameStarted, setGameStarted] = useState(false)
  const [botEngineReady, setBotEngineReady] = useState(false)
  const [botEngineStatus, setBotEngineStatus] = useState('Preparing engines...')
  const [analysisEngineReady, setAnalysisEngineReady] = useState(false)
  const [analysisEngineStatus, setAnalysisEngineStatus] =
    useState('Stockfish waiting for engines...')
  const [engineAssets, setEngineAssets] = useState<EngineAssets | null>(null)
  const [engineDownloadState, setEngineDownloadState] = useState<EngineDownloadState>({
    status: 'idle',
    visible: false,
    error: null,
  })
  const [elo, setElo] = useState<MaiaElo>(MAIA_DEFAULT_ELO)
  const [history, setHistory] = useState<string[]>([])
  const [historyVerbose, setHistoryVerbose] = useState<Move[]>([])
  const [engineThinking, setEngineThinking] = useState(false)
  const [gameOver, setGameOver] = useState<string | null>(null)
  const [boardSize, setBoardSize] = useState(680)
  const [analysisMode, setAnalysisMode] = useState(false)
  const [analysisEntries, setAnalysisEntries] = useState<AnalysisEntry[]>([])
  const [analysisIndex, setAnalysisIndex] = useState(0)
  const [analysisBoardFen, setAnalysisBoardFen] = useState<string | null>(null)
  const [analysisSuggestions, setAnalysisSuggestions] = useState<Suggestion[]>([])
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [showGameOverDialog, setShowGameOverDialog] = useState(false)
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [boardThemeKey, setBoardThemeKey] = useState<BoardThemeKey>('green')
  const [takebackLimit, setTakebackLimit] = useState<number>(Infinity)
  const [takebacksUsed, setTakebacksUsed] = useState(0)
  const [allowEloChangeMidGame, setAllowEloChangeMidGame] = useState(false)
  const [configReady, setConfigReady] = useState(false)
  const [onlineConnection, setOnlineConnection] = useState<WsStatus>('idle')
  const [onlineGameId, setOnlineGameId] = useState<string | null>(null)
  const [onlineRole, setOnlineRole] = useState<OnlineRole | null>(null)
  const [onlinePlayerToken, setOnlinePlayerToken] = useState<string | null>(null)
  const [onlineJoinCode, setOnlineJoinCode] = useState('')
  const [onlineError, setOnlineError] = useState<string | null>(null)
  const [onlineOpponentPresent, setOnlineOpponentPresent] = useState(false)
  const [onlineOpponentEverJoined, setOnlineOpponentEverJoined] = useState(false)
  const [onlineLastSyncFen, setOnlineLastSyncFen] = useState<string | null>(null)
  const [onlineAwaitingSync, setOnlineAwaitingSync] = useState(false)
  const [onlineDesync, setOnlineDesync] = useState(false)
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS_URL)

  // Click-to-move helper state
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null)

  const analysisWorkerRef = useRef<Worker | null>(null)
  const analysisReadyResolvers = useRef<(() => void)[]>([])
  const analysisBestResolver = useRef<((line: string) => void) | null>(null)
  const analysisInfoHandler = useRef<((line: string) => void) | null>(null)
  const analysisInitPromiseRef = useRef<Promise<void> | null>(null)
  const engineBootstrapIdRef = useRef(0)
  const maiaEngineRef = useRef<MaiaEngine | null>(null)
  const boardShellRef = useRef<HTMLDivElement>(null)
  const analysisCacheRef = useRef<Map<string, Suggestion[]>>(new Map())
  const lastRequestedFenRef = useRef<string | null>(null)
  const analysisBusyRef = useRef(false)
  const botRequestIdRef = useRef(0)
  const analysisRequestIdRef = useRef(0)
  const debugInitializedRef = useRef(false)
  const wsClientRef = useRef<WsClient | null>(null)
  const onlineAwaitingSyncRef = useRef(false)
  const onlineDesyncRef = useRef(false)

  const logEngine = useCallback((...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.info('[Stockfish]', ...args)
    }
  }, [ensureEngineAssets])

  useEffect(() => {
    let cancelled = false

    const loadConfig = async () => {
      try {
        const config = await loadPlayerConfig()
        if (cancelled || !config) return
        if (config.gameMode) setGameMode(config.gameMode)
        if (config.colorChoice) setColorChoice(config.colorChoice)
        if (config.elo !== undefined) setElo(config.elo)
        if (config.boardTheme) setBoardThemeKey(config.boardTheme)
        if (config.takebackLimit !== undefined) setTakebackLimit(config.takebackLimit)
        if (config.allowEloChangeMidGame !== undefined) {
          setAllowEloChangeMidGame(config.allowEloChangeMidGame)
        }
        if (config.wsUrl) setWsUrl(config.wsUrl)
      } finally {
        if (!cancelled) setConfigReady(true)
      }
    }

    void loadConfig()
    return () => {
      cancelled = true
    }
  }, [setAllowEloChangeMidGame, setBoardThemeKey, setColorChoice, setElo, setGameMode, setTakebackLimit])

  useEffect(() => {
    if (!configReady) return
    const payload: PlayerConfig = {
      gameMode,
      colorChoice,
      elo,
      boardTheme: boardThemeKey,
      takebackLimit,
      allowEloChangeMidGame,
      wsUrl,
    }
    void savePlayerConfig(payload)
  }, [allowEloChangeMidGame, boardThemeKey, colorChoice, configReady, elo, gameMode, takebackLimit, wsUrl])

  useEffect(() => {
    onlineAwaitingSyncRef.current = onlineAwaitingSync
  }, [onlineAwaitingSync])

  useEffect(() => {
    onlineDesyncRef.current = onlineDesync
  }, [onlineDesync])

  const sendEngine = useCallback((cmd: string) => {
    const worker = analysisWorkerRef.current
    if (!worker) return
    logEngine('>>', cmd)
    worker.postMessage(cmd)
  }, [logEngine])

  const buildAnalysisEntries = () => {
    const verboseHistory =
      historyVerbose.length > 0
        ? historyVerbose
        : (gameRef.current.history({ verbose: true }) as Move[])
    return buildAnalysisEntriesFromVerbose(verboseHistory)
  }

  const setAnalysisPosition = useCallback((fen: string) => {
    analysisGameRef.current = new Chess(fen)
    setAnalysisBoardFen(fen)
    setSelectedSquare(null)
  }, [ensureEngineAssets])

  const waitForAnalysisReady = useCallback(() =>
    new Promise<void>((resolve) => {
      if (!analysisWorkerRef.current) return resolve()
      analysisReadyResolvers.current.push(resolve)
      sendEngine('isready')
    }), [sendEngine])

  const waitForAnalysisIdle = useCallback(async () => {
    while (analysisBusyRef.current) {
      await new Promise((r) => setTimeout(r, 50))
    }
  }, [])

  const initAnalysisEngine = useCallback(() => {
    if (analysisEngineReady && analysisWorkerRef.current) {
      return Promise.resolve()
    }
    if (E2E_MODE) {
      setAnalysisEngineStatus('Stockfish idle (E2E)')
      setAnalysisEngineReady(true)
      return Promise.resolve()
    }
    if (analysisInitPromiseRef.current) {
      return analysisInitPromiseRef.current
    }
    if (!engineAssets) {
      setAnalysisEngineStatus('Stockfish waiting for engines...')
      return Promise.reject(new Error('Engine assets not ready'))
    }

    setAnalysisEngineStatus('Starting Stockfish...')
    analysisInitPromiseRef.current = new Promise<void>((resolve, reject) => {
      let settled = false

      const failInit = (err: unknown) => {
        if (settled) return
        settled = true
        console.error(err)
        setAnalysisEngineStatus('Stockfish failed to start')
        analysisInitPromiseRef.current = null
        reject(err)
      }

      try {
        const worker = new Worker(engineAssets.stockfishJsUrl)
        analysisWorkerRef.current = worker

        worker.onerror = (event) => {
          failInit(event)
        }

        worker.onmessageerror = (event) => {
          failInit(event)
        }

        worker.onmessage = (event: MessageEvent) => {
          const line =
            typeof event.data === 'string' ? event.data : event.data?.toString?.() ?? ''
          if (!line) return

          logEngine('<<', line)

          if (line === 'uciok') {
            setAnalysisEngineStatus('Configuring engine...')
            return
          }

          if (line === 'readyok') {
            const resolvers = analysisReadyResolvers.current
            analysisReadyResolvers.current = []
            resolvers.forEach((resolveReady) => resolveReady())
            setAnalysisEngineReady(true)
            setAnalysisEngineStatus('Stockfish ready')
            if (!settled) {
              settled = true
              resolve()
            }
            return
          }

          if (line.startsWith('info') && analysisInfoHandler.current) {
            analysisInfoHandler.current(line)
          }

          if (line.startsWith('bestmove')) {
            analysisBestResolver.current?.(line)
            analysisBestResolver.current = null
            analysisInfoHandler.current = null
          }
        }

        sendEngine('uci')
        sendEngine('setoption name Threads value 1')
        sendEngine('isready')
      } catch (err) {
        failInit(err)
      }
    })

    return analysisInitPromiseRef.current
  }, [analysisEngineReady, engineAssets, logEngine, sendEngine])

  const requestMultiSuggestions = useCallback(async (fen: string, multiPv = 3, requestId?: number) => {
    if (E2E_MODE) {
      if (requestId !== undefined && analysisRequestIdRef.current !== requestId) return []
      return buildE2ESuggestions(fen, multiPv)
    }
    const suggestions: Suggestion[] = []
    if (!analysisWorkerRef.current) return suggestions
    
    // If we are preempted before even starting
    if (requestId !== undefined && analysisRequestIdRef.current !== requestId) return []

    await waitForAnalysisReady()

    // Double check after waiting
    if (requestId !== undefined && analysisRequestIdRef.current !== requestId) return []

    sendEngine(`setoption name MultiPV value ${multiPv}`)
    sendEngine(`position fen ${fen}`)

    analysisInfoHandler.current = (line: string) => {
      const multiMatch = line.match(
        /multipv\s+(\d+).*score\s+(cp|mate)\s+(-?\d+).*pv\s+([a-h][1-8][a-h][1-8][qrbn]?)/,
      )
      if (!multiMatch) return
      const [, idxStr, type, valueStr, moveUci] = multiMatch
      const score = type === 'cp' ? Number(valueStr) : Number(valueStr) > 0 ? 100000 : -100000
      const san = uciToSan(fen, moveUci)
      suggestions[Number(idxStr) - 1] = {
        uci: moveUci as string,
        from: moveUci.slice(0, 2) as Square,
        to: moveUci.slice(2, 4) as Square,
        score,
        san,
      }
    }

    const bestPromise = new Promise<void>((resolve) => {
      analysisBestResolver.current = () => resolve()
    })

    analysisBusyRef.current = true
    sendEngine(`go movetime ${ANALYSIS_THINK_TIME_MS}`)
    await bestPromise
    analysisBusyRef.current = false

    analysisInfoHandler.current = null
    analysisBestResolver.current = null

    // If we were preempted, don't do cleanup or return potentially partial results if we want strictness.
    // But returning partial results is usually fine. The important thing is skipping cleanup if another request took over.
    if (requestId !== undefined && analysisRequestIdRef.current !== requestId) {
      return suggestions.filter(Boolean).sort((a, b) => b.score - a.score)
    }

    await waitForAnalysisReady()
    sendEngine('setoption name MultiPV value 1')

    return suggestions.filter(Boolean).sort((a, b) => b.score - a.score)
  }, [sendEngine, waitForAnalysisReady])

  const loadAnalysisSuggestions = useCallback(async (fen: string) => {
    if ((!analysisEngineReady && !E2E_MODE) || (!analysisWorkerRef.current && !E2E_MODE)) {
      setAnalysisLoading(false)
      return
    }

    const cached = analysisCacheRef.current.get(fen)
    if (cached) {
      setAnalysisSuggestions(cached)
      setAnalysisLoading(false)
      return
    }

    // Increment ID to invalidate any pending requests
    const requestId = ++analysisRequestIdRef.current

    setAnalysisLoading(true)
    setAnalysisError(null)
    setAnalysisSuggestions([])
    lastRequestedFenRef.current = fen

    // If engine is busy, stop it
    if (analysisBusyRef.current) {
      sendEngine('stop')
    }

    // Wait for it to be free
    await waitForAnalysisIdle()

    // If another request came in while we were waiting, abort this one
    if (analysisRequestIdRef.current !== requestId) return

    try {
      const suggestions = await requestMultiSuggestions(fen, 3, requestId)
      
      // Only update state if we are still the active request
      if (analysisRequestIdRef.current === requestId) {
        analysisCacheRef.current.set(fen, suggestions)
        if (lastRequestedFenRef.current === fen) {
          setAnalysisSuggestions(suggestions)
        }
      }
    } catch (err) {
      console.error(err)
      if (analysisRequestIdRef.current === requestId && lastRequestedFenRef.current === fen) {
        setAnalysisError('Unable to fetch suggestions.')
      }
    } finally {
      if (analysisRequestIdRef.current === requestId && lastRequestedFenRef.current === fen) {
        setAnalysisLoading(false)
      }
    }
  }, [analysisEngineReady, requestMultiSuggestions, sendEngine, waitForAnalysisIdle])

  const requestMaiaMove = useCallback(async (fen: string, eloValue: MaiaElo) => {
    if (!maiaEngineRef.current) return null
    return maiaEngineRef.current.getBestMove(fen, eloValue)
  }, [])

  const enterAnalysisMode = () => {
    if (!history.length) return
    void initAnalysisEngine().catch(() => {
      setAnalysisError('Stockfish failed to start.')
    })
    try {
      const entries = buildAnalysisEntries()
      if (!entries.length) return

      analysisCacheRef.current.clear()
      setAnalysisError(null)
      setAnalysisEntries(entries)
      setAnalysisMode(true)
      setAnalysisIndex(0)
      setAnalysisPosition(entries[0].fen)
      setAnalysisSuggestions(analysisCacheRef.current.get(entries[0].fen) ?? [])
      void loadAnalysisSuggestions(entries[0].fen)
    } catch (err) {
      console.error(err)
      const message =
        err instanceof Error ? err.message : 'Analysis failed: invalid move history.'
      setAnalysisError(message)
    }
  }

  const leaveAnalysisMode = () => {
    setAnalysisMode(false)
    setAnalysisEntries([])
    setAnalysisIndex(0)
    setAnalysisBoardFen(null)
    setAnalysisSuggestions([])
    setAnalysisLoading(false)
    setAnalysisError(null)
    setSelectedSquare(null)
    analysisGameRef.current = null
    analysisCacheRef.current.clear()
  }

  const goToAnalysisIndex = useCallback((nextIndex: number) => {
    if (!analysisMode) return
    if (!analysisEntries.length) return
    const safeIndex = clamp(nextIndex, 0, analysisEntries.length - 1)
    const entry = analysisEntries[safeIndex]
    if (!entry) return
    setAnalysisIndex(safeIndex)
    setAnalysisPosition(entry.fen)
    setAnalysisSuggestions(analysisCacheRef.current.get(entry.fen) ?? [])
    void loadAnalysisSuggestions(entry.fen)
  }, [analysisMode, analysisEntries, setAnalysisPosition, loadAnalysisSuggestions])

  const resetAnalysisPosition = () => {
    if (!analysisMode) return
    const entry = analysisEntries[analysisIndex]
    if (!entry) return
    setAnalysisPosition(entry.fen)
    setAnalysisSuggestions(analysisCacheRef.current.get(entry.fen) ?? [])
    void loadAnalysisSuggestions(entry.fen)
  }

  const makeAnalysisMove = (from: Square, to: Square): boolean => {
    if (!analysisGameRef.current) return false
    // Check if it's the same square (cancel selection)
    if (from === to) return false

    const attempt = () => analysisGameRef.current?.move({ from, to })
    const withPromotion = () => analysisGameRef.current?.move({ from, to, promotion: 'q' })
    const move = attempt() || withPromotion()
    if (!move) return false
    setAnalysisBoardFen(analysisGameRef.current.fen())
    setSelectedSquare(null)
    return true
  }

  const stopGame = useCallback(() => {
    if (analysisBusyRef.current) {
      sendEngine('stop')
    }
    botRequestIdRef.current++
    maiaEngineRef.current?.stop()
    analysisRequestIdRef.current++
    setGameOver(null)
    setShowGameOverDialog(false)
    setEngineThinking(false)
    setGameStarted(false)
    setPendingPromotion(null)
    setSelectedSquare(null)
    setTakebacksUsed(0)
  }, [sendEngine])

  const loadOnlineFen = useCallback((fen: string) => {
    try {
      const game = new Chess()
      game.load(fen)

      if (analysisBusyRef.current) {
        sendEngine('stop')
      }
      botRequestIdRef.current++
      maiaEngineRef.current?.stop()
      analysisRequestIdRef.current++

      gameRef.current = game
      setBoardFen(game.fen())
      setHistory([])
      setHistoryVerbose([])
      setGameOver(null)
      setAnalysisMode(false)
      setSelectedSquare(null)
      setPendingPromotion(null)
      setEngineThinking(false)
      setGameStarted(true)
      setTakebacksUsed(0)
      setAnalysisEntries([])
      setAnalysisIndex(0)
      setAnalysisBoardFen(null)
      setAnalysisSuggestions([])
      setAnalysisLoading(false)
      setAnalysisError(null)
      analysisGameRef.current = null
      analysisCacheRef.current.clear()
      return true
    } catch {
      return false
    }
  }, [sendEngine])

  const startOnlineGame = useCallback(() => {
    const game = new Chess()
    if (analysisBusyRef.current) {
      sendEngine('stop')
    }
    botRequestIdRef.current++
    maiaEngineRef.current?.stop()
    analysisRequestIdRef.current++

    gameRef.current = game
    setBoardFen(game.fen())
    setHistory([])
    setHistoryVerbose([])
    setGameOver(null)
    setAnalysisMode(false)
    setSelectedSquare(null)
    setPendingPromotion(null)
    setEngineThinking(false)
    setGameStarted(true)
    setTakebacksUsed(0)
    setAnalysisEntries([])
    setAnalysisIndex(0)
    setAnalysisBoardFen(null)
    setAnalysisSuggestions([])
    setAnalysisLoading(false)
    setAnalysisError(null)
    analysisGameRef.current = null
    analysisCacheRef.current.clear()
  }, [sendEngine])

  const applyMove = useCallback((from: Square, to: Square, promotion?: PieceSymbol) => {
    const move = gameRef.current.move({ from, to, promotion })
    if (!move) return false
    setBoardFen(gameRef.current.fen())
    setHistory(gameRef.current.history())
    setHistoryVerbose(gameRef.current.history({ verbose: true }) as Move[])
    setSelectedSquare(null)

    const over = buildGameOverText(gameRef.current)
    if (over) setGameOver(over)
    return true
  }, [])

  const sendOnlineMove = useCallback((from: Square, to: Square, promotion?: PieceSymbol) => {
    if (!onlineGameId || !onlinePlayerToken) {
      setOnlineError('Connexion manquante')
      return false
    }
    if (onlineConnection !== 'connected') {
      setOnlineError('Connexion interrompue')
      return false
    }
    const clientMoveId = createClientMoveId()
    wsClientRef.current?.send('move', {
      gameId: onlineGameId,
      playerToken: onlinePlayerToken,
      from,
      to,
      promotion,
      clientMoveId,
    })
    wsClientRef.current?.send('state_sync', {
      gameId: onlineGameId,
      playerToken: onlinePlayerToken,
      fen: gameRef.current.fen(),
    })
    return true
  }, [onlineConnection, onlineGameId, onlinePlayerToken])

  const applyLocalMove = useCallback((from: Square, to: Square, promotion?: PieceSymbol) => {
    const applied = applyMove(from, to, promotion)
    if (!applied) {
      return false
    }
    if (gameMode === 'online') {
      sendOnlineMove(from, to, promotion)
      setOnlineError(null)
    }
    return true
  }, [applyMove, gameMode, sendOnlineMove])

  const startNewGame = useCallback((color: PlayerColor = 'white') => {
    // Stop any running analysis
    if (analysisBusyRef.current) {
      sendEngine('stop')
    }
    botRequestIdRef.current++
    maiaEngineRef.current?.stop()
    // Invalidate pending analysis requests
    analysisRequestIdRef.current++

    let nextGame = new Chess()
    let nextFen = nextGame.fen()
    const nextColor: PlayerColor = DEBUG_MODE ? 'white' : color

    if (DEBUG_MODE) {
      const cachedFen = getCachedDebugFen()
      const cachedGame = cachedFen ? createGameFromFen(cachedFen) : null
      const fallbackGame = cachedGame ?? nextGame
      const fallbackFen = fallbackGame.fen()
      const chosenFen = promptForDebugFen(fallbackFen)
      const chosenGame = createGameFromFen(chosenFen)
      if (chosenGame) {
        nextGame = chosenGame
        nextFen = chosenGame.fen()
        storeDebugFen(nextFen)
      } else {
        nextGame = fallbackGame
        nextFen = fallbackFen
      }
    }

    gameRef.current = nextGame
    setBoardFen(nextFen)
    setHistory([])
    setHistoryVerbose([])
    setGameOver(null)
    setAnalysisMode(false)
    setPlayerColor(nextColor)
    setEngineThinking(false)
    setSelectedSquare(null)
    setAnalysisEntries([])
    setAnalysisIndex(0)
    setAnalysisBoardFen(null)
    setAnalysisSuggestions([])
    setAnalysisLoading(false)
    setAnalysisError(null)
    setPendingPromotion(null)
    setGameStarted(true)
    setTakebacksUsed(0)
    analysisGameRef.current = null
    analysisCacheRef.current.clear()
  }, [sendEngine])

  useEffect(() => {
    const client = new WsClient()
    wsClientRef.current = client

    const session = client.getSession()
    if (session) {
      setOnlineGameId(session.gameId)
      setOnlineRole(session.role)
      setOnlinePlayerToken(session.playerToken)
    }

    const offStatus = client.onStatus((status) => {
      setOnlineConnection(status)
      if (status === 'connected') {
        setOnlineError(null)
      }
    })

    const offGameCreated = client.on('game_created', (payload) => {
      startOnlineGame()
      setOnlineGameId(payload.gameId)
      setOnlineRole(payload.role)
      setOnlinePlayerToken(payload.playerToken)
      setOnlineOpponentPresent(false)
      setOnlineOpponentEverJoined(false)
      onlineAwaitingSyncRef.current = false
      setOnlineAwaitingSync(false)
      setOnlineDesync(false)
      setOnlineLastSyncFen(null)
      setOnlineError(null)
    })

    const offGameJoined = client.on('game_joined', (payload) => {
      startOnlineGame()
      setOnlineGameId(payload.gameId)
      setOnlineRole(payload.role)
      setOnlinePlayerToken(payload.playerToken)
      setOnlineOpponentPresent(true)
      setOnlineOpponentEverJoined(true)
      onlineAwaitingSyncRef.current = true
      setOnlineAwaitingSync(true)
      setOnlineDesync(false)
      setOnlineLastSyncFen(null)
      setOnlineError(null)
    })

    const offReconnected = client.on('reconnected', (payload) => {
      const stored = client.getSession()
      startOnlineGame()
      setOnlineGameId(payload.gameId)
      setOnlineRole(payload.role)
      setOnlinePlayerToken(stored?.playerToken ?? null)
      setOnlineOpponentPresent(false)
      setOnlineOpponentEverJoined(false)
      onlineAwaitingSyncRef.current = true
      setOnlineAwaitingSync(true)
      setOnlineDesync(false)
      setOnlineLastSyncFen(null)
      setOnlineError(null)
    })

    const offOpponentJoined = client.on('opponent_joined', () => {
      setOnlineOpponentPresent(true)
      setOnlineOpponentEverJoined(true)
    })

    const offOpponentLeft = client.on('opponent_left', () => {
      setOnlineOpponentPresent(false)
    })

    const offStateSync = client.on('state_sync', (payload) => {
      setOnlineLastSyncFen(payload.fen)
      if (onlineAwaitingSyncRef.current) {
        const applied = loadOnlineFen(payload.fen)
        if (applied) {
          onlineAwaitingSyncRef.current = false
          onlineDesyncRef.current = false
          setOnlineAwaitingSync(false)
          setOnlineDesync(false)
        }
      }
    })

    const offOpponentMove = client.on('opponent_move', (payload) => {
      if (onlineDesyncRef.current) return
      const promotion = payload.promotion ? (payload.promotion as PieceSymbol) : undefined
      const applied = applyMove(payload.from as Square, payload.to as Square, promotion)
      if (!applied) {
        setOnlineDesync(true)
        setOnlineError('Désynchronisation détectée')
        return
      }
      setOnlineError(null)
    })

    const offError = client.on('error', (payload) => {
      setOnlineError(payload.message)
    })

    return () => {
      offStatus()
      offGameCreated()
      offGameJoined()
      offReconnected()
      offOpponentJoined()
      offOpponentLeft()
      offStateSync()
      offOpponentMove()
      offError()
      client.disconnect()
      wsClientRef.current = null
    }
  }, [applyMove, loadOnlineFen, startOnlineGame])

  useEffect(() => {
    if (gameMode === 'online') {
      wsClientRef.current?.connect(wsUrl)
      const session = wsClientRef.current?.getSession()
      if (session) {
        setOnlineGameId(session.gameId)
        setOnlineRole(session.role)
        setOnlinePlayerToken(session.playerToken)
        onlineAwaitingSyncRef.current = true
        setOnlineAwaitingSync(true)
      }
      return
    }

    wsClientRef.current?.disconnect()
    setOnlineConnection('idle')
    setOnlineOpponentPresent(false)
    setOnlineOpponentEverJoined(false)
    setOnlineAwaitingSync(false)
    setOnlineDesync(false)
    setOnlineError(null)
  }, [gameMode])

  const clearOnlineSession = useCallback(() => {
    wsClientRef.current?.clearSession()
    setOnlineGameId(null)
    setOnlineRole(null)
    setOnlinePlayerToken(null)
    setOnlineOpponentPresent(false)
    setOnlineOpponentEverJoined(false)
    setOnlineAwaitingSync(false)
    setOnlineDesync(false)
    setOnlineLastSyncFen(null)
    setGameStarted(false)
    setGameOver(null)
  }, [])

  const leaveOnlineGame = useCallback(() => {
    clearOnlineSession()
    wsClientRef.current?.clearSession()
  }, [clearOnlineSession])

  const createOnlineGame = useCallback(() => {
    clearOnlineSession()
    setOnlineError(null)
    wsClientRef.current?.connect(wsUrl)
    wsClientRef.current?.send('create_game', {})
  }, [clearOnlineSession, wsUrl])

  const joinOnlineGame = useCallback(() => {
    const normalized = normalizeGameIdInput(onlineJoinCode)
    if (!isValidGameId(normalized)) {
      setOnlineError('Code de partie invalide')
      return
    }
    clearOnlineSession()
    setOnlineError(null)
    wsClientRef.current?.connect(wsUrl)
    wsClientRef.current?.send('join_game', { gameId: normalized })
  }, [clearOnlineSession, onlineJoinCode, wsUrl])

  const handleCopyGameId = useCallback(() => {
    if (!onlineGameId) return
    if (!navigator?.clipboard?.writeText) {
      setOnlineError('Clipboard indisponible')
      return
    }
    navigator.clipboard
      .writeText(onlineGameId)
      .catch(() => setOnlineError('Impossible de copier le code'))
  }, [onlineGameId])

  const handleResync = useCallback(() => {
    if (!onlineLastSyncFen) {
      setOnlineError('Aucun état synchronisé disponible')
      return
    }
    const applied = loadOnlineFen(onlineLastSyncFen)
    if (!applied) {
      setOnlineError('Resync impossible')
      return
    }
    onlineAwaitingSyncRef.current = false
    onlineDesyncRef.current = false
    setOnlineAwaitingSync(false)
    setOnlineDesync(false)
    setOnlineError(null)
  }, [loadOnlineFen, onlineLastSyncFen])

  const handleJoinCodeChange = useCallback((value: string) => {
    setOnlineJoinCode(normalizeGameIdInput(value))
    setOnlineError(null)
  }, [])

  const getPromotionMove = (game: Chess, from: Square, to: Square) => {
    const legalMoves = game.moves({ verbose: true }) as Move[]
    return legalMoves.find((mv) => mv.from === from && mv.to === to) ?? null
  }

  const onDrop = (sourceSquare: Square, targetSquare: Square) => {
    if (analysisMode) {
      return makeAnalysisMove(sourceSquare, targetSquare)
    }
    if (!gameStarted || gameOver || engineThinking || pendingPromotion) return false
    if (gameMode === 'online') {
      if (onlineDesync) {
        setOnlineError('Désynchronisation détectée')
        return false
      }
      if (onlineConnection !== 'connected') {
        setOnlineError('Connexion interrompue')
        return false
      }
      if (onlineAwaitingSync) {
        setOnlineError('Synchronisation en cours')
        return false
      }
      if (!onlineRole) {
        setOnlineError('Rôle en attente')
        return false
      }
      if (!onlineOpponentPresent) {
        setOnlineError('En attente de l\'adversaire')
        return false
      }
      const expectedTurn = onlineRole === 'white' ? 'w' : 'b'
      if (gameRef.current.turn() !== expectedTurn) {
        setOnlineError('Ce n\'est pas votre tour')
        return false
      }
    } else if (gameMode !== '1v1') {
      // In 1v1 mode, both colors can move; in vs-maia mode, only playerColor can move
      if (gameRef.current.turn() === (playerColor === 'white' ? 'b' : 'w')) return false
    }

    try {
      const legalMove = getPromotionMove(gameRef.current, sourceSquare, targetSquare)
      if (!legalMove) {
        return false
      }

      if (legalMove.promotion) {
        setPendingPromotion({
          from: sourceSquare,
          to: targetSquare,
        })
        setSelectedSquare(null)
        return false
      }

      return applyLocalMove(sourceSquare, targetSquare)
    } catch {
      return false
    }
  }

  const handleSquareClick = ({ square }: { piece: { pieceType: string } | null; square: string }) => {
    if (pendingPromotion) return
    const squareTyped = square as Square
    if (analysisMode) {
      if (selectedSquare && selectedSquare !== squareTyped) {
        const moved = makeAnalysisMove(selectedSquare, squareTyped)
        if (moved) return
      }
      const currentPiece = analysisGameRef.current?.get(squareTyped)
      if (currentPiece && currentPiece.color === analysisGameRef.current?.turn()) {
        setSelectedSquare(squareTyped)
      } else {
        setSelectedSquare(null)
      }
      return
    }

    if (!gameStarted || gameOver || engineThinking) return
    if (gameMode === 'online') {
      if (onlineDesync) {
        setOnlineError('Désynchronisation détectée')
        return
      }
      if (onlineConnection !== 'connected') {
        setOnlineError('Connexion interrompue')
        return
      }
      if (onlineAwaitingSync) {
        setOnlineError('Synchronisation en cours')
        return
      }
      if (!onlineRole) return
      if (!onlineOpponentPresent) return
      const expectedTurn = onlineRole === 'white' ? 'w' : 'b'
      if (gameRef.current.turn() !== expectedTurn) {
        setOnlineError('Ce n\'est pas votre tour')
        return
      }
    } else if (gameMode === 'vs-maia') {
      // In vs-maia mode, only playerColor can move
      if (gameRef.current.turn() === (playerColor === 'white' ? 'b' : 'w')) return
    }

    if (selectedSquare) {
      const move = onDrop(selectedSquare, squareTyped)
      if (move) return
    }

    const currentPiece = gameRef.current.get(squareTyped)
    // In 1v1 mode, allow selecting any piece of the current turn's color
    const currentTurn = gameRef.current.turn()
    const canSelectPiece = gameMode === '1v1'
      ? currentPiece && currentPiece.color === currentTurn
      : gameMode === 'online'
        ? currentPiece && onlineRole && currentPiece.color === (onlineRole === 'white' ? 'w' : 'b')
        : currentPiece && currentPiece.color === (playerColor === 'white' ? 'w' : 'b')
    
    if (canSelectPiece) {
      setSelectedSquare(squareTyped)
    } else {
      setSelectedSquare(null)
    }
  }

  const fenToShow = analysisMode && analysisBoardFen ? analysisBoardFen : boardFen
    
  const isInCheck = useMemo(() => {
    try {
      const chess = new Chess(fenToShow)
      return chess.inCheck()
    } catch {
      return false
    }
  }, [fenToShow])

  const inCheckSquare = useMemo(() => {
    try {
      const chess = new Chess(fenToShow)
      if (!chess.inCheck()) return null
      return findKingSquare(chess, chess.turn())
    } catch {
      return null
    }
  }, [fenToShow])

  const onlineCanMove = useMemo(() => {
    if (gameMode !== 'online') return false
    if (!gameStarted) return false
    if (onlineConnection !== 'connected') return false
    if (onlineAwaitingSync) return false
    if (onlineDesync) return false
    if (!onlineRole) return false
    if (!onlineOpponentPresent) return false
    return gameRef.current.turn() === (onlineRole === 'white' ? 'w' : 'b')
  }, [boardFen, gameMode, gameStarted, onlineAwaitingSync, onlineConnection, onlineDesync, onlineOpponentPresent, onlineRole])

  const boardAreaRef = useRef<HTMLElement>(null)

  const startEngineBootstrap = useCallback(() => {
    const requestId = ++engineBootstrapIdRef.current
    setEngineAssets(null)
    setEngineDownloadState({ status: 'checking', visible: false, error: null })
    setBotEngineReady(false)
    setBotEngineStatus('Preparing engines...')
    setAnalysisEngineReady(false)
    setAnalysisEngineStatus('Stockfish waiting for engines...')
    analysisInitPromiseRef.current = null
    if (analysisWorkerRef.current) {
      analysisWorkerRef.current.terminate()
      analysisWorkerRef.current = null
    }

    const handleEvent = (event: EngineDownloadEvent) => {
      if (engineBootstrapIdRef.current !== requestId) return
      if (event.type === 'start') {
        setEngineDownloadState({
          status: 'downloading',
          visible: true,
          totalFiles: event.totalFiles,
          overallTotal: event.totalBytes,
          overallReceived: 0,
          error: null,
        })
        setBotEngineStatus('Downloading engines...')
        setAnalysisEngineStatus('Stockfish downloading...')
        return
      }
      if (event.type === 'progress') {
        setEngineDownloadState((prev) => ({
          ...prev,
          status: 'downloading',
          visible: true,
          totalFiles: event.file.totalFiles,
          currentFileLabel: event.file.label,
          currentFileIndex: event.file.index,
          currentFileTotal: event.file.totalBytes,
          currentFileReceived: event.file.receivedBytes,
          overallTotal: event.overall.totalBytes,
          overallReceived: event.overall.receivedBytes,
          error: null,
        }))
        return
      }
      if (event.type === 'error') {
        setEngineDownloadState({
          status: 'error',
          visible: true,
          error: event.message,
        })
        setBotEngineStatus('Engine download failed')
        setAnalysisEngineStatus('Stockfish download failed')
        return
      }
      if (event.type === 'done') {
        setEngineDownloadState((prev) => ({
          ...prev,
          status: 'ready',
          visible: false,
          error: null,
        }))
      }
    }

    ensureEngineAssets(handleEvent)
      .then((result) => {
        if (engineBootstrapIdRef.current !== requestId) return
        setEngineAssets(result.assets)
        setEngineDownloadState((prev) => ({
          ...prev,
          status: 'ready',
          visible: false,
          error: null,
        }))
        setAnalysisEngineStatus('Stockfish idle')
      })
      .catch((err) => {
        if (engineBootstrapIdRef.current !== requestId) return
        const message = err instanceof Error ? err.message : String(err)
        setEngineDownloadState({
          status: 'error',
          visible: true,
          error: message,
        })
        setBotEngineStatus('Engine download failed')
        setAnalysisEngineStatus('Stockfish download failed')
      })
  }, [ensureEngineAssets])

  useEffect(() => {
    startEngineBootstrap()
  }, [startEngineBootstrap])

  useEffect(() => {
    const updateSize = () => {
      if (!boardAreaRef.current) return
      const width = boardAreaRef.current.clientWidth
      const height = boardAreaRef.current.clientHeight
      const size = Math.min(width, height) - 40 // 20px padding on each side
      setBoardSize(Math.min(size, 800)) // Cap at 800px
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  useEffect(() => {
    if (!DEBUG_MODE || debugInitializedRef.current) return
    debugInitializedRef.current = true
    startNewGame('white')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    analysisWorkerRef.current?.terminate()
  }, [])

  useEffect(() => {
    if (!engineAssets) return
    let cancelled = false
    setBotEngineReady(false)
    setBotEngineStatus('Starting Maia...')
    if (E2E_MODE) {
      maiaEngineRef.current = {
        getBestMove: async (fen: string) => pickE2EMove(fen),
        stop: () => {},
        quit: () => {},
      }
      setBotEngineReady(true)
      setBotEngineStatus('Maia ready (E2E)')
      return () => {
        maiaEngineRef.current = null
      }
    }
    setMaiaAssetPaths({
      zerofishJsUrl: engineAssets.zerofishJsUrl,
      zerofishWasmUrl: engineAssets.zerofishWasmUrl,
      weightsBaseUrl: engineAssets.maiaBaseUrl,
    })

    getMaiaEngine()
      .then((engine) => {
        if (cancelled) {
          engine.stop()
          return
        }
        maiaEngineRef.current = engine
        setBotEngineReady(true)
        setBotEngineStatus('Maia ready')
      })
      .catch((err) => {
        console.error(err)
        if (!cancelled) {
          const message =
            err instanceof Error ? `Maia failed to start: ${err.message}` : 'Maia failed to start'
          setBotEngineStatus(message)
        }
      })

    return () => {
      cancelled = true
      maiaEngineRef.current?.stop()
    }
  }, [engineAssets])

  useEffect(() => {
    if (!analysisMode || !analysisBoardFen) return
    void loadAnalysisSuggestions(analysisBoardFen)
  }, [analysisMode, analysisBoardFen, loadAnalysisSuggestions])

  useEffect(() => {
    if (!analysisMode) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goToAnalysisIndex(analysisIndex - 1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        goToAnalysisIndex(analysisIndex + 1)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [analysisMode, analysisIndex, analysisEntries.length, goToAnalysisIndex])

  useEffect(() => {
    if (gameOver) {
      setShowGameOverDialog(true)
      setGameStarted(false)
    } else {
      setShowGameOverDialog(false)
    }
  }, [gameOver])

  useEffect(() => {
    // Maia only plays in vs-maia mode
    if (gameMode !== 'vs-maia') return
    if (!gameStarted || gameOver || !botEngineReady || analysisMode || engineThinking) return
    if (gameRef.current.turn() === (playerColor === 'white' ? 'b' : 'w')) {
      if (!maiaEngineRef.current) return
      setEngineThinking(true)
      const requestId = ++botRequestIdRef.current
      const snappedElo = snapMaiaElo(elo)
      requestMaiaMove(gameRef.current.fen(), snappedElo)
        .then((move) => {
          if (botRequestIdRef.current !== requestId) return
          if (move) {
            try {
              const promotion = move.length > 4 ? (move[4] as PieceSymbol) : undefined
              if (promotion) {
                console.info('[Maia]', 'Promotion chosen:', promotion, 'with', move)
              }
              gameRef.current.move({
                from: move.slice(0, 2) as Square,
                to: move.slice(2, 4) as Square,
                promotion,
              })
              setBoardFen(gameRef.current.fen())
              setHistory(gameRef.current.history())
              setHistoryVerbose(gameRef.current.history({ verbose: true }) as Move[])

              const over = buildGameOverText(gameRef.current)
              if (over) setGameOver(over)
            } catch (e) {
              console.error('Maia made invalid move:', move, e)
            }
          }
        })
        .catch((err) => {
          console.error(err)
          const message = err instanceof Error ? err.message : String(err)
          if (message.toLowerCase().includes('oom')) {
            setBotEngineStatus('Maia crashed (OOM). Reload the app to recover.')
            setBotEngineReady(false)
          }
        })
        .finally(() => {
          if (botRequestIdRef.current === requestId) {
            setEngineThinking(false)
          }
        })
    }
  }, [boardFen, botEngineReady, gameOver, analysisMode, gameStarted, playerColor, elo, requestMaiaMove, engineThinking, gameMode])

  const turnText = useMemo(() => {
    if (analysisMode) {
      try {
        const chess = new Chess(fenToShow)
        const turn = chess.turn() === 'w' ? 'White' : 'Black'
        const currentEntry = analysisEntries[analysisIndex]
        const moveCountText =
          analysisEntries.length > 0 ? `${analysisIndex + 1}/${analysisEntries.length}` : ''
        const playedText = currentEntry?.playedMove?.san
          ? `Played move: ${currentEntry.playedMove.san}`
          : 'Reached end of game'
        const checkText = chess.inCheck() ? ' (Check!)' : ''
        return `Analysis ${moveCountText} - ${turn} to move${checkText} - ${playedText}`
      } catch {
        return 'Analyzing...'
      }
    }

    if (!gameStarted) {
      if (gameMode === 'online') return 'Create or join an online game'
      return gameMode === '1v1' ? 'Select 1v1 mode, then start the game' : 'Choose your color, then start the game'
    }
    if (gameMode === 'online') {
      if (onlineConnection === 'connecting' || onlineConnection === 'reconnecting') {
        return 'Connecting...'
      }
      if (onlineConnection !== 'connected') return 'Disconnected'
      if (onlineDesync) return 'Desync detected'
      if (onlineAwaitingSync) return 'Syncing...'
      if (!onlineOpponentPresent) {
        return onlineOpponentEverJoined ? 'Opponent left' : 'Waiting opponent'
      }
      if (gameOver) return gameOver
      const checkText = isInCheck ? ' (Check!)' : ''
      const isYourTurn =
        onlineRole && gameRef.current.turn() === (onlineRole === 'white' ? 'w' : 'b')
      return isYourTurn ? `Your turn${checkText}` : `Opponent turn${checkText}`
    }
    if (gameOver) return gameOver
    if (gameMode === '1v1') {
      const turn = gameRef.current.turn() === 'w' ? 'White' : 'Black'
      const checkText = isInCheck ? ' (Check!)' : ''
      return `${turn} to move${checkText}`
    }
    if (!botEngineReady) return 'Maia getting ready...'
    if (engineThinking) return 'Maia is thinking...'
    const turn = gameRef.current.turn() === 'w' ? 'White' : 'Black'
    const checkText = isInCheck ? ' (Check!)' : ''
    return `${turn} to move${checkText}`
  }, [analysisMode, fenToShow, analysisEntries, analysisIndex, botEngineReady, engineThinking, gameStarted, gameOver, isInCheck, gameMode, onlineAwaitingSync, onlineConnection, onlineDesync, onlineOpponentEverJoined, onlineOpponentPresent, onlineRole])

  const onlineStatusText = useMemo(() => {
    if (onlineConnection === 'connecting' || onlineConnection === 'reconnecting') return 'Connecting...'
    if (onlineConnection === 'disconnected') return 'Disconnected'
    if (onlineConnection === 'idle') return 'Idle'
    if (onlineDesync) return 'Desync detected'
    if (onlineAwaitingSync) return 'Syncing...'
    if (!onlineGameId) return 'Connected'
    if (!onlineOpponentPresent) {
      return onlineOpponentEverJoined ? 'Opponent left' : 'Waiting opponent'
    }
    if (!onlineRole) return 'Syncing...'
    const isYourTurn =
      gameRef.current.turn() === (onlineRole === 'white' ? 'w' : 'b')
    return isYourTurn ? 'Your turn' : 'Opponent turn'
  }, [boardFen, onlineAwaitingSync, onlineConnection, onlineDesync, onlineGameId, onlineOpponentEverJoined, onlineOpponentPresent, onlineRole])

  const onlineConnectionText = useMemo(() => {
    if (onlineConnection === 'connecting' || onlineConnection === 'reconnecting') return 'Connecting...'
    if (onlineConnection === 'disconnected') return 'Disconnected'
    if (onlineConnection === 'idle') return ''
    if (onlineDesync) return 'Desync detected'
    if (onlineAwaitingSync) return 'Syncing...'
    return ''
  }, [onlineAwaitingSync, onlineConnection, onlineDesync])

  const onlineStatusDotTone = useMemo(() => {
    if (onlineConnection === 'disconnected') return 'error'
    if (onlineConnection === 'connected') return 'ok'
    return 'warn'
  }, [onlineConnection])

  const onlinePresenceText = useMemo(() => {
    if (!onlineGameId) return 'Idle'
    if (onlineOpponentPresent) return 'Opponent connected'
    if (onlineOpponentEverJoined) return 'Opponent left'
    return 'Waiting for opponent'
  }, [onlineGameId, onlineOpponentEverJoined, onlineOpponentPresent])

  const onlineTurnText = useMemo(() => {
    if (onlineConnection !== 'connected') return ''
    if (onlineDesync || onlineAwaitingSync) return ''
    if (!onlineGameId || !onlineOpponentPresent || !onlineRole) return ''
    const isYourTurn = gameRef.current.turn() === (onlineRole === 'white' ? 'w' : 'b')
    return isYourTurn ? 'Your turn' : 'Opponent turn'
  }, [boardFen, onlineAwaitingSync, onlineConnection, onlineDesync, onlineGameId, onlineOpponentPresent, onlineRole])

  const onlineTurnTone = onlineTurnText
    ? (onlineTurnText === 'Your turn' ? 'accent' : 'neutral')
    : undefined

  const onlineStatusDetail = useMemo(() => {
    if (onlineConnectionText) return onlineConnectionText
    return onlinePresenceText
  }, [onlineConnectionText, onlinePresenceText])

  const statusText = useMemo(() => {
    if (gameMode === 'online') return onlineStatusText
    if (!botEngineReady) return botEngineStatus
    if (!analysisEngineReady) return `Maia ready - ${analysisEngineStatus}`
    return 'Engines ready'
  }, [analysisEngineReady, analysisEngineStatus, botEngineReady, botEngineStatus, gameMode, onlineStatusText])

  const sidebarStatusOk = useMemo(() => {
    if (gameMode === 'online') return onlineConnection === 'connected'
    if (gameMode === '1v1') return true
    return botEngineReady
  }, [botEngineReady, gameMode, onlineConnection])

  const startGameFromSelection = useCallback(() => {
    if (gameMode === 'online') return
    const resolvedColor =
      colorChoice === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : colorChoice
    startNewGame(resolvedColor)
  }, [colorChoice, gameMode, startNewGame])

  const handleColorChange = (color: ColorChoice) => {
    if (DEBUG_MODE) return
    if (gameStarted) return
    setColorChoice(color)
  }

  const handleGameModeChange = (mode: GameMode) => {
    if (DEBUG_MODE) return
    if (gameStarted) return
    setGameMode(mode)
    setOnlineError(null)
  }

  const handleEloChange = (value: number) => {
    setElo(snapMaiaElo(value))
  }

  const formattedHistory = useMemo(() => {
    const pairs: { moveNumber: number; white?: string; black?: string }[] = []
    const sanHistory = history
    for (let i = 0; i < sanHistory.length; i += 2) {
      pairs.push({
        moveNumber: i / 2 + 1,
        white: sanHistory[i],
        black: sanHistory[i + 1],
      })
    }
    return pairs
  }, [history])

  const currentHistoryIndex = useMemo(() => {
    if (!analysisMode || history.length === 0) return -1
    if (analysisIndex === 0) return -1
    return analysisIndex - 1
  }, [analysisIndex, analysisMode, history.length])

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {}
    if (selectedSquare) {
      styles[selectedSquare] = {
        backgroundColor: 'rgba(255, 255, 0, 0.35)',
      }
    }
    if (inCheckSquare) {
      styles[inCheckSquare] = {
        backgroundColor: 'rgba(255, 107, 107, 0.3)',
        boxShadow: 'inset 0 0 0 4px rgba(255, 107, 107, 0.85)',
      }
    }
    return styles
  }, [selectedSquare, inCheckSquare])

  const analysisArrows = useMemo(() => {
    if (!analysisMode || !analysisBoardFen) return []
    const currentEntry = analysisEntries[analysisIndex]
    const scores = analysisSuggestions.map((s) => s.score)
    const maxScore = scores.length ? Math.max(...scores) : 1
    const minScore = scores.length ? Math.min(...scores) : 0
    const span = Math.max(maxScore - minScore, 1)

    const arrows: ArrowToDraw[] = analysisSuggestions.map((suggestion) => {
      const weight = (suggestion.score - minScore) / span
      const multiplyer = 7
      const width = multiplyer + weight * multiplyer // More reasonable width (5 to 10px)
      // All Stockfish suggestions in green/accent with varying opacity by strength
      const color = 'var(--accent)'
      return {
        from: suggestion.from,
        to: suggestion.to,
        color,
        width,
        opacity: 0.5 + weight * 0.5,
      }
    })

    if (currentEntry?.playedMove && analysisBoardFen === currentEntry.fen) {
      arrows.push({
        from: currentEntry.playedMove.from,
        to: currentEntry.playedMove.to,
        color: '#ffad71', // Distinct orange for the played move
        width: 6,
        opacity: 1,
      })
    }

    return arrows
  }, [analysisBoardFen, analysisEntries, analysisIndex, analysisMode, analysisSuggestions])

  const engineAssetsReady = Boolean(engineAssets)
  const analysisAvailable = gameMode !== 'online' && history.length > 0 && engineAssetsReady
  const currentAnalysisEntry = analysisEntries[analysisIndex]
  const isExploringVariant =
    analysisMode && currentAnalysisEntry && analysisBoardFen !== currentAnalysisEntry.fen
  const analysisTurnLabel = useMemo(() => {
    if (!analysisMode) return ''
    try {
      const chess = new Chess(fenToShow)
      return chess.turn() === 'w' ? 'White' : 'Black'
    } catch {
      return ''
    }
  }, [analysisMode, fenToShow])

  const boardTheme = BOARD_THEMES[boardThemeKey] ?? BOARD_THEMES.green
  const appThemeStyle = useMemo(
    () =>
      ({
        '--square-light': boardTheme.light,
        '--square-dark': boardTheme.dark,
      }) as CSSProperties,
    [boardTheme],
  )
  const remainingTakebacks =
    takebackLimit === Infinity ? Infinity : Math.max(0, takebackLimit - takebacksUsed)
  const canTakeback =
    gameStarted &&
    gameMode !== 'online' &&
    !analysisMode &&
    !engineThinking &&
    history.length > 0 &&
    (takebackLimit === Infinity || takebacksUsed < takebackLimit)
  const promotionPieceTypes = useMemo(() => {
    // In 1v1 mode, use the current turn's color; otherwise use the active player color.
    const currentColor = gameMode === '1v1'
      ? gameRef.current.turn()
      : gameMode === 'online' && onlineRole
        ? (onlineRole === 'white' ? 'w' : 'b')
        : (playerColor === 'white' ? 'w' : 'b')
    const colorPrefix = currentColor === 'w' ? 'w' : 'b'
    return (['q', 'r', 'b', 'n'] as PieceSymbol[]).map((piece) => ({
      piece,
      key: `${colorPrefix}${piece.toUpperCase()}`,
    }))
  }, [playerColor, gameMode, boardFen, onlineRole])

  const handleTakeback = () => {
    if (!canTakeback) return
    // In vs-maia mode, undo 2 moves (player + bot); otherwise undo 1.
    const movesToUndo = gameMode === 'vs-maia' ? 2 : 1
    let undone = 0
    while (undone < movesToUndo && gameRef.current.history().length > 0) {
      const move = gameRef.current.undo()
      if (!move) break
      undone += 1
    }
    if (undone === 0) return
    setBoardFen(gameRef.current.fen())
    setHistory(gameRef.current.history())
    setHistoryVerbose(gameRef.current.history({ verbose: true }) as Move[])
    setGameOver(null)
    setShowGameOverDialog(false)
    setSelectedSquare(null)
    setPendingPromotion(null)
    setEngineThinking(false)
    setTakebacksUsed((prev) => prev + 1)
  }

  const onlinePanel = gameMode === 'online' ? (
    <OnlinePanel
      connectionText={onlineConnectionText}
      error={onlineError}
      gameId={onlineGameId}
      joinCode={onlineJoinCode}
      canCreate={onlineConnection !== 'connecting' && onlineConnection !== 'reconnecting'}
      canJoin={
        onlineConnection !== 'connecting' &&
        onlineConnection !== 'reconnecting' &&
        isValidGameId(onlineJoinCode)
      }
      canResync={onlineDesync && Boolean(onlineLastSyncFen)}
      canLeave={Boolean(onlineGameId)}
      onJoinCodeChange={handleJoinCodeChange}
      onCreateGame={createOnlineGame}
      onJoinGame={joinOnlineGame}
      onCopyGameId={handleCopyGameId}
      onResync={handleResync}
      onLeave={leaveOnlineGame}
    />
  ) : null

  return (
    <div className="app-container" style={appThemeStyle}>
      <Sidebar
        gameStarted={gameStarted}
        botEngineReady={botEngineReady}
        analysisMode={analysisMode}
        analysisAvailable={analysisAvailable}
        engineThinking={engineThinking}
        canTakeback={canTakeback}
        remainingTakebacks={remainingTakebacks}
        elo={elo}
        colorChoice={colorChoice}
        gameMode={gameMode}
        statusText={statusText}
        statusOk={sidebarStatusOk}
        statusHeadline={gameMode === 'online' ? onlineTurnText : undefined}
        statusHeadlineTone={gameMode === 'online' ? onlineTurnTone : undefined}
        statusDetail={gameMode === 'online' ? onlineStatusDetail : undefined}
        statusDotTone={gameMode === 'online' ? onlineStatusDotTone : undefined}
        isDebugMode={DEBUG_MODE}
        allowEloChangeMidGame={allowEloChangeMidGame}
        onStartGame={startGameFromSelection}
        onStopGame={stopGame}
        onEnterAnalysis={enterAnalysisMode}
        onExitAnalysis={leaveAnalysisMode}
        onTakeback={handleTakeback}
        onEloChange={handleEloChange}
        onColorChange={handleColorChange}
        onGameModeChange={handleGameModeChange}
        onOpenSettings={() => setSettingsOpen(true)}
        onlinePanel={onlinePanel}
      />

      <main className="board-area" ref={boardAreaRef}>
        <div className="board-shell" style={{ height: boardSize, width: boardSize }} ref={boardShellRef}>
          <div className="board-stage" style={{ width: '100%', height: '100%' }}>
            <Chessboard
              options={{
                id: 'vs-maia',
                position: fenToShow,
                boardOrientation:
                  gameMode === '1v1'
                    ? 'white'
                    : gameMode === 'online'
                      ? (onlineRole ?? 'white')
                      : playerColor,
                allowDragging:
                  analysisMode ||
                  (gameStarted && !engineThinking && !gameOver && (gameMode !== 'online' || onlineCanMove)),
                boardStyle: {
                  width: '100%',
                  height: '100%',
                  borderRadius: 4,
                  boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                },
                lightSquareStyle: { backgroundColor: 'var(--square-light)' },
                darkSquareStyle: { backgroundColor: 'var(--square-dark)' },
                animationDurationInMs: 200,
                allowDrawingArrows: false,
                onSquareClick: handleSquareClick,
                squareStyles,
                onPieceDrop: ({ sourceSquare, targetSquare }) => {
                  if (!targetSquare) return false
                  return onDrop(sourceSquare as Square, targetSquare as Square)
                },
              }}
            />
            {analysisMode && (
              <div className="analysis-arrows" aria-hidden="true">
                <AnalysisArrowLayer
                  arrows={analysisArrows}
                  boardSize={boardSize}
                  playerColor={playerColor}
                />
              </div>
            )}
          </div>
        </div>
      </main>

      <InfoPanel
        turnText={turnText}
        formattedHistory={formattedHistory}
        currentHistoryIndex={currentHistoryIndex}
        analysisMode={analysisMode}
        analysisIndex={analysisIndex}
        analysisEntriesLength={analysisEntries.length}
        analysisTurnLabel={analysisTurnLabel}
        analysisError={analysisError}
        analysisLoading={analysisLoading}
        isExploringVariant={isExploringVariant}
        onGoToAnalysisIndex={goToAnalysisIndex}
        onResetAnalysisPosition={resetAnalysisPosition}
      />

      {showGameOverDialog && gameOver && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>
              {gameMode === 'online'
                ? (onlineRole && isPlayerVictory(gameRef.current, onlineRole) ? 'Win' : 'Game Over')
                : (isPlayerVictory(gameRef.current, playerColor) ? 'Win' : 'Game Over')}
            </h2>
            <p>{gameOver}</p>
            <div className="modal-actions">
              {gameMode === 'online' ? (
                <button className="primary" onClick={() => setShowGameOverDialog(false)}>
                  Close
                </button>
              ) : (
                <>
                  <button className="primary" onClick={startGameFromSelection}>
                    Start Game
                  </button>
                  <button className="ghost" onClick={() => setShowGameOverDialog(false)}>
                    View Board
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {pendingPromotion && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Choose a promotion</h2>
            <p>Select the piece you want to promote to.</p>
            <div className="modal-actions">
              {promotionPieceTypes.map(({ piece, key }) => {
                const PieceIcon = defaultPieces[key]
                return (
                <button
                  key={key}
                  className="ghost promotion-button"
                  aria-label={`Promote to ${piece.toUpperCase()}`}
                  onClick={() => {
                    const { from, to } = pendingPromotion
                    applyLocalMove(from, to, piece)
                    setPendingPromotion(null)
                  }}
                >
                  {PieceIcon ? <PieceIcon /> : piece.toUpperCase()}
                </button>
              )})}
            </div>
          </div>
        </div>
      )}

      {engineDownloadState.visible && (
        <div className="modal-overlay">
          <div className="modal-content engine-download-modal">
            <h2>Downloading engines</h2>
            {engineDownloadState.status === 'error' ? (
              <>
                <p>{engineDownloadState.error ?? 'Engine download failed.'}</p>
                <div className="modal-actions">
                  <button className="primary" onClick={startEngineBootstrap}>
                    Retry download
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>Stockfish, Zerofish, and Maia are downloaded on first launch.</p>
                <div className="engine-download-progress">
                  <div className="engine-download-bar">
                    <div
                      className="engine-download-fill"
                      style={{
                        width: engineDownloadState.totalFiles
                          ? `${((engineDownloadState.currentFileIndex ?? 0) / engineDownloadState.totalFiles) * 100}%`
                          : '0%',
                      }}
                    />
                  </div>
                  <div className="engine-download-meta">
                    <span>
                      {engineDownloadState.currentFileLabel
                        ? `Downloading ${engineDownloadState.currentFileLabel}`
                        : 'Preparing download...'}
                    </span>
                    <span>
                      {engineDownloadState.currentFileIndex ?? 0} / {engineDownloadState.totalFiles ?? '?'}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <Settings
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        boardTheme={boardThemeKey}
        onBoardThemeChange={setBoardThemeKey}
        takebackLimit={takebackLimit}
        onTakebackLimitChange={setTakebackLimit}
        takebacksUsed={takebacksUsed}
        allowEloChangeMidGame={allowEloChangeMidGame}
        onAllowEloChangeMidGameChange={setAllowEloChangeMidGame}
      />
    </div>
  )
}

export default App
