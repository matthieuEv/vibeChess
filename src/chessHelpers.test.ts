import { describe, it, expect } from 'vitest'
import { Chess } from 'chess.js'
import { buildAnalysisEntriesFromVerbose, sanitizeVerboseHistory } from './chessHelpers'

const openSicilianMoves = [
  'e4',
  'c5',
  'Nf3',
  'd6',
  'd4',
  'cxd4',
  'Nxd4',
  'Nf6',
  'Nc3',
  'a6',
  'Be3',
  'e6',
  'f3',
  'b5',
  'Qd2',
  'Nbd7',
] as const

describe('sanitizeVerboseHistory', () => {
  it('replays a full history without adding promotions', () => {
    const game = new Chess()
    openSicilianMoves.forEach((mv) => game.move(mv))
    const verbose = game.history({ verbose: true })

    const { sanitized, replay } = sanitizeVerboseHistory(verbose)

    expect(sanitized.length).toBe(verbose.length)
    expect(replay.fen()).toBe(game.fen())
    expect(sanitized.some((m) => m.promotion)).toBe(false)
  })

  it('keeps promotions only when present', () => {
    const game = new Chess()
    ;['a4', 'h5', 'a5', 'h4', 'a6', 'h3', 'axb7', 'hxg2', 'bxa8=Q', 'gxf1=Q'].forEach((mv) =>
      game.move(mv),
    )
    const verbose = game.history({ verbose: true })

    const { sanitized, replay } = sanitizeVerboseHistory(verbose)

    expect(sanitized.length).toBe(verbose.length)
    expect(replay.history().slice(-1)[0]).toContain('=Q')
    expect(sanitized.filter((m) => m.promotion).length).toBeGreaterThan(0)
  })
})

describe('buildAnalysisEntriesFromVerbose', () => {
  it('builds an entry-by-entry list plus final FEN', () => {
    const game = new Chess()
    openSicilianMoves.forEach((mv) => game.move(mv))
    const verbose = game.history({ verbose: true })

    const entries = buildAnalysisEntriesFromVerbose(verbose)

    expect(entries.length).toBe(verbose.length + 1)
    expect(entries[0].fen).toBe(new Chess().fen())
    expect(entries[entries.length - 1].fen).toBe(game.fen())
    expect(entries[0].playedMove?.uci).toBe('e2e4')
  })
})
