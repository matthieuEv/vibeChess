import { Chess } from 'chess.js'
import type { PieceSymbol, Square } from 'chess.js'

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export const computeSkillLevel = (elo: number) => {
  // SkillLevel 0-20
  const scaled = Math.round(((elo - 600) / (2800 - 600)) * 20)
  return clamp(scaled, 0, 20)
}

export const computeBlunderProbability = (elo: number) => {
  // Lower elo => more blunders.
  // 600 ELO should be very blunder-prone (e.g. ~80% chance to play sub-optimally)
  if (elo >= 1600) return 0.02
  const t = clamp((1600 - elo) / 1000, 0, 1) // 600 => 1, 1600 => 0
  // Scale from 0.05 (at 1600) to 0.80 (at 600)
  return 0.05 + t * 0.75
}

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
