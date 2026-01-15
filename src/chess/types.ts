export type PlayerColor = 'white' | 'black'
export type ColorChoice = PlayerColor | 'random'

export type GameMode = 'vs-maia' | '1v1'

export interface GameModeInfo {
  id: GameMode
  name: string
  description: string
  icon: 'bot' | 'users'
}

export const GAME_MODES: GameModeInfo[] = [
  {
    id: 'vs-maia',
    name: 'Vs Maia',
    description: 'Affrontez l\'IA Maia',
    icon: 'bot',
  },
  {
    id: '1v1',
    name: '1v1 Local',
    description: 'Jouez à deux sur le même écran',
    icon: 'users',
  },
]
