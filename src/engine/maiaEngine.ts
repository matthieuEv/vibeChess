import makeZerofish, { type Line, type ZeroNet } from 'zerofish'
import { ungzip } from 'pako'
import { clamp } from '../chess/utils'
import { Chess } from 'chess.js'

/**
 * Available Maia ELO ratings.
 * Maia models are trained on human games at specific rating levels.
 */
export const MAIA_ELOS = [
  1100,
  1200,
  1300,
  1400,
  1500,
  1600,
  1700,
  1800,
  1900,
] as const

/**
 * Valid Maia ELO rating type.
 */
export type MaiaElo = (typeof MAIA_ELOS)[number]

/** Minimum supported Maia ELO rating. */
export const MAIA_MIN_ELO = MAIA_ELOS[0]

/** Maximum supported Maia ELO rating. */
export const MAIA_MAX_ELO = MAIA_ELOS[MAIA_ELOS.length - 1]

/** Step between consecutive Maia ELO ratings. */
export const MAIA_STEP = 100

/** Default Maia ELO rating used for initialization. */
export const MAIA_DEFAULT_ELO: MaiaElo = 1600

const appBaseUrl =
  typeof window === 'undefined' ? new URL('http://localhost/') : new URL('.', window.location.href)
const DEFAULT_ENGINE_BASE = new URL('engine/', appBaseUrl).toString()
const DEFAULT_WEIGHTS_BASE = new URL('maia/', appBaseUrl).toString()
let zerofishJsUrl = new URL('zerofishEngine.js', DEFAULT_ENGINE_BASE).toString()
let zerofishWasmUrl = new URL('zerofishEngine.wasm', DEFAULT_ENGINE_BASE).toString()
let weightsBaseUrl = DEFAULT_WEIGHTS_BASE

type MaiaAssetPaths = {
  zerofishJsUrl?: string
  zerofishWasmUrl?: string
  weightsBaseUrl?: string
}

export const setMaiaAssetPaths = (next: MaiaAssetPaths) => {
  if (next.zerofishJsUrl) {
    zerofishJsUrl = next.zerofishJsUrl.startsWith('http') || next.zerofishJsUrl.startsWith('/')
      ? next.zerofishJsUrl
      : new URL(next.zerofishJsUrl, window.location.href).toString()
  }
  if (next.zerofishWasmUrl) {
    zerofishWasmUrl = next.zerofishWasmUrl.startsWith('http') || next.zerofishWasmUrl.startsWith('/')
      ? next.zerofishWasmUrl
      : new URL(next.zerofishWasmUrl, window.location.href).toString()
  }
  if (next.weightsBaseUrl) {
    const normalized = next.weightsBaseUrl.endsWith('/')
      ? next.weightsBaseUrl
      : `${next.weightsBaseUrl}/`
    if (weightsBaseUrl !== normalized) {
      weightsBaseUrl = normalized
      weightsCache.clear()
    }
  }
}

/** Number of nodes to search when computing a move. */
const MAIA_NODE_BUDGET = 400 // Reduced from 800 to avoid OOM on first moves
/** Number of principal variations to request for move variety. */
const MAIA_MULTI_PV = 5

const MAIA_LOG_ENABLED =
  import.meta.env.DEV ||
  (typeof import.meta.env.VITE_DEBUG === 'string' && import.meta.env.VITE_DEBUG === '1')

const logMaia = (...args: unknown[]) => {
  if (!MAIA_LOG_ENABLED) return
  console.info('[Maia]', ...args)
}

/** Cache for loaded Maia model weights to avoid redundant network requests. */
const weightsCache = new Map<MaiaElo, Uint8Array>()

/**
 * Snaps an arbitrary numeric ELO value to the nearest valid Maia ELO rating.
 *
 * @param value - The ELO value to snap (will be clamped to min/max range)
 * @returns The nearest valid MaiaElo value
 *
 * @example
 * snapMaiaElo(1550) // returns 1600
 * snapMaiaElo(1234) // returns 1200
 * snapMaiaElo(2500) // returns 1900 (clamped to max)
 * snapMaiaElo(500)  // returns 1100 (clamped to min)
 */
export const snapMaiaElo = (value: number): MaiaElo => {
  const clamped = clamp(value, MAIA_MIN_ELO, MAIA_MAX_ELO)
  const snapped =
    Math.round((clamped - MAIA_MIN_ELO) / MAIA_STEP) * MAIA_STEP + MAIA_MIN_ELO
  return snapped as MaiaElo
}

/**
 * Loads and decompresses Maia model weights for a specific ELO rating.
 * Results are cached to avoid redundant network requests.
 *
 * @param elo - The Maia ELO rating to load weights for
 * @returns The decompressed model weights as a Uint8Array
 * @throws {Error} If the weights cannot be fetched
 */
