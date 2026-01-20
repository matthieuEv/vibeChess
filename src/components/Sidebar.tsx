import type { ReactNode } from 'react'
import { Settings as SettingsIcon } from 'lucide-react'
import type { ColorChoice, GameMode } from '../chess/types'
import { MAIA_MAX_ELO, MAIA_MIN_ELO, MAIA_STEP } from '../engine/maiaEngine'
import GameModeSelector from './GameModeSelector'

type SidebarProps = {
  gameStarted: boolean
  botEngineReady: boolean
  analysisMode: boolean
  analysisAvailable: boolean
  engineThinking: boolean
  canTakeback: boolean
  remainingTakebacks: number
  elo: number
  colorChoice: ColorChoice
  gameMode: GameMode
  statusText: string
  statusOk: boolean
  statusHeadline?: string
  statusDetail?: string
  statusHeadlineTone?: 'accent' | 'neutral' | 'warn'
  statusDotTone?: 'ok' | 'warn' | 'error'
  isDebugMode: boolean
  allowEloChangeMidGame: boolean
  onlinePanel?: ReactNode
  onStartGame: () => void
  onStopGame: () => void
  onEnterAnalysis: () => void
  onExitAnalysis: () => void
  onTakeback: () => void
  onEloChange: (value: number) => void
  onColorChange: (color: ColorChoice) => void
  onGameModeChange: (mode: GameMode) => void
  onOpenSettings: () => void
}


export default function Sidebar({
  gameStarted,
  botEngineReady,
  analysisMode,
  analysisAvailable,
  engineThinking,
  canTakeback,
  remainingTakebacks,
  elo,
  colorChoice,
  gameMode,
  statusText,
  statusOk,
  statusHeadline,
  statusDetail,
  statusHeadlineTone,
  statusDotTone,
  isDebugMode,
  allowEloChangeMidGame,
  onlinePanel,
  onStartGame,
  onStopGame,
  onEnterAnalysis,
  onExitAnalysis,
  onTakeback,
  onEloChange,
  onColorChange,
  onGameModeChange,
  onOpenSettings,
}: SidebarProps) {
  const is1v1Mode = gameMode === '1v1'
  const isOnlineMode = gameMode === 'online'
  const isBotMode = gameMode === 'vs-maia'
  const canStartGame = is1v1Mode || (isBotMode && botEngineReady)

  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <h1>vibeChess</h1>
      </div>

      <div className="sidebar-menu">
        <GameModeSelector
          selectedMode={gameMode}
          disabled={gameStarted || isDebugMode}
          onModeChange={onGameModeChange}
        />

        {isOnlineMode && statusHeadline && (
          <div className={`online-turn-indicator ${statusHeadlineTone ?? ''}`}>
            {statusHeadline}
          </div>
        )}

        {isOnlineMode && onlinePanel && (
          <div className="menu-group">
            {onlinePanel}
          </div>
        )}

        {!isOnlineMode && (
          <div className="menu-group">
            <button
              className={gameStarted ? 'danger' : 'primary'}
              onClick={gameStarted ? onStopGame : onStartGame}
              disabled={!canStartGame}
            >
              {gameStarted ? 'Stop the Game' : 'Start Game'}
            </button>
            <button
              className="ghost"
              onClick={analysisMode ? onExitAnalysis : onEnterAnalysis}
              disabled={
                !analysisMode && (!analysisAvailable || engineThinking)
              }
            >
              {analysisMode ? 'Exit Analysis' : 'Analyze Game'}
            </button>
            <button
              className="ghost"
              onClick={onTakeback}
              disabled={!canTakeback}
              title={
                canTakeback
                  ? `Takebacks remaining: ${remainingTakebacks === Infinity ? 'Unlimited' : remainingTakebacks}`
                  : 'No takebacks available'
              }
            >
              Take Back{remainingTakebacks === Infinity ? '' : ` (${remainingTakebacks})`}
            </button>
          </div>
        )}

        {isBotMode && (
          <div className="menu-group">
            <p className="label">Maia Difficulty (ELO)</p>
            <div className="slider">
              <input
                type="range"
                min={MAIA_MIN_ELO}
                max={MAIA_MAX_ELO}
                step={MAIA_STEP}
                value={elo}
                onChange={(e) => onEloChange(Number(e.target.value))}
                disabled={(gameStarted && !allowEloChangeMidGame) || is1v1Mode}
                title={
                  gameStarted && !allowEloChangeMidGame
                    ? 'Enable mid-game difficulty change in settings'
                    : 'Adjust difficulty'
                }
              />
              <div className="slider-values">
                <span>{MAIA_MIN_ELO}</span>
                <input
                  type="number"
                  className="elo-input"
                  value={elo}
                  min={MAIA_MIN_ELO}
                  max={MAIA_MAX_ELO}
                  step={MAIA_STEP}
                  onChange={(e) => {
                    if (e.target.value === '') return
                    const val = parseInt(e.target.value, 10)
                    if (Number.isNaN(val)) return
                    onEloChange(val)
                  }}
                  onBlur={() => onEloChange(elo)}
                  disabled={(gameStarted && !allowEloChangeMidGame) || is1v1Mode}
                  title={
                    gameStarted && !allowEloChangeMidGame
                      ? 'Enable mid-game difficulty change in settings'
                      : 'Type to adjust ELO'
                  }
                />
                <span>{MAIA_MAX_ELO}</span>
              </div>
            </div>
          </div>
        )}

        {isBotMode && (
          <div className="menu-group">
            <p className="label">Your Color</p>
            <div className="toggle">
              <button
                className={colorChoice === 'white' ? 'active' : ''}
                onClick={() => onColorChange('white')}
                disabled={gameStarted || isDebugMode}
              >
                White
              </button>
              <button
                className={colorChoice === 'black' ? 'active' : ''}
                onClick={() => onColorChange('black')}
                disabled={gameStarted || isDebugMode}
              >
                Black
              </button>
              <button
                className={colorChoice === 'random' ? 'active' : ''}
                onClick={() => onColorChange('random')}
                disabled={gameStarted || isDebugMode}
              >
                Random
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 'auto' }}>
        <div className="status-block">
          {!isOnlineMode && statusHeadline && (
            <div className={`status-headline${statusHeadlineTone ? ` ${statusHeadlineTone}` : ''}`}>
              {statusHeadline}
            </div>
          )}
          <div className="status-row">
            <span className={`status-dot ${statusDotTone ?? (statusOk ? 'ok' : 'warn')}`} />
            <span className="status-text">
              {statusDetail ?? (is1v1Mode ? 'Mode 1v1 Local' : statusText)}
            </span>
            <button className="settings-button" onClick={onOpenSettings} title="Settings">
              <SettingsIcon size={20} />
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}
