import { describe, it, expect } from 'vitest'
import { clamp, computeSkillLevel, computeBlunderProbability, uciToSan } from './engineHelpers'

describe('engineHelpers', () => {
  describe('clamp', () => {
    it('returns value when within range', () => {
      expect(clamp(5, 0, 10)).toBe(5)
    })

    it('returns min when value is below min', () => {
      expect(clamp(-5, 0, 10)).toBe(0)
    })

    it('returns max when value is above max', () => {
      expect(clamp(15, 0, 10)).toBe(10)
    })

    it('handles min equals max', () => {
      expect(clamp(100, 5, 5)).toBe(5)
    })
    
    it('works with floating point numbers', () => {
      expect(clamp(5.5, 0, 10)).toBe(5.5)
      expect(clamp(-0.1, 0, 1)).toBe(0)
    })
  })

  describe('computeSkillLevel', () => {
    it('returns 0 for ELO 600', () => {
      expect(computeSkillLevel(600)).toBe(0)
    })

    it('returns 0 for ELO below 600', () => {
      expect(computeSkillLevel(100)).toBe(0)
    })

    it('returns 20 for ELO 2800', () => {
      expect(computeSkillLevel(2800)).toBe(20)
    })

    it('returns 20 for ELO above 2800', () => {
      expect(computeSkillLevel(3000)).toBe(20)
    })

    it('returns correct scaled value for 1700', () => {
      // (1700 - 600) / (2200) = 0.5. 0.5 * 20 = 10
      expect(computeSkillLevel(1700)).toBe(10)
    })
  })

  describe('computeBlunderProbability', () => {
    it('returns 0.02 for ELO 1600', () => {
      expect(computeBlunderProbability(1600)).toBe(0.02)
    })

    it('returns 0.02 for ELO above 1600', () => {
      expect(computeBlunderProbability(2000)).toBe(0.02)
    })

    it('returns approx 0.80 for ELO 600', () => {
      // t = (1600 - 600) / 1000 = 1
      // 0.05 + 1 * 0.75 = 0.80
      expect(computeBlunderProbability(600)).toBeCloseTo(0.80)
    })

    it('returns intermediate value for ELO 1100', () => {
      // t = (1600 - 1100) / 1000 = 0.5
      // 0.05 + 0.5 * 0.75 = 0.05 + 0.375 = 0.425
      expect(computeBlunderProbability(1100)).toBeCloseTo(0.425)
    })
  })

  describe('uciToSan', () => {
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

    it('converts simple pawn move', () => {
      expect(uciToSan(startFen, 'e2e4')).toBe('e4')
    })

    it('converts knight move', () => {
      expect(uciToSan(startFen, 'g1f3')).toBe('Nf3')
    })

    it('returns UCI if move is invalid for position', () => {
      expect(uciToSan(startFen, 'e2e5')).toBe('e2e5') // Invalid pawn move
    })

    it('returns UCI if FEN is invalid', () => {
      expect(uciToSan('invalid-fen', 'e2e4')).toBe('e2e4')
    })

    it('handles promotion correctly', () => {
      // Setup a position where a7 can capture b8 and promote
      const promoFen = '1r6/P7/8/8/8/8/8/k6K w - - 0 1'
      // a7xb8=Q
      expect(uciToSan(promoFen, 'a7b8q')).toBe('axb8=Q')
    })
    
    it('handles castling', () => {
        const castleFen = 'rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'
        expect(uciToSan(castleFen, 'e1g1')).toBe('O-O')
    })
  })
})
