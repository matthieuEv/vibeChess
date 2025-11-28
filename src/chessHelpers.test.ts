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

describe('chessHelpers', () => {
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

    it('stops replay if an invalid move is encountered', () => {
        // Create a history with a valid move then an invalid one manually
        const validMove = { from: 'e2', to: 'e4', color: 'w', piece: 'p', san: 'e4', flags: 'n', lan: 'e2e4', before: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', after: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1' }
        const invalidMove = { from: 'e2', to: 'e5', color: 'w', piece: 'p', san: 'e5' } 
        
        // @ts-expect-error - testing invalid input
        const { sanitized } = sanitizeVerboseHistory([validMove, invalidMove])
        
        // Should only contain the first valid move
        expect(sanitized.length).toBe(1)
        expect(sanitized[0].san).toBe('e4')
    })
    
    it('handles empty history', () => {
        const { sanitized, replay } = sanitizeVerboseHistory([])
        expect(sanitized.length).toBe(0)
        expect(replay.fen()).toBe(new Chess().fen())
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
      // Entry 0 is start pos, so no playedMove. Entry 1 is after e4.
      expect(entries[1].playedMove?.uci).toBe('e2e4')
    })

    it('assigns correct move indices', () => {
        const game = new Chess()
        game.move('e4')
        game.move('e5')
        const verbose = game.history({ verbose: true })
        const entries = buildAnalysisEntriesFromVerbose(verbose)
        
        // Entry 0: Start position (moveIndex 0)
        expect(entries[0].moveIndex).toBe(0)
        // Entry 1: After e4 (moveIndex 1)
        expect(entries[1].moveIndex).toBe(1)
        // Entry 2: After e5 (moveIndex 2)
        expect(entries[2].moveIndex).toBe(2)
    })

    it('correctly identifies last and next moves', () => {
        const game = new Chess()
        game.move('e4') // White
        game.move('e5') // Black
        const verbose = game.history({ verbose: true })
        const entries = buildAnalysisEntriesFromVerbose(verbose)
        
        // Entry 0 (Start): Next move was e4
        expect(entries[0].playedMove).toBeUndefined() // No move played to get here
        expect(entries[0].nextMove?.san).toBe('e4')
        
        // Entry 1 (After e4): Played e4, Next is e5
        expect(entries[1].playedMove?.san).toBe('e4')
        expect(entries[1].nextMove?.san).toBe('e5')
        
        // Entry 2 (After e5): Played e5, Next is undefined
        expect(entries[2].playedMove?.san).toBe('e5')
        expect(entries[2].nextMove).toBeUndefined()
    })
    
    it('handles empty history correctly', () => {
        const entries = buildAnalysisEntriesFromVerbose([])
        expect(entries.length).toBe(1) // Just the start position
        expect(entries[0].fen).toBe(new Chess().fen())
        expect(entries[0].playedMove).toBeUndefined()
        expect(entries[0].nextMove).toBeUndefined()
    })
  })
})