const readLocalFile = async (fileUrl: string) => {
  const req = typeof window !== 'undefined' ? (window as typeof window & { require?: NodeRequire }).require : null
  if (!req) {
    throw new Error('Local file access is unavailable in this environment.')
  }
  const { fileURLToPath } = req('url') as typeof import('url')
  const fs = req('fs') as typeof import('fs')
  const filePath = fileURLToPath(fileUrl)
  return fs.promises.readFile(filePath)
}

const loadMaiaWeights = async (elo: MaiaElo) => {
  const cached = weightsCache.get(elo)
  if (cached) {
    logMaia('weights cache hit', { elo, cachedSize: cached.length })
    return cached
  }

  const url = `${weightsBaseUrl}maia-${elo}.pb.gz`
  const loadStart = performance.now()
  logMaia('weights load start', { elo, url })
  let bytes: Uint8Array
  let contentEncoding = 'none'
  let contentLength: string | number = 'unknown'
  if (url.startsWith('file://')) {
    const buffer = await readLocalFile(url)
    bytes = new Uint8Array(buffer)
    contentLength = bytes.length
  } else {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to load Maia weights for ${elo}: ${response.status} ${response.statusText}`)
    }
    contentEncoding = response.headers.get('content-encoding') ?? 'none'
    contentLength = response.headers.get('content-length') ?? 'unknown'
    const buffer = await response.arrayBuffer()
    bytes = new Uint8Array(buffer)
  }
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  
  logMaia('weights decompress start', { elo, compressedSize: bytes.length, isGzip })
  const decompressStart = performance.now()
  const weights = isGzip ? ungzip(bytes) : bytes
  const decompressMs = Math.round(performance.now() - decompressStart)
  
  logMaia('weights load done', {
    elo,
    compressedSize: bytes.length,
    decompressedSize: weights.length,
    gzip: isGzip,
    contentEncoding,
    contentLength,
    loadMs: Math.round(performance.now() - loadStart),
    decompressMs,
  })
  weightsCache.set(elo, weights)
  return weights
}

/**
 * Creates a Zerofish network configuration for a specific Maia ELO.
 *
 * @param elo - The Maia ELO rating
 * @returns A ZeroNet configuration object
 */
const getNet = (elo: MaiaElo): ZeroNet => ({
  key: `maia-${elo}`,
  fetch: () => loadMaiaWeights(elo),
})

/**
 * Converts Chess960 castling notation to standard UCI notation.
 * Zerofish may return castling moves in Chess960 format (king to rook square).
 * 
 * @param fen - The position in FEN notation
 * @param uci - The move in UCI notation (possibly Chess960 format)
 * @returns The move in standard UCI notation
 */
const normalizeUciMove = (fen: string, uci: string): string => {
  if (!uci || uci.length < 4) return uci

  const from = uci.slice(0, 2)
  const to = uci.slice(2, 4)
  const promotion = uci[4]

  // Check if this is a king move (potential castling)
  const isKingMove = from === 'e1' || from === 'e8'
  if (!isKingMove) {
    return uci
  }

  // Parse the position to check for castling rights
  const fenParts = fen.split(' ')
  const castlingRights = fenParts[2] || '-'
  
  // Convert Chess960 castling notation to standard notation
  // White kingside: e1h1 -> e1g1
  if (from === 'e1' && to === 'h1' && castlingRights.includes('K')) {
    logMaia('converting castling move', { original: uci, converted: 'e1g1', type: 'white-kingside' })
    return 'e1g1' + (promotion || '')
  }
  // White queenside: e1a1 -> e1c1
  if (from === 'e1' && to === 'a1' && castlingRights.includes('Q')) {
    logMaia('converting castling move', { original: uci, converted: 'e1c1', type: 'white-queenside' })
    return 'e1c1' + (promotion || '')
  }
  // Black kingside: e8h8 -> e8g8
  if (from === 'e8' && to === 'h8' && castlingRights.includes('k')) {
    logMaia('converting castling move', { original: uci, converted: 'e8g8', type: 'black-kingside' })
    return 'e8g8' + (promotion || '')
  }
  // Black queenside: e8a8 -> e8c8
  if (from === 'e8' && to === 'a8' && castlingRights.includes('q')) {
    logMaia('converting castling move', { original: uci, converted: 'e8c8', type: 'black-queenside' })
    return 'e8c8' + (promotion || '')
  }

  return uci
}

/**
 * Validates that a UCI move is legal in the given position.
 *
 * @param fen - The position in FEN notation
 * @param uci - The move in UCI notation
 * @returns true if the move is legal, false otherwise
 */
const isLegalUciMove = (fen: string, uci: string): boolean => {
  try {
    const chess = new Chess(fen)
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] as 'q' | 'r' | 'b' | 'n' | undefined,
    })
    return move !== null
  } catch {
    return false
  }
}

const normalizeAndValidateMove = (fen: string, uci: string): string | null => {
  if (!uci) return null
  const normalized = normalizeUciMove(fen, uci)
  return isLegalUciMove(fen, normalized) ? normalized : null
}

const collectMultiPvCandidates = (
  fen: string,
  lines: Line[][],
  maxCandidates: number,
): string[] => {
  if (!lines.length || maxCandidates <= 0) return []

  for (let depthIndex = lines.length - 1; depthIndex >= 0; depthIndex--) {
    const pvLines = lines[depthIndex]
    if (!pvLines?.length) continue

    const candidates: string[] = []
    const seen = new Set<string>()

    for (const line of pvLines) {
      const candidate = normalizeAndValidateMove(fen, line.moves?.[0] ?? '')
      if (!candidate || seen.has(candidate)) continue
      seen.add(candidate)
      candidates.push(candidate)
      if (candidates.length >= maxCandidates) break
    }

    if (candidates.length > 0) return candidates
  }

  return []
}

/**
 * Maia chess engine interface.
 * Provides methods to get moves, stop computation, and clean up resources.
 */
export type MaiaEngine = {
  /** Requests the best move for a given position and ELO level */
  getBestMove: (fen: string, elo: MaiaElo) => Promise<string | null>
  /** Stops the current move computation */
  stop: () => void
  /** Terminates the engine and releases resources */
  quit: () => void
}

/**
 * Creates and initializes a Maia chess engine instance.
 *
 * Maia is a human-like chess engine trained on human games at specific rating levels.
 * It uses neural network models (via Zerofish/WASM) to predict moves that humans
 * of a given ELO would play.
 *
 * @returns A promise that resolves to a MaiaEngine instance
 * @throws {Error} If the Zerofish engine fails to initialize
 *
 * @example
 * const engine = await createMaiaEngine()
 * const move = await engine.getBestMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 1500)
 * console.log(move) // e.g., "e2e4"
 */
export const createMaiaEngine = async (): Promise<MaiaEngine> => {
  const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined'
  const isCrossOriginIsolated =
    typeof globalThis !== 'undefined' &&
    'crossOriginIsolated' in globalThis &&
    Boolean((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated)

  logMaia('init', { hasSharedArrayBuffer, isCrossOriginIsolated })

  if (!hasSharedArrayBuffer || !isCrossOriginIsolated) {
    throw new Error(
      'Maia requires SharedArrayBuffer. Enable COOP/COEP (cross-origin isolation) to load the engine.',
    )
  }

  // Attach global listeners to capture worker errors and unhandled rejections
  const onGlobalError = (ev: ErrorEvent) => {
    try {
      logMaia('global error', {
        message: ev.message,
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
        error: ev.error?.toString?.() ?? ev.error,
      })
    } catch (e) {
      logMaia('onGlobalError logging failed', e)
    }
  }

  const onUnhandledRejection = (ev: PromiseRejectionEvent) => {
    try {
      logMaia('unhandledrejection', { reason: ev.reason })
    } catch (e) {
      logMaia('onUnhandledRejection logging failed', e)
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('error', onGlobalError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
  }

  logMaia('zerofish init start', { js: zerofishJsUrl, wasm: zerofishWasmUrl })
  let zerofish
  try {
    zerofish = await makeZerofish({
      locator: (file) => (file.endsWith('.wasm') ? zerofishWasmUrl : zerofishJsUrl),
    })
  } catch (err) {
    logMaia('zerofish init error', err)
    if (typeof window !== 'undefined') {
      window.removeEventListener('error', onGlobalError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
    throw err
  }
  logMaia('zerofish init done', { zerofishType: typeof zerofish })

  const getBestMove = async (fen: string, elo: MaiaElo) => {
    const startedAt = performance.now()
    logMaia('search start', { elo, nodes: MAIA_NODE_BUDGET, fen })

    const doSearch = async (nodes: number) => {
      const searchId = Math.random().toString(36).slice(2, 9)
      try {
        // Log memory stats when available to help diagnose OOMs
        const perfWithMem = performance as unknown as {
          memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number }
        }
        const mem = perfWithMem.memory
        if (mem && typeof mem.usedJSHeapSize === 'number') {
          logMaia('memory before search', {
            searchId,
            usedJSHeapSize: mem.usedJSHeapSize,
            totalJSHeapSize: mem.totalJSHeapSize,
            jsHeapSizeLimit: mem.jsHeapSizeLimit,
            usedPercent: Math.round((mem.usedJSHeapSize / (mem.jsHeapSizeLimit ?? 1)) * 100),
          })
        }
      } catch (e) {
        logMaia('mem read failed', e)
      }

      const net = getNet(elo)
      const params = {
        fen,
        multipv: MAIA_MULTI_PV,
        netKey: net.key,
        nodes,
      }
      logMaia('goZero call start', { searchId, ...params })

      let result
      try {
        result = await zerofish.goZero(
          { fen },
          {
            multipv: MAIA_MULTI_PV,
            net,
            nodes,
          },
        )
        const rawBestmove = result.bestmove
        logMaia('goZero call success', { searchId, bestmove: rawBestmove, rawMove: rawBestmove })

        const candidateMoves = collectMultiPvCandidates(fen, result.lines, MAIA_MULTI_PV)
        let selectedMove = rawBestmove
        let selectionSource: 'bestmove' | 'multipv' = 'bestmove'

        if (candidateMoves.length > 0) {
          selectedMove = candidateMoves[Math.floor(Math.random() * candidateMoves.length)]
          selectionSource = 'multipv'
          logMaia('multipv selection', {
            searchId,
            candidates: candidateMoves,
            selectedMove,
          })
        }
        
        // Normalize and validate the move
        if (selectedMove) {
          let normalizedMove = normalizeAndValidateMove(fen, selectedMove)
          if (!normalizedMove && selectionSource === 'multipv' && rawBestmove) {
            logMaia('multipv move invalid, falling back to bestmove', {
              searchId,
              selectedMove,
              rawBestmove,
            })
            selectionSource = 'bestmove'
            normalizedMove = normalizeAndValidateMove(fen, rawBestmove)
          }

          logMaia('move validation', {
            searchId,
            originalMove: selectedMove,
            normalizedMove,
            isLegal: Boolean(normalizedMove),
            fen,
            selectionSource,
          })

          if (!normalizedMove) {
            logMaia('invalid move detected', {
              searchId,
              move: selectedMove,
              fen,
            })
            // Return null instead of throwing to allow retry
            return { bestmove: null }
          }

          // Return the normalized move
          result.bestmove = normalizedMove
        }
      } catch (err: unknown) {
        logMaia('goZero call failed', {
          searchId,
          errorType: err?.constructor?.name,
          errorMessage: err instanceof Error ? err.message : String(err),
          errorStack: err instanceof Error ? err.stack : undefined,
        })
        throw err
      }

      return result
    }

    try {
      const result = await doSearch(MAIA_NODE_BUDGET)
      const elapsedMs = Math.round(performance.now() - startedAt)
      logMaia('search done', { elo, bestmove: result.bestmove, elapsedMs })
      return result.bestmove || null
    } catch (err: unknown) {
      logMaia('search error', err)

      // Detect out-of-memory / abort errors from the WASM worker and retry with fewer nodes.
      const message = (err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: unknown }).message)
        : String(err)) || ''

      if (/OOM|Out of memory|Aborted/i.test(message)) {
        try {
          const retryNodes = Math.max(40, Math.floor(MAIA_NODE_BUDGET / 2))
          logMaia('OOM detected, retrying with smaller node budget', { retryNodes })
          const result2 = await doSearch(retryNodes)
          const elapsedMs = Math.round(performance.now() - startedAt)
          logMaia('search done (retry)', { elo, bestmove: result2.bestmove, elapsedMs })
          return result2.bestmove || null
        } catch (err2) {
          logMaia('retry failed after OOM', err2)
          // Attempt a clean shutdown of the engine to free resources.
          try {
            zerofish.stop()
          } catch (e) {
            logMaia('stop error during oom recovery', e)
          }
          try {
            zerofish.quit()
          } catch (e) {
            logMaia('quit error during oom recovery', e)
          }
          throw new Error('Maia engine ran out of memory (OOM) and failed to recover.')
        }
      }

      throw err
    }
  }

  const stop = () => {
    try {
      zerofish.stop()
    } catch (e) {
      logMaia('stop failed', e)
    }
  }

  const quit = () => {
    try {
      zerofish.quit()
      return
    } catch (e) {
      logMaia('quit failed', e)
    }

    try {
      zerofish.stop()
    } catch (e) {
      logMaia('stop failed during quit', e)
    }
  }
  // Remove global listeners when the engine is disposed
  try {
    if (typeof window !== 'undefined') {
      window.removeEventListener('error', onGlobalError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  } catch (e) {
    logMaia('remove listeners failed', e)
  }

  return {
    getBestMove,
    stop,
    quit,
  }
}

let maiaEnginePromise: Promise<MaiaEngine> | null = null

export const getMaiaEngine = () => {
  if (maiaEnginePromise) return maiaEnginePromise
  maiaEnginePromise = createMaiaEngine().catch((err) => {
    maiaEnginePromise = null
    throw err
  })
  return maiaEnginePromise
}
