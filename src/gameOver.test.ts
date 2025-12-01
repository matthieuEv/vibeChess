import { describe, it, expect } from 'vitest'
import { getGameOverTitle } from './chessHelpers'

describe('getGameOverTitle', () => {
  it('should return empty string if gameOver is null', () => {
    expect(getGameOverTitle(null, 'white')).toBe('')
  })

  it('should return "You Win!" when White wins and player is White', () => {
    expect(getGameOverTitle('White wins by checkmate', 'white')).toBe('You Win!')
  })

  it('should return "You Win!" when Black wins and player is Black', () => {
    expect(getGameOverTitle('Black wins by checkmate', 'black')).toBe('You Win!')
  })

  it('should return "You Lost" when Black wins and player is White', () => {
    expect(getGameOverTitle('Black wins by checkmate', 'white')).toBe('You Lost')
  })

  it('should return "You Lost" when White wins and player is Black', () => {
    expect(getGameOverTitle('White wins by checkmate', 'black')).toBe('You Lost')
  })

  it('should return "Game Over" for draws', () => {
    expect(getGameOverTitle('Draw by repetition', 'white')).toBe('Game Over')
    expect(getGameOverTitle('Stalemate', 'black')).toBe('Game Over')
    expect(getGameOverTitle('Draw (insufficient material)', 'white')).toBe('Game Over')
  })
})
