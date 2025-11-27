import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Chess, SQUARES } from 'chess.js'
import type { Move, PieceSymbol, Square } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import './App.css'
import {
  buildAnalysisEntriesFromVerbose,
  type AnalysisEntry,
} from './chessHelpers'

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

const ENGINE_PATH = './engine/stockfish-17.1-lite-single-03e3232.js'
const THINK_TIME_MS = 1200
const ENGINE_MIN_ELO = 1320 // Stockfish UCI_Elo floor is around 1320
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

const computeSkillLevel = (elo: number) => {
  // SkillLevel 0-20
  const scaled = Math.round(((elo - 600) / (2800 - 600)) * 20)
  return clamp(scaled, 0, 20)
}

const computeBlunderProbability = (elo: number) => {
  // Lower elo => more blunders.
  // 600 ELO should be very blunder-prone (e.g. ~80% chance to play sub-optimally)
  if (elo >= 1600) return 0.02
  const t = clamp((1600 - elo) / 1000, 0, 1) // 600 => 1, 1600 => 0
  // Scale from 0.05 (at 1600) to 0.80 (at 600)
  return 0.05 + t * 0.75
}

const uciToSan = (fen: string, uci: string) => {
  try {
    const chess = new Chess(fen)
    const move = chess.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: uci[4] as PieceSymbol | undefined,
    })
    return move?.san ?? uci
  } catch {
    return uci
  }
}

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

  const requestBestMove = async (fen: string) => {
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

  const requestWeakOrBestMove = async (fen: string, eloValue: number) => {
    const blunderProb = computeBlunderProbability(eloValue)
    if (blunderProb <= 0.03) {
      return requestBestMove(fen)
    }

    const suggestions = await requestMultiSuggestions(fen, 3)
    const picked = pickMoveWithBlunder(fen, suggestions, blunderProb)
    return picked ?? (await requestBestMove(fen))
  }

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
  }, [])

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

  const handleSquareClick = (arg: any) => {
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
  }, [boardFen, engineReady, gameOver, analysisMode, playerColor, elo, requestWeakOrBestMove])

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

  return (
    <div className="app-container">
      <nav className="sidebar">
        <div className="sidebar-header">
          <p className="eyebrow">Local Stockfish 17.1</p>
          <h1>vibeChess</h1>
          <p className="muted" style={{ fontSize: 13 }}>
            Desktop-class chess app running locally.
          </p>
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
                <span>{elo}</span>
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

        {analysisMode && (
          <div className="analysis-panel">
            {analysisError && <div style={{ color: 'red', fontSize: 12, marginBottom: 8 }}>{analysisError}</div>}
            {analysisLoading && <div style={{ fontSize: 12, marginBottom: 8 }}>Loading analysis...</div>}
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
        )}
      </aside>

      {showGameOverDialog && gameOver && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Game Over</h2>
            <p>{gameOver}</p>
            <div className="modal-actions">
              <button className="primary" onClick={() => startNewGame(playerColor)}>
                New Game
              </button>
              <button className="ghost" onClick={() => setShowGameOverDialog(false)}>
                View Board
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
