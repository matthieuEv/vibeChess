import { describe, it, expect } from 'vitest'
import {
  snapMaiaElo,
  MAIA_ELOS,
  MAIA_MIN_ELO,
  MAIA_MAX_ELO,
  MAIA_STEP,
  MAIA_DEFAULT_ELO,
  type MaiaElo,
} from './maiaEngine'

describe('Maia ELO Constants', () => {
  it('should have correct ELO range', () => {
    expect(MAIA_MIN_ELO).toBe(1100)
    expect(MAIA_MAX_ELO).toBe(1900)
    expect(MAIA_STEP).toBe(100)
  })

  it('should have 9 ELO levels', () => {
    expect(MAIA_ELOS).toHaveLength(9)
  })

  it('should have a valid default ELO', () => {
    expect(MAIA_ELOS).toContain(MAIA_DEFAULT_ELO)
    expect(MAIA_DEFAULT_ELO).toBe(1500)
  })

  it('should have sequential ELO values with correct step', () => {
    for (let i = 1; i < MAIA_ELOS.length; i++) {
      expect(MAIA_ELOS[i] - MAIA_ELOS[i - 1]).toBe(MAIA_STEP)
    }
  })
})

describe('snapMaiaElo', () => {
  describe('exact values', () => {
    it('should return the same value for exact ELO matches', () => {
      expect(snapMaiaElo(1100)).toBe(1100)
      expect(snapMaiaElo(1300)).toBe(1300)
      expect(snapMaiaElo(1600)).toBe(1600)
      expect(snapMaiaElo(1900)).toBe(1900)
    })
  })

  describe('rounding to nearest', () => {
    it('should round down when closer to lower ELO', () => {
      expect(snapMaiaElo(1101)).toBe(1100)
      expect(snapMaiaElo(1120)).toBe(1100)
      expect(snapMaiaElo(1149)).toBe(1100)
    })

    it('should round up when closer to higher ELO', () => {
      expect(snapMaiaElo(1151)).toBe(1200)
      expect(snapMaiaElo(1180)).toBe(1200)
      expect(snapMaiaElo(1199)).toBe(1200)
    })

    it('should round to nearest for mid-point values', () => {
      expect(snapMaiaElo(1150)).toBe(1200) // Math.round rounds 0.5 up
      expect(snapMaiaElo(1250)).toBe(1300)
      expect(snapMaiaElo(1350)).toBe(1400)
      expect(snapMaiaElo(1450)).toBe(1500)
      expect(snapMaiaElo(1550)).toBe(1600)
      expect(snapMaiaElo(1650)).toBe(1700)
      expect(snapMaiaElo(1750)).toBe(1800)
      expect(snapMaiaElo(1850)).toBe(1900)
    })
  })

  describe('clamping to valid range', () => {
    it('should clamp values below minimum to MAIA_MIN_ELO', () => {
      expect(snapMaiaElo(0)).toBe(1100)
      expect(snapMaiaElo(500)).toBe(1100)
      expect(snapMaiaElo(1000)).toBe(1100)
      expect(snapMaiaElo(1099)).toBe(1100)
    })

    it('should clamp values above maximum to MAIA_MAX_ELO', () => {
      expect(snapMaiaElo(2000)).toBe(1900)
      expect(snapMaiaElo(2500)).toBe(1900)
      expect(snapMaiaElo(3000)).toBe(1900)
      expect(snapMaiaElo(9999)).toBe(1900)
    })

    it('should handle negative values', () => {
      expect(snapMaiaElo(-100)).toBe(1100)
      expect(snapMaiaElo(-1000)).toBe(1100)
    })
  })

  describe('edge cases', () => {
    it('should handle very large numbers', () => {
      expect(snapMaiaElo(1000000)).toBe(1900)
      expect(snapMaiaElo(Number.MAX_SAFE_INTEGER)).toBe(1900)
    })

    it('should handle very small numbers', () => {
      expect(snapMaiaElo(Number.MIN_SAFE_INTEGER)).toBe(1100)
    })

    it('should handle decimal values', () => {
      expect(snapMaiaElo(1234.56)).toBe(1200)
      expect(snapMaiaElo(1567.89)).toBe(1600)
      expect(snapMaiaElo(1749.99)).toBe(1700)
    })
  })

  describe('all valid ELO levels', () => {
    it('should correctly snap to each valid ELO level', () => {
      const testCases: Array<[number, MaiaElo]> = [
        [1125, 1100],
        [1225, 1200],
        [1325, 1300],
        [1425, 1400],
        [1525, 1500],
        [1625, 1600],
        [1725, 1700],
        [1825, 1800],
        [1925, 1900],
      ]

      testCases.forEach(([input, expected]) => {
        expect(snapMaiaElo(input)).toBe(expected)
      })
    })
  })

  describe('type safety', () => {
    it('should return a valid MaiaElo type', () => {
      const result = snapMaiaElo(1550)
      // TypeScript compile-time check: result should be assignable to MaiaElo
      const typedResult: MaiaElo = result
      expect(MAIA_ELOS).toContain(typedResult)
    })
  })
})
