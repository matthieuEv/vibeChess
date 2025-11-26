import { Chess } from 'chess.js'
import type { Move, Square } from 'chess.js'

export type AnalysisEntry = {
  fen: string
  index: number
  playedMove?: {
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

  verboseMoves.forEach((mv, idx) => {
    const applied = replay.move({
      from: mv.from as Square,
      to: mv.to as Square,
      promotion: mv.promotion, // do not force 'q' if missing
    }) as Move | null
    if (!applied) {
      throw new Error(`Invalid history at move index ${idx + 1} (${mv.san})`)
    }
    sanitized.push(applied)
  })

  return { sanitized, replay }
}

export const buildAnalysisEntriesFromVerbose = (verboseMoves: Move[]) => {
  const analyser = new Chess()
  const entries: AnalysisEntry[] = []

  verboseMoves.forEach((move, idx) => {
    const fenBefore = analyser.fen()
    const turn = analyser.turn()

    const moveResult = analyser.move({
      from: move.from as Square,
      to: move.to as Square,
      promotion: move.promotion,
    })
    if (!moveResult) {
      throw new Error(`Move ${idx + 1} is invalid (${move.san})`)
    }

    entries.push({
      fen: fenBefore,
      index: idx,
      playedMove: {
        san: moveResult.san,
        uci: `${moveResult.from}${moveResult.to}${moveResult.promotion ?? ''}`,
        from: moveResult.from as Square,
        to: moveResult.to as Square,
      },
      turn,
    })
  })

  entries.push({
    fen: analyser.fen(),
    index: verboseMoves.length,
    turn: analyser.turn(),
  })

  return entries
}
