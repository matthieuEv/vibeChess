import { Chess, SQUARES } from 'chess.js'
import type { PieceSymbol, Square } from 'chess.js'
import type { PlayerColor } from './types'

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export const uciToSan = (fen: string, uci: string) => {
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

export const buildGameOverText = (game: Chess) => {
  if (game.isCheckmate()) {
    return `${game.turn() === 'w' ? 'Black' : 'White'} wins by checkmate`
  }
  if (game.isStalemate()) return 'Stalemate'
  if (game.isThreefoldRepetition()) return 'Draw by repetition'
  if (game.isInsufficientMaterial()) return 'Draw (insufficient material)'
  if (game.isDraw()) return 'Draw'
  return null
}

export const isPlayerVictory = (game: Chess, playerColor: PlayerColor) => {
  if (!game.isCheckmate()) return false
  const winner = game.turn() === 'w' ? 'black' : 'white'
  return winner === playerColor
}

export const findKingSquare = (game: Chess, color: 'w' | 'b'): Square | null => {
  for (const sq of SQUARES) {
    const piece = game.get(sq)
    if (piece && piece.type === 'k' && piece.color === color) {
      return sq
    }
  }
  return null
}
