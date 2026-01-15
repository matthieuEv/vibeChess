import type { BoardThemeKey } from './Settings'
import type { ColorChoice, GameMode } from './chess/types'
import { snapMaiaElo, type MaiaElo } from './engine/maiaEngine'

export type PlayerConfig = {
  gameMode: GameMode
  colorChoice: ColorChoice
  elo: MaiaElo
  boardTheme: BoardThemeKey
  takebackLimit: number
  allowEloChangeMidGame: boolean
}

type StoredPlayerConfig = Omit<PlayerConfig, 'takebackLimit'> & {
  takebackLimit: number | null
}

const LOCAL_STORAGE_KEY = 'vibeChess.config'

const getIpcRenderer = () => {
  if (typeof window === 'undefined') return null
  const anyWindow = window as typeof window & { require?: (module: string) => unknown }
  if (!anyWindow?.process?.versions?.electron || !anyWindow.require) return null
  try {
    return anyWindow.require('electron').ipcRenderer as {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    }
  } catch {
    return null
  }
}

const isGameMode = (value: unknown): value is GameMode =>
  value === 'vs-maia' || value === '1v1'

const isColorChoice = (value: unknown): value is ColorChoice =>
  value === 'white' || value === 'black' || value === 'random'

const isBoardThemeKey = (value: unknown): value is BoardThemeKey =>
  value === 'green' || value === 'brown' || value === 'blue' || value === 'gray'

const normalizeConfig = (value: unknown): Partial<PlayerConfig> | null => {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  const result: Partial<PlayerConfig> = {}

  if (isGameMode(data.gameMode)) result.gameMode = data.gameMode
  if (isColorChoice(data.colorChoice)) result.colorChoice = data.colorChoice
  if (typeof data.elo === 'number' && Number.isFinite(data.elo)) {
    result.elo = snapMaiaElo(data.elo)
  }
  if (isBoardThemeKey(data.boardTheme)) result.boardTheme = data.boardTheme

  if (data.takebackLimit === null) {
    result.takebackLimit = Infinity
  } else if (typeof data.takebackLimit === 'number' && Number.isFinite(data.takebackLimit)) {
    result.takebackLimit = Math.max(0, Math.floor(data.takebackLimit))
  }

  if (typeof data.allowEloChangeMidGame === 'boolean') {
    result.allowEloChangeMidGame = data.allowEloChangeMidGame
  }

  return result
}

const toStoredConfig = (config: PlayerConfig): StoredPlayerConfig => ({
  ...config,
  takebackLimit:
    config.takebackLimit === Infinity
      ? null
      : Math.max(0, Math.floor(config.takebackLimit)),
})

export const loadPlayerConfig = async (): Promise<Partial<PlayerConfig> | null> => {
  const ipc = getIpcRenderer()
  if (ipc) {
    try {
      const data = await ipc.invoke('config:read')
      return normalizeConfig(data)
    } catch {
      return null
    }
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return null
    return normalizeConfig(JSON.parse(raw))
  } catch {
    return null
  }
}

export const savePlayerConfig = async (config: PlayerConfig): Promise<void> => {
  const payload: StoredPlayerConfig = toStoredConfig(config)

  const ipc = getIpcRenderer()
  if (ipc) {
    await ipc.invoke('config:write', payload)
    return
  }

  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore storage failures in browser mode.
  }
}
