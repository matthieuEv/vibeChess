import { Chess } from 'chess.js'
import type { Move, Square } from 'chess.js'

export type AnalysisEntry = {
  fen: string
  moveIndex: number
  playedMove?: {
    san: string
    uci: string
    from: Square
    to: Square
  }
  nextMove?: {
    san: string
    uci: string
    from: Square
    to: Square
  }
  turn: 'w' | 'b'
}

export const sanitizeVerboseHistory = (verboseMoves: Move[]) => {
  const replay = new Chess()
  const sanitized: Move[] = []

  for (let i = 0; i < verboseMoves.length; i++) {
    const mv = verboseMoves[i]
    try {
      const applied = replay.move({
        from: mv.from as Square,
        to: mv.to as Square,
        promotion: mv.promotion,
      })
      if (applied) {
        sanitized.push(applied)
      } else {
        break
      }
    } catch {
      break
    }
  }

  return { sanitized, replay }
}

export const buildAnalysisEntriesFromVerbose = (verboseMoves: Move[]) => {
  const analyser = new Chess()
  const entries: AnalysisEntry[] = []

  // Initial state (Start of game)
  entries.push({
    fen: analyser.fen(),
    moveIndex: 0,
    turn: analyser.turn(),
    // playedMove is undefined
    // nextMove will be filled if there is one
  })

  verboseMoves.forEach((move, idx) => {
    const moveResult = analyser.move({
      from: move.from as Square,
      to: move.to as Square,
      promotion: move.promotion,
    })
    
    if (!moveResult) {
      // Should not happen if sanitized, but safe to stop
      return
    }

    const moveData = {
      san: moveResult.san,
      uci: `${moveResult.from}${moveResult.to}${moveResult.promotion ?? ''}`,
      from: moveResult.from as Square,
      to: moveResult.to as Square,
    }

    // Update the previous entry's nextMove
    entries[entries.length - 1].nextMove = moveData

    // Push the new state
    entries.push({
      fen: analyser.fen(),
      moveIndex: idx + 1,
      playedMove: moveData,
      turn: analyser.turn(),
    })
  })

  return entries
}

export const getGameOverTitle = (gameOver: string | null, playerColor: 'white' | 'black') => {
  if (!gameOver) return ''
  const isWhite = playerColor === 'white'
  
  if (isWhite && gameOver.includes('White wins')) return 'You Win!'
  if (!isWhite && gameOver.includes('Black wins')) return 'You Win!'
  
  if (isWhite && gameOver.includes('Black wins')) return 'You Lost'
  if (!isWhite && gameOver.includes('White wins')) return 'You Lost'
  
  return 'Game Over'
}
