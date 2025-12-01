import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Chess, SQUARES } from 'chess.js'
import type { Move, Square } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { Bot, Palette, Settings, X, Activity } from 'lucide-react'
import systemPromptText from './systemPrompt.txt?raw'
import './App.css'
import {
  buildAnalysisEntriesFromVerbose,
  getGameOverTitle,
  type AnalysisEntry,
} from './chessHelpers'
import { clamp, computeSkillLevel, computeBlunderProbability, uciToSan } from './engineHelpers'
import { CHAT_TOOLS } from './ai/tools'
import FormattedMessage from './components/FormattedMessage'

type PlayerColor = 'white' | 'black'

type Suggestion = {
  uci: string
  from: Square
  to: Square
  score: number
  san: string
}

type ArrowToDraw = {
  from: Square
  to: Square
  color: string
  width: number
  opacity?: number
}

interface ToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
  id?: string;
  type?: 'function';
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  name?: string;
}

const ENGINE_PATH = './engine/stockfish-17.1-lite-single-03e3232.js'
const THINK_TIME_MS = 1200
const ENGINE_MIN_ELO = 1320 // Stockfish UCI_ELO floor is around 1320

const buildGameOverText = (game: Chess) => {
  if (game.isCheckmate()) {
    return `${game.turn() === 'w' ? 'Black' : 'White'} wins by checkmate`
  }
  if (game.isStalemate()) return 'Stalemate'
  if (game.isThreefoldRepetition()) return 'Draw by repetition'
  if (game.isInsufficientMaterial()) return 'Draw (insufficient material)'
  if (game.isDraw()) return 'Draw'
  return null
}

const findKingSquare = (game: Chess, color: 'w' | 'b'): Square | null => {
  for (const sq of SQUARES) {
    const piece = game.get(sq)
    if (piece && piece.type === 'k' && piece.color === color) {
      return sq
    }
  }
  return null
}




const pickMoveWithBlunder = (fen: string, options: Suggestion[], blunderProb: number) => {
  if (!options.length) return null

  const rand = Math.random()
  const chess = new Chess(fen)
  const legalMoves = chess.moves({ verbose: true }) as Move[]

  // Occasionally play a totally random move to simulate real blunders
  // For 600 ELO (blunderProb ~0.8), this is ~32% chance of a random move
  if (rand < blunderProb * 0.4 && legalMoves.length) {
    const randomMove = legalMoves[Math.floor(Math.random() * legalMoves.length)]
    return `${randomMove.from}${randomMove.to}${randomMove.promotion ?? ''}`
  }

  // Otherwise pick a weaker option among the best three
  if (rand < blunderProb && options.length >= 2) {
    if (rand < blunderProb * 0.7 && options.length >= 3) {
      return options[options.length - 1].uci // worst of the top 3
    }
    return options[1].uci // second best
  }

  return options[0].uci
}

function App() {
  const gameRef = useRef(new Chess())
  const analysisGameRef = useRef<Chess | null>(null)
  const [boardFen, setBoardFen] = useState(gameRef.current.fen())
  const [playerColor, setPlayerColor] = useState<PlayerColor>('white')
  const [engineReady, setEngineReady] = useState(false)
  const [engineStatus, setEngineStatus] = useState('Starting Stockfish...')
  const [elo, setElo] = useState(1600)
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
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'ai' | 'board'>('ai')

  // AI Settings
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434')
  const [ollamaModel, setOllamaModel] = useState('llama3.2')
  const [systemPrompt] = useState(systemPromptText)
  const [temperature] = useState(0.7)
  const [ollamaConnected, setOllamaConnected] = useState(false)
  const [toolsSupported, setToolsSupported] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [connectionStatusMsg, setConnectionStatusMsg] = useState<string | null>(null)

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [isChatLoading, setIsChatLoading] = useState(false)

  // Refs for tool access
  const analysisIndexRef = useRef(analysisIndex)
  const analysisEntriesRef = useRef(analysisEntries)
  const analysisSuggestionsRef = useRef(analysisSuggestions)
  
  useEffect(() => { analysisIndexRef.current = analysisIndex }, [analysisIndex])
  useEffect(() => { analysisEntriesRef.current = analysisEntries }, [analysisEntries])
  useEffect(() => { analysisSuggestionsRef.current = analysisSuggestions }, [analysisSuggestions])

  // Layout state for Analysis Mode
  const [sidebarSplit, setSidebarSplit] = useState(50) // Percentage height of the top panel
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false)
  const [isChatCollapsed, setIsChatCollapsed] = useState(false)
  const draggingRef = useRef(false)
  const splitViewRef = useRef<HTMLDivElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const analysisPanelRef = useRef<HTMLDivElement>(null)

  // Click-to-move helper state
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null)

  const workerRef = useRef<Worker | null>(null)
  const readyResolvers = useRef<(() => void)[]>([])
  const bestResolver = useRef<((line: string) => void) | null>(null)
  const infoHandler = useRef<((line: string) => void) | null>(null)
  const boardShellRef = useRef<HTMLDivElement>(null)
  const analysisCacheRef = useRef<Map<string, Suggestion[]>>(new Map())
  const lastRequestedFenRef = useRef<string | null>(null)
  const engineBusyRef = useRef(false)
  const analysisRequestIdRef = useRef(0)

  const logEngine = useCallback((...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.info('[Stockfish]', ...args)
    }
  }, [])

  const sendEngine = useCallback((cmd: string) => {
    const worker = workerRef.current
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
  }, [])

  const waitForReady = useCallback(() =>
    new Promise<void>((resolve) => {
      if (!workerRef.current) return resolve()
      readyResolvers.current.push(resolve)
      sendEngine('isready')
    }), [sendEngine])

  const waitForEngineIdle = useCallback(async () => {
    while (engineBusyRef.current) {
      await new Promise((r) => setTimeout(r, 50))
    }
  }, [])

  const requestMultiSuggestions = useCallback(async (fen: string, multiPv = 3, requestId?: number) => {
    const suggestions: Suggestion[] = []
    if (!workerRef.current) return suggestions
    
    // If we are preempted before even starting
    if (requestId !== undefined && analysisRequestIdRef.current !== requestId) return []

    await waitForReady()

    // Double check after waiting
    if (requestId !== undefined && analysisRequestIdRef.current !== requestId) return []

    sendEngine(`setoption name MultiPV value ${multiPv}`)
    sendEngine(`position fen ${fen}`)

    infoHandler.current = (line: string) => {
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
      bestResolver.current = () => resolve()
    })

    engineBusyRef.current = true
    sendEngine(`go movetime ${THINK_TIME_MS}`)
    await bestPromise
    engineBusyRef.current = false

    infoHandler.current = null
    bestResolver.current = null

    // If we were preempted, don't do cleanup or return potentially partial results if we want strictness.
    // But returning partial results is usually fine. The important thing is skipping cleanup if another request took over.
    if (requestId !== undefined && analysisRequestIdRef.current !== requestId) {
      return suggestions.filter(Boolean).sort((a, b) => b.score - a.score)
    }

    await waitForReady()
    sendEngine('setoption name MultiPV value 1')

    return suggestions.filter(Boolean).sort((a, b) => b.score - a.score)
  }, [sendEngine, waitForReady])

  const loadAnalysisSuggestions = useCallback(async (fen: string) => {
    if (!engineReady || !workerRef.current) {
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
    if (engineBusyRef.current) {
      sendEngine('stop')
    }

    // Wait for it to be free
    await waitForEngineIdle()

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
  }, [engineReady, requestMultiSuggestions, sendEngine, waitForEngineIdle])

  const applyEngineStrength = useCallback((eloValue: number) => {
    const skill = computeSkillLevel(eloValue)
    const engineElo = Math.max(ENGINE_MIN_ELO, eloValue)
    sendEngine('setoption name UCI_LimitStrength value true')
    sendEngine(`setoption name UCI_Elo value ${engineElo}`)
    sendEngine(`setoption name Skill Level value ${skill}`)
  }, [sendEngine])

  const requestBestMove = useCallback(async (fen: string) => {
    if (!workerRef.current) return null
    await waitForReady()
    sendEngine(`position fen ${fen}`)

    const bestMovePromise = new Promise<string>((resolve) => {
      bestResolver.current = (line: string) => {
        const match = line.match(/bestmove\s+(\S+)/)
        resolve(match?.[1] ?? '')
      }
    })

    engineBusyRef.current = true
    sendEngine(`go movetime ${THINK_TIME_MS}`)
    const move = await bestMovePromise
    engineBusyRef.current = false
    return move || null
  }, [waitForReady, sendEngine])

  const requestWeakOrBestMove = useCallback(async (fen: string, eloValue: number) => {
    const blunderProb = computeBlunderProbability(eloValue)
    if (blunderProb <= 0.03) {
      return requestBestMove(fen)
    }

    const suggestions = await requestMultiSuggestions(fen, 3)
    const picked = pickMoveWithBlunder(fen, suggestions, blunderProb)
    return picked ?? (await requestBestMove(fen))
  }, [requestBestMove, requestMultiSuggestions])

  const enterAnalysisMode = () => {
    if (!engineReady || !history.length) return
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
    console.log('[App] goToAnalysisIndex', { nextIndex, analysisMode, entries: analysisEntries.length })
    if (!analysisMode) {
      console.warn('[App] goToAnalysisIndex aborted: not in analysis mode')
      return
    }
    if (!analysisEntries.length) {
      console.warn('[App] goToAnalysisIndex aborted: no analysis entries')
      return
    }
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

  const startNewGame = useCallback((color: PlayerColor = 'white') => {
    // Stop any running analysis
    if (engineBusyRef.current) {
      sendEngine('stop')
    }
    // Invalidate pending analysis requests
    analysisRequestIdRef.current++

    gameRef.current = new Chess()
    setBoardFen(gameRef.current.fen())
    setHistory([])
    setHistoryVerbose([])
    setGameOver(null)
    setAnalysisMode(false)
    setPlayerColor(color)
    setEngineThinking(false)
    setSelectedSquare(null)
    setAnalysisEntries([])
    setAnalysisIndex(0)
    setAnalysisBoardFen(null)
    setAnalysisSuggestions([])
    setAnalysisLoading(false)
    setAnalysisError(null)
    analysisGameRef.current = null
    analysisCacheRef.current.clear()

    setChatMessages(ollamaConnected ? [{
      role: 'assistant',
      content: "Hello! I'm your chess assistant. Ask me anything about this position.",
    }] : [])
  }, [ollamaConnected, sendEngine])

  const onDrop = (sourceSquare: Square, targetSquare: Square) => {
    if (analysisMode) {
      return makeAnalysisMove(sourceSquare, targetSquare)
    }
    if (gameOver || engineThinking) return false
    if (gameRef.current.turn() === (playerColor === 'white' ? 'b' : 'w')) return false

    try {
      const move = gameRef.current.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q',
      })
      if (!move) return false

      setBoardFen(gameRef.current.fen())
      setHistory(gameRef.current.history())
      setHistoryVerbose(gameRef.current.history({ verbose: true }) as Move[])
      setSelectedSquare(null)

      const over = buildGameOverText(gameRef.current)
      if (over) setGameOver(over)
      
      return true
    } catch {
      return false
    }
  }

  const handleSquareClick = (arg: { square: string } | string) => {
    const square = (typeof arg === 'string' ? arg : arg.square) as Square
    if (analysisMode) {
      if (selectedSquare && selectedSquare !== square) {
        const moved = makeAnalysisMove(selectedSquare, square)
        if (moved) return
      }
      const piece = analysisGameRef.current?.get(square)
      if (piece && piece.color === analysisGameRef.current?.turn()) {
        setSelectedSquare(square)
      } else {
        setSelectedSquare(null)
      }
      return
    }

    if (gameOver || engineThinking) return
    if (gameRef.current.turn() === (playerColor === 'white' ? 'b' : 'w')) return

    if (selectedSquare) {
      const move = onDrop(selectedSquare, square)
      if (move) return
    }

    const piece = gameRef.current.get(square)
    if (piece && piece.color === (playerColor === 'white' ? 'w' : 'b')) {
      setSelectedSquare(square)
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

  const boardAreaRef = useRef<HTMLElement>(null)

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
    const worker = new Worker(ENGINE_PATH)
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent) => {
      const line = typeof event.data === 'string' ? event.data : event.data?.toString?.() ?? ''
      if (!line) return

      logEngine('<<', line)

      if (line === 'uciok') {
        setEngineStatus('Configuring engine...')
        return
      }

      if (line === 'readyok') {
        const resolvers = readyResolvers.current
        readyResolvers.current = []
        resolvers.forEach((resolve) => resolve())
        setEngineReady(true)
        setEngineStatus('Engine ready')
        return
      }

      if (line.startsWith('info') && infoHandler.current) {
        infoHandler.current(line)
      }

      if (line.startsWith('bestmove')) {
        bestResolver.current?.(line)
        bestResolver.current = null
        infoHandler.current = null
      }
    }

    sendEngine('uci')
    sendEngine('setoption name Threads value 1')
    applyEngineStrength(elo)
    sendEngine('isready')

    return () => worker.terminate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!engineReady || !workerRef.current || engineThinking) return
    applyEngineStrength(elo)
    sendEngine('isready')
  }, [elo, engineReady, applyEngineStrength, sendEngine, engineThinking])

  useEffect(() => {
    if (!analysisMode || !analysisBoardFen) return
    void loadAnalysisSuggestions(analysisBoardFen)
  }, [analysisMode, analysisBoardFen, loadAnalysisSuggestions])



  useEffect(() => {
    if (!analysisMode) return
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      e.preventDefault()
      
      const container = splitViewRef.current
      if (!container) return
      
      const containerRect = container.getBoundingClientRect()
      const relativeY = e.clientY - containerRect.top
      const percentage = (relativeY / containerRect.height) * 100
      
      // Calculate minimum percentage based on analysis panel height
      // Header is ~37px, Analysis Panel varies but we want to ensure it's visible
      const minHeightPx = (analysisPanelRef.current?.offsetHeight || 100) + 37
      const minPercentage = (minHeightPx / containerRect.height) * 100
      
      setSidebarSplit(clamp(percentage, minPercentage, 95))
    }

    const handleMouseUp = () => {
      draggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [analysisMode])

  useEffect(() => {
    if (gameOver) {
      setShowGameOverDialog(true)
    } else {
      setShowGameOverDialog(false)
    }
  }, [gameOver])

  useEffect(() => {
    if (gameOver || !engineReady || analysisMode || engineThinking) return
    if (gameRef.current.turn() === (playerColor === 'white' ? 'b' : 'w')) {
      setEngineThinking(true)
      requestWeakOrBestMove(gameRef.current.fen(), elo).then((move) => {
        if (move) {
          try {
            gameRef.current.move({
              from: move.slice(0, 2) as Square,
              to: move.slice(2, 4) as Square,
              promotion: 'q',
            })
            setBoardFen(gameRef.current.fen())
            setHistory(gameRef.current.history())
            setHistoryVerbose(gameRef.current.history({ verbose: true }) as Move[])

            const over = buildGameOverText(gameRef.current)
            if (over) setGameOver(over)
          } catch (e) {
            console.error('Engine made invalid move:', move, e)
          }
        }
        setEngineThinking(false)
      })
    }
  }, [boardFen, engineReady, gameOver, analysisMode, playerColor, elo, requestWeakOrBestMove, engineThinking])

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

    if (gameOver) return gameOver
    if (!engineReady) return 'Engine getting ready...'
    if (engineThinking) return 'Stockfish is thinking...'
    const turn = gameRef.current.turn() === 'w' ? 'White' : 'Black'
    const checkText = isInCheck ? ' (Check!)' : ''
    return `${turn} to move${checkText}`
  }, [analysisMode, fenToShow, analysisEntries, analysisIndex, engineReady, engineThinking, gameOver, isInCheck])

  const handleColorChange = (color: PlayerColor) => {
    if (color === playerColor) return
    startNewGame(color)
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

    if (currentEntry?.nextMove && analysisBoardFen === currentEntry.fen) {
      arrows.push({
        from: currentEntry.nextMove.from,
        to: currentEntry.nextMove.to,
        color: '#ffad71', // Distinct orange for the played move
        width: 6,
        opacity: 1,
      })
    }

    return arrows
  }, [analysisBoardFen, analysisEntries, analysisIndex, analysisMode, analysisSuggestions])

  const analysisAvailable = history.length > 0
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

  const gameInProgress = history.length > 0 && !gameOver

  const AnalysisArrowLayer = ({ arrows }: { arrows: ArrowToDraw[] }) => {
    if (!arrows.length) return null
    const squareSize = boardSize / 8
    const getCenter = (square: Square) => {
      const file = square.charCodeAt(0) - 97
      const rank = Number(square[1]) - 1
      if (file < 0 || file > 7 || rank < 0 || rank > 7) return null

      const xIndex = playerColor === 'white' ? file : 7 - file
      const yIndex = playerColor === 'white' ? 7 - rank : rank

      return {
        x: xIndex * squareSize + squareSize / 2,
        y: yIndex * squareSize + squareSize / 2,
      }
    }

    return (
      <svg
        className="analysis-arrow-canvas"
        width={boardSize}
        height={boardSize}
        viewBox={`0 0 ${boardSize} ${boardSize}`}
        style={{ pointerEvents: 'none' }}
      >
        {arrows.map((arrow, idx) => {
          const from = getCenter(arrow.from)
          const to = getCenter(arrow.to)
          if (!from || !to) return null

          const dx = to.x - from.x
          const dy = to.y - from.y
          const len = Math.sqrt(dx * dx + dy * dy)
          if (len === 0) return null

          const width = arrow.width
          const headLength = width * 3
          const headWidth = width * 2.4
          
          // Shorten slightly for aesthetics
          const margin = squareSize * 0.22
          const actualLen = Math.max(0, len - margin)
          
          if (actualLen < headLength) return null

          const uX = dx / len
          const uY = dy / len
          
          const tipX = from.x + uX * actualLen
          const tipY = from.y + uY * actualLen

          const neckX = tipX - uX * headLength
          const neckY = tipY - uY * headLength

          const pX = -uY
          const pY = uX

          const slX = from.x - pX * (width / 2)
          const slY = from.y - pY * (width / 2)
          const nlX = neckX - pX * (width / 2)
          const nlY = neckY - pY * (width / 2)
          const hblX = neckX - pX * (headWidth / 2)
          const hblY = neckY - pY * (headWidth / 2)
          const hbrX = neckX + pX * (headWidth / 2)
          const hbrY = neckY + pY * (headWidth / 2)
          const nrX = neckX + pX * (width / 2)
          const nrY = neckY + pY * (width / 2)
          const srX = from.x + pX * (width / 2)
          const srY = from.y + pY * (width / 2)

          const d = `M ${slX} ${slY} L ${nlX} ${nlY} L ${hblX} ${hblY} L ${tipX} ${tipY} L ${hbrX} ${hbrY} L ${nrX} ${nrY} L ${srX} ${srY} Z`

          return (
            <path
              key={`${arrow.from}-${arrow.to}-${idx}`}
              d={d}
              fill={arrow.color}
              opacity={arrow.opacity ?? 0.8}
            />
          )
        })}
      </svg>
    )
  }

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isChatLoading || !ollamaConnected) return

    const userMessage = { role: 'user' as const, content: chatInput }
    setChatMessages((prev) => [...prev, userMessage])
    setChatInput('')
    setIsChatLoading(true)

    // Keep track of local state for the duration of the conversation turn
    let currentSimulatedIndex = analysisIndexRef.current

    try {
      const messagesToSend: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...chatMessages.filter(m => m.role !== 'system'),
        userMessage,
      ]

      let keepGoing = true
      let turns = 0
      
      while (keepGoing && turns < 5) {
        turns++
        const response = await fetch(`${ollamaUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: ollamaModel,
            messages: messagesToSend,
            stream: false, // Disable streaming for tool reliability
            tools: CHAT_TOOLS,
            options: {
              temperature: temperature,
            },
          }),
        })

        if (!response.ok) {
          throw new Error(`Ollama API error: ${response.statusText}`)
        }

        const data = await response.json()
        const message = data.message
        
        console.log('[Ollama] Received:', message)

        // Add assistant message to history (only if content exists)
        if (message.content) {
          setChatMessages((prev) => [...prev, message])
        }
        messagesToSend.push(message)

        if (message.tool_calls && message.tool_calls.length > 0) {
          console.log('[Ollama] Tool calls:', message.tool_calls)
          for (const toolCall of message.tool_calls) {
            const { name, arguments: args } = toolCall.function
            console.log(`[Ollama] Executing ${name} with args:`, args)
            
            // Add UI feedback for tool execution
            let actionDescription = ''
            if (name === 'navigate_analysis') {
                if (args.action === 'next') actionDescription = 'Moving forward'
                else if (args.action === 'previous') actionDescription = 'Moving backward'
                else if (args.action === 'start') actionDescription = 'Going to start'
                else if (args.action === 'end') actionDescription = 'Going to end'
                else if (args.action === 'jump') actionDescription = `Jumping to move ${args.index}`
            } else if (name === 'get_analysis_state') {
                actionDescription = 'Checking board state'
            } else if (name === 'make_analysis_move') {
                actionDescription = `Playing move ${args.move} on board`
            }

            if (actionDescription) {
                 setChatMessages(prev => [...prev, { role: 'system', content: actionDescription }])
            }

            let result = ''
            
            try {
              // Handle tools
              if (name === 'get_analysis_state') {
                const entries = analysisEntriesRef.current
                const entry = entries[currentSimulatedIndex]
                const prevEntry = currentSimulatedIndex > 0 ? entries[currentSimulatedIndex - 1] : null
                const suggestions = analysisSuggestionsRef.current
                
                const futureMoves: string[] = []
                for (let i = 0; i < 5; i++) {
                  const futureEntry = entries[currentSimulatedIndex + i]
                  if (futureEntry?.playedMove) {
                    futureMoves.push(futureEntry.playedMove.san)
                  }
                }

                result = JSON.stringify({
                  index: currentSimulatedIndex,
                  totalMoves: entries.length,
                  fen: entry?.fen || boardFen,
                  lastMove: prevEntry?.playedMove?.san || 'None',
                  nextMove: entry?.playedMove?.san || 'None',
                  futureMoves,
                  turn: new Chess(entry?.fen || boardFen).turn() === 'w' ? 'White' : 'Black',
                  engineSuggestions: suggestions.map(s => ({
                    san: s.san,
                    score: s.score,
                    uci: s.uci
                  }))
                })
              } else if (name === 'navigate_analysis') {
                const { action, index } = args
                const entries = analysisEntriesRef.current
                let newIndex = currentSimulatedIndex

                if (action === 'next') newIndex++
                if (action === 'previous') newIndex--
                if (action === 'start') newIndex = 0
                if (action === 'end') newIndex = entries.length - 1
                if (action === 'jump' && typeof index === 'number') newIndex = index

                // Clamp
                newIndex = Math.max(0, Math.min(newIndex, entries.length - 1))
                
                console.log('[Ollama] Navigating to index:', newIndex)
                
                // Update local simulation and actual app state
                currentSimulatedIndex = newIndex
                goToAnalysisIndex(newIndex)
                
                const entry = entries[newIndex]
                result = JSON.stringify({
                  status: 'success',
                  newIndex,
                  move: entry?.playedMove?.san || 'Start',
                  fen: entry?.fen
                })
              } else if (name === 'make_analysis_move') {
                const { move } = args
                if (!analysisGameRef.current) {
                   result = 'Error: Analysis mode is not active.'
                } else {
                   try {
                     const m = analysisGameRef.current.move(move)
                     if (m) {
                       setAnalysisBoardFen(analysisGameRef.current.fen())
                       // We are now in a variation.
                       result = JSON.stringify({
                         status: 'success',
                         fen: analysisGameRef.current.fen(),
                         move: m.san,
                         note: 'Board updated. You are now in a variation. Use navigate_analysis to return to the main line.'
                       })
                     } else {
                       result = 'Error: Invalid move. Please use SAN format (e.g. Nf3).'
                     }
                   } catch (e) {
                     result = `Error making move: ${e}`
                   }
                }
              } else {
                result = 'Tool not found'
              }
            } catch (e) {
              result = `Error executing tool: ${e}`
            }

            const toolMessage: ChatMessage = {
              role: 'tool',
              content: result,
              name: name,
            }
            messagesToSend.push(toolMessage)
          }
        } else {
          keepGoing = false
        }
      }

    } catch (error) {
      console.error('Failed to send message to Ollama:', error)
    } finally {
      setIsChatLoading(false)
    }
  }

  const checkModelSupport = useCallback(async (modelName: string) => {
    if (!ollamaConnected) return
    try {
      const response = await fetch(`${ollamaUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
      })
      if (!response.ok) {
        setToolsSupported(false)
        return
      }
      const data = await response.json()
      // Check for tool support indicators in template
      // Ollama templates for tool-capable models usually include {{.Tools}}
      const hasTools = data.template?.includes('.Tools') || false
      setToolsSupported(hasTools)
    } catch (e) {
      console.error('Failed to check model capabilities', e)
      setToolsSupported(false)
    }
  }, [ollamaUrl, ollamaConnected])

  const checkOllamaConnection = useCallback(async (isManual = false) => {
    if (isManual) setConnectionStatusMsg('Testing...')
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 2000) // 2s timeout
      
      const res = await fetch(ollamaUrl, { 
        signal: controller.signal 
      })
      clearTimeout(timeoutId)
      
      if (res.ok) {
        setOllamaConnected(true)
        if (isManual) setConnectionStatusMsg('Connected!')
        // Fetch models
        try {
          const modelsRes = await fetch(`${ollamaUrl}/api/tags`)
          if (modelsRes.ok) {
            const data = await modelsRes.json()
            setAvailableModels(data.models.map((m: { name: string }) => m.name))
          }
        } catch {
          console.error("Failed to fetch models")
        }
      } else {
        setOllamaConnected(false)
        setAvailableModels([])
        if (isManual) setConnectionStatusMsg('Failed to connect')
      }
    } catch {
      setOllamaConnected(false)
      setAvailableModels([])
      if (isManual) setConnectionStatusMsg('Failed to connect')
    }

    if (isManual) {
      setTimeout(() => setConnectionStatusMsg(null), 3000)
    }
  }, [ollamaUrl])

  useEffect(() => {
    if (ollamaConnected && ollamaModel) {
      checkModelSupport(ollamaModel)
    }
  }, [ollamaConnected, ollamaModel, checkModelSupport])

  useEffect(() => {
    checkOllamaConnection()
    const interval = setInterval(checkOllamaConnection, 10000) // Check every 10s
    return () => clearInterval(interval)
  }, [checkOllamaConnection])

  useEffect(() => {
    if (ollamaConnected) {
      setChatMessages((prev) => {
        if (prev.length === 0) {
          return [
            {
              role: 'assistant',
              content: "Hello! I'm your chess assistant. Ask me anything about this position.",
            },
          ]
        }
        return prev
      })
    }
  }, [ollamaConnected])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, isChatLoading])

  return (
    <div className="app-container">
      <nav className="sidebar">
        <div className="sidebar-header">
          <p className="eyebrow">Local Stockfish 17.1</p>
          <h1>vibeChess</h1>
        </div>

        <div className="sidebar-menu">
          <div className="menu-group">
            <button className="primary" onClick={() => startNewGame()} disabled={!engineReady}>
              New Game
            </button>
            <button
              className="ghost"
              onClick={() => (analysisMode ? leaveAnalysisMode() : enterAnalysisMode())}
              disabled={!analysisMode && (!engineReady || !analysisAvailable || engineThinking)}
            >
              {analysisMode ? 'Exit Analysis' : 'Analyze Game'}
            </button>
          </div>

          <div className="menu-group">
            <p className="label">Difficulty (ELO)</p>
            <div className="slider">
              <input
                type="range"
                min={600}
                max={2800}
                step={50}
                value={elo}
                onChange={(e) => setElo(Number(e.target.value))}
                disabled={history.length > 0}
                title={history.length > 0 ? "Start a new game to change difficulty" : "Adjust difficulty"}
              />
              <div className="slider-values">
                <span>600</span>
                <input
                  type="number"
                  className="elo-input"
                  value={elo}
                  min={600}
                  max={2800}
                  step={10}
                  onChange={(e) => {
                    const val = e.target.value === '' ? 0 : parseInt(e.target.value)
                    setElo(val)
                  }}
                  onBlur={() => {
                    const clamped = Math.min(2800, Math.max(600, elo))
                    setElo(clamped)
                  }}
                  disabled={history.length > 0}
                  title={history.length > 0 ? "Start a new game to change difficulty" : "Type to adjust ELO"}
                />
                <span>2800</span>
              </div>
            </div>
          </div>

          <div className="menu-group">
            <p className="label">Your Color</p>
            <div className="toggle">
              <button
                className={playerColor === 'white' ? 'active' : ''}
                onClick={() => handleColorChange('white')}
                disabled={gameInProgress}
              >
                White
              </button>
              <button
                className={playerColor === 'black' ? 'active' : ''}
                onClick={() => handleColorChange('black')}
                disabled={gameInProgress}
              >
                Black
              </button>
            </div>
          </div>
        </div>
        
        <div style={{ marginTop: 'auto' }}>
           <button 
             className="ghost" 
             onClick={() => setShowSettings(true)}
             style={{ width: '100%', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
           >
             <Settings size={16} />
             Settings
           </button>
           <div className="status-row">
            <span className={`status-dot ${engineReady ? 'ok' : 'wait'}`} />
            <span className="status-text" style={{ fontSize: 12 }}>
              {!engineReady ? engineStatus : 'Engine Ready'}
            </span>
          </div>
        </div>
      </nav>

      <main className="board-area" ref={boardAreaRef}>
        <div className="board-shell" style={{ height: boardSize, width: boardSize }} ref={boardShellRef}>
          <div className="board-stage" style={{ width: '100%', height: '100%' }}>
            <Chessboard
              options={{
                id: 'vs-stockfish',
                position: fenToShow,
                boardOrientation: playerColor,
                allowDragging: analysisMode || (!engineThinking && !gameOver),
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
                <AnalysisArrowLayer arrows={analysisArrows} />
              </div>
            )}
          </div>
        </div>
      </main>

      <aside className="info-panel">
        <div className="panel-header">
          <h3 style={{ margin: 0 }}>{turnText}</h3>
        </div>

        {!analysisMode ? (
          <div className="history-container">
            {formattedHistory.length ? (
              formattedHistory.map(({ moveNumber, white, black }) => {
                const baseIndex = (moveNumber - 1) * 2
                const isCurrentLine =
                  currentHistoryIndex === baseIndex || currentHistoryIndex === baseIndex + 1
                return (
                  <div
                    className={`move-row ${isCurrentLine ? 'active' : ''}`}
                    key={moveNumber}
                    ref={isCurrentLine ? (el) => el?.scrollIntoView({ block: 'nearest' }) : null}
                  >
                    <span className="move-number">{moveNumber}.</span>
                    <span
                      className={`move-white ${currentHistoryIndex === baseIndex ? 'active' : ''}`}
                      onClick={() => analysisMode && goToAnalysisIndex(baseIndex + 1)}
                    >
                      {white ?? '-'}
                    </span>
                    <span
                      className={`move-black ${currentHistoryIndex === baseIndex + 1 ? 'active' : ''}`}
                      onClick={() => analysisMode && black && goToAnalysisIndex(baseIndex + 2)}
                    >
                      {black ?? ''}
                    </span>
                  </div>
                )
              })
            ) : (
              <div className="muted" style={{ padding: 20, textAlign: 'center' }}>
                Moves will appear here
              </div>
            )}
          </div>
        ) : (
          <div className="split-view-container" ref={splitViewRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Move Analysis Panel */}
            <div 
              className={`panel-section top ${isHistoryCollapsed ? 'collapsed' : ''}`}
              style={{ 
                flex: isHistoryCollapsed ? '0 0 auto' : (isChatCollapsed ? '1 1 auto' : `0 0 calc(${sidebarSplit}% - 2px)`) 
              }}
            >
              <div className="section-header" onClick={() => setIsHistoryCollapsed(!isHistoryCollapsed)}>
                <span>Move Analysis</span>
                <div className={`chevron ${isHistoryCollapsed ? 'collapsed' : ''}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
              </div>
              {!isHistoryCollapsed && (
                <div className="section-content">
                  <div className="history-container" style={{ flex: 1, minHeight: 0 }}>
                    {formattedHistory.length ? (
                      formattedHistory.map(({ moveNumber, white, black }) => {
                        const baseIndex = (moveNumber - 1) * 2
                        const isCurrentLine =
                          currentHistoryIndex === baseIndex || currentHistoryIndex === baseIndex + 1
                        return (
                          <div
                            className={`move-row ${isCurrentLine ? 'active' : ''}`}
                            key={moveNumber}
                            ref={isCurrentLine ? (el) => el?.scrollIntoView({ block: 'nearest' }) : null}
                          >
                            <span className="move-number">{moveNumber}.</span>
                            <span
                              className={`move-white ${currentHistoryIndex === baseIndex ? 'active' : ''}`}
                              onClick={() => analysisMode && goToAnalysisIndex(baseIndex + 1)}
                            >
                              {white ?? '-'}
                            </span>
                            <span
                              className={`move-black ${currentHistoryIndex === baseIndex + 1 ? 'active' : ''}`}
                              onClick={() => analysisMode && black && goToAnalysisIndex(baseIndex + 2)}
                            >
                              {black ?? ''}
                            </span>
                          </div>
                        )
                      })
                    ) : (
                      <div className="muted" style={{ padding: 20, textAlign: 'center' }}>
                        Moves will appear here
                      </div>
                    )}
                  </div>
                  <div className="analysis-panel" ref={analysisPanelRef}>
                    {analysisError && <div style={{ color: 'red', fontSize: 12, marginBottom: 8 }}>{analysisError}</div>}
                    <div className="analysis-controls">
                      <button
                        className="ghost small"
                        onClick={() => goToAnalysisIndex(analysisIndex - 1)}
                        disabled={analysisIndex === 0}
                      >
                        &larr;
                      </button>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {analysisIndex + 1} / {Math.max(analysisEntries.length, 1)}
                        {analysisTurnLabel ? ` - ${analysisTurnLabel}` : ''}
                        {analysisLoading && ' (Thinking...)'}
                      </span>
                      <button
                        className="ghost small"
                        onClick={() => goToAnalysisIndex(analysisIndex + 1)}
                        disabled={analysisIndex >= analysisEntries.length - 1}
                      >
                        &rarr;
                      </button>
                    </div>

                    {isExploringVariant && (
                      <div style={{ marginBottom: 8 }}>
                        <button
                          className="ghost small"
                          style={{ width: '100%', color: '#ffad71', borderColor: '#ffad71' }}
                          onClick={resetAnalysisPosition}
                        >
                          Return to Main Line
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Resizer */}
            {!isHistoryCollapsed && !isChatCollapsed && (
              <div 
                className="panel-resizer"
                onMouseDown={(e) => {
                  e.preventDefault()
                  draggingRef.current = true
                  document.body.style.cursor = 'row-resize'
                  document.body.style.userSelect = 'none'
                }}
                onDoubleClick={() => setSidebarSplit(50)}
              />
            )}

            {/* Chat Panel */}
            <div 
              className={`panel-section bottom ${isChatCollapsed ? 'collapsed' : ''}`}
              style={{ 
                flex: isChatCollapsed ? '0 0 auto' : (isHistoryCollapsed ? '1 1 auto' : '1 1 auto') 
              }}
            >
              <div className="section-header" onClick={() => setIsChatCollapsed(!isChatCollapsed)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>Chess AI</span>
                  <span 
                    className={`status-dot ${ollamaConnected && toolsSupported ? 'ok' : 'wait'}`} 
                    title={
                      !ollamaConnected 
                        ? "Ollama disconnected" 
                        : (!toolsSupported ? "Model does not support tools" : "Connected to Ollama")
                    } 
                  />
                </div>
                <div className={`chevron ${isChatCollapsed ? 'collapsed' : ''}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
              </div>
              {!isChatCollapsed && (
                <div className="section-content chat-container">
                  <div className="chat-messages">
                    {chatMessages.map((msg, idx) => (
                      <div key={idx} className={`chat-message ${msg.role === 'user' ? 'user' : (msg.role === 'system' ? 'system' : 'ai')}`}>
                        {msg.role === 'system' && <Activity size={12} />}
                        {msg.role === 'assistant' ? <FormattedMessage content={msg.content} /> : msg.content}
                      </div>
                    ))}
                    {isChatLoading && chatMessages[chatMessages.length - 1]?.role !== 'assistant' && <div className="chat-message ai">Thinking...</div>}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="chat-input-area">
                    <input
                      type="text"
                      placeholder={
                        !ollamaConnected 
                          ? "Ollama disconnected (check settings)" 
                          : (!toolsSupported ? "Model does not support tools" : "Ask a question...")
                      }
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                      disabled={isChatLoading || !ollamaConnected || !toolsSupported}
                    />
                    <button
                      className="ghost small"
                      onClick={handleSendMessage}
                      disabled={isChatLoading || !chatInput.trim() || !ollamaConnected || !toolsSupported}
                    >
                      Send
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

      {showGameOverDialog && gameOver && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>{getGameOverTitle(gameOver, playerColor)}</h2>
            <p>{gameOver}</p>
            <div className="modal-actions">
              <button className="primary" onClick={() => startNewGame(playerColor)}>
                New Game
              </button>
              <button className="ghost" onClick={() => {
                enterAnalysisMode()
                setShowGameOverDialog(false)
              }}>
                Analyze Game
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="modal-overlay" onClick={(e) => {
          if (e.target === e.currentTarget) setShowSettings(false)
        }}>
          <div className="settings-modal">
            <div className="settings-sidebar">
              <div className="settings-sidebar-header">
                <span className="user-name">vibeChess</span>
                <span className="user-role">Settings</span>
              </div>
              <div className="settings-nav">
                <button 
                  className={`settings-nav-item ${settingsTab === 'ai' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('ai')}
                >
                  <Bot size={18} className="icon" />
                  Chess AI
                </button>
                <button 
                  className={`settings-nav-item ${settingsTab === 'board' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('board')}
                >
                  <Palette size={18} className="icon" />
                  Board Customization
                </button>
              </div>
            </div>
            <div className="settings-content">
              <div className="settings-header">
                <h2>{settingsTab === 'ai' ? 'Chess AI' : 'Board Customization'}</h2>
                <button className="close-button" onClick={() => setShowSettings(false)}>
                  <X size={20} />
                </button>
              </div>
              
              <div className="settings-body">
                {settingsTab === 'ai' && (
                  <div className="settings-section">
                    <p className="muted">Configure your local LLM connection (Ollama).</p>
                    
                    <div className="setting-item">
                      <div className="setting-label">
                        <span>Ollama URL</span>
                        <span className="setting-desc">Endpoint for the Ollama API</span>
                      </div>
                      <div style={{ position: 'relative', display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input 
                          className="setting-input" 
                          type="text" 
                          value={ollamaUrl} 
                          onChange={(e) => setOllamaUrl(e.target.value)}
                        />
                        <button className="ghost small" onClick={() => checkOllamaConnection(true)}>
                          Test
                        </button>
                        {connectionStatusMsg && (
                          <span style={{ 
                            position: 'absolute',
                            top: '100%',
                            right: 0,
                            marginTop: 4,
                            fontSize: 11,
                            fontWeight: 500,
                            color: ollamaConnected ? 'var(--accent)' : '#ff6b6b',
                            whiteSpace: 'nowrap'
                          }}>
                            {connectionStatusMsg}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="setting-item">
                      <div className="setting-label">
                        <span>Model Name</span>
                        <span className="setting-desc">Select from available models</span>
                      </div>
                      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <select 
                          className="setting-select" 
                          value={ollamaModel} 
                          onChange={(e) => setOllamaModel(e.target.value)}
                          disabled={!ollamaConnected || availableModels.length === 0}
                        >
                          {availableModels.length > 0 ? (
                            availableModels.map((model) => (
                              <option key={model} value={model}>{model}</option>
                            ))
                          ) : (
                            <option value={ollamaModel}>{ollamaModel} (Not connected)</option>
                          )}
                        </select>
                        {ollamaConnected && !toolsSupported && (
                          <span style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, fontSize: 11, color: '#ff6b6b', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            This model does not appear to support tools
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {settingsTab === 'board' && (
                  <div className="settings-section">
                    <p className="muted">Customize the board appearance.</p>
                    {/* Board Settings will go here */}
                    <div className="setting-item">
                      <div className="setting-label">
                        <span>Board Theme</span>
                        <span className="setting-desc">Select the color scheme for the board</span>
                      </div>
                      <select className="setting-select" disabled>
                        <option>Green (Default)</option>
                        <option>Blue</option>
                        <option>Brown</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
