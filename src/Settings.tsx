import { useState } from 'react'
import './Settings.css'

type BoardThemeKey = 'green' | 'brown' | 'blue' | 'gray'

type SettingsProps = {
  isOpen: boolean
  onClose: () => void
  boardTheme: BoardThemeKey
  onBoardThemeChange: (theme: BoardThemeKey) => void
  takebackLimit: number
  onTakebackLimitChange: (limit: number) => void
  takebacksUsed: number
  allowEloChangeMidGame: boolean
  onAllowEloChangeMidGameChange: (allow: boolean) => void
}

type SettingSection = 'board-customization' | 'chess-engine'

const BOARD_THEMES: Record<BoardThemeKey, { label: string; light: string; dark: string }> = {
  green: {
    label: 'Green (Default)',
    light: '#ebecd0',
    dark: '#779556',
  },
  brown: {
    label: 'Brown',
    light: '#f0d9b5',
    dark: '#b58863',
  },
  blue: {
    label: 'Blue',
    light: '#dee3e6',
    dark: '#8ca2ad',
  },
  gray: {
    label: 'Gray',
    light: '#e8e8e8',
    dark: '#999999',
  },
}

export default function Settings({
  isOpen,
  onClose,
  boardTheme,
  onBoardThemeChange,
  takebackLimit,
  onTakebackLimitChange,
  takebacksUsed,
  allowEloChangeMidGame,
  onAllowEloChangeMidGameChange,
}: SettingsProps) {
  const [activeSection, setActiveSection] = useState<SettingSection>('board-customization')

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-container" onClick={(e) => e.stopPropagation()}>
        {/* Sidebar Navigation */}
        <aside className="settings-sidebar">
          <div className="settings-sidebar-header">
            <h2>vibeChess</h2>
            <p className="settings-sidebar-subtitle">Settings</p>
          </div>
          <nav className="settings-nav">
            <button
              className={`settings-nav-item ${activeSection === 'board-customization' ? 'active' : ''}`}
              onClick={() => setActiveSection('board-customization')}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              Board Customization
            </button>
            <button
              className={`settings-nav-item ${activeSection === 'chess-engine' ? 'active' : ''}`}
              onClick={() => setActiveSection('chess-engine')}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <rect x="9" y="9" width="6" height="6" />
                <line x1="9" y1="1" x2="9" y2="4" />
                <line x1="15" y1="1" x2="15" y2="4" />
                <line x1="9" y1="20" x2="9" y2="23" />
                <line x1="15" y1="20" x2="15" y2="23" />
                <line x1="20" y1="9" x2="23" y2="9" />
                <line x1="20" y1="14" x2="23" y2="14" />
                <line x1="1" y1="9" x2="4" y2="9" />
                <line x1="1" y1="14" x2="4" y2="14" />
              </svg>
              Chess Engine
            </button>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="settings-main">
          <header className="settings-content-header">
            <div>
              <h1>
                {activeSection === 'board-customization' ? 'Board Customization' : 'Chess Engine'}
              </h1>
              <p className="settings-description">
                {activeSection === 'board-customization'
                  ? 'Customize the board appearance.'
                  : 'Configure options for games vs Maia chess engine.'}
              </p>
            </div>
            <button className="settings-close-button" onClick={onClose}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>

          <div className="settings-content">
            {activeSection === 'board-customization' && (
              <section className="settings-section">
                <h3 className="settings-section-title">Board Theme</h3>
                <p className="settings-section-description">
                  Select the color scheme for the board
                </p>
                <div className="settings-field">
                  <select
                    className="settings-select"
                    value={boardTheme}
                    onChange={(e) => onBoardThemeChange(e.target.value as BoardThemeKey)}
                    disabled={true}
                    style={{ cursor: 'not-allowed', opacity: 0.5 }}
                  >
                    {Object.entries(BOARD_THEMES).map(([key, theme]) => (
                      <option key={key} value={key}>
                        {theme.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="board-theme-preview">
                  <div className="preview-row">
                    <div
                      className="preview-square"
                      style={{ backgroundColor: BOARD_THEMES[boardTheme].light }}
                    />
                    <div
                      className="preview-square"
                      style={{ backgroundColor: BOARD_THEMES[boardTheme].dark }}
                    />
                    <div
                      className="preview-square"
                      style={{ backgroundColor: BOARD_THEMES[boardTheme].light }}
                    />
                    <div
                      className="preview-square"
                      style={{ backgroundColor: BOARD_THEMES[boardTheme].dark }}
                    />
                  </div>
                  <div className="preview-row">
                    <div
                      className="preview-square"
                      style={{ backgroundColor: BOARD_THEMES[boardTheme].dark }}
                    />
                    <div
                      className="preview-square"
                      style={{ backgroundColor: BOARD_THEMES[boardTheme].light }}
                    />
                    <div
                      className="preview-square"
                      style={{ backgroundColor: BOARD_THEMES[boardTheme].dark }}
                    />
                    <div
                      className="preview-square"
                      style={{ backgroundColor: BOARD_THEMES[boardTheme].light }}
                    />
                  </div>
                </div>
              </section>
            )}

            {activeSection === 'chess-engine' && (
              <>
                <section className="settings-section">
                  <h3 className="settings-section-title">Takeback Limit</h3>
                  <p className="settings-section-description">
                    Set how many takebacks you can use in a game
                  </p>
                  <div className="settings-field">
                    <input
                      type="number"
                      className="settings-input"
                      min={0}
                      step={1}
                      value={takebackLimit === Infinity ? 0 : takebackLimit}
                      onChange={(e) => {
                        const next = Number(e.target.value)
                        onTakebackLimitChange(Number.isNaN(next) ? 0 : Math.max(0, next))
                      }}
                      disabled={takebackLimit === Infinity}
                    />
                    <label className="settings-checkbox-label">
                      <input
                        type="checkbox"
                        checked={takebackLimit === Infinity}
                        onChange={(e) => {
                          onTakebackLimitChange(e.target.checked ? Infinity : 0)
                        }}
                      />
                      <span>Unlimited</span>
                    </label>
                  </div>
                  <div className="settings-info-box">
                    <p>
                      <strong>Used:</strong> {takebacksUsed} /{' '}
                      {takebackLimit === Infinity ? 'Unlimited' : takebackLimit}
                    </p>
                  </div>
                </section>

                <section className="settings-section">
                  <h3 className="settings-section-title">Change Difficulty Mid-Game</h3>
                  <p className="settings-section-description">
                    Allow changing the AI difficulty level during an active game
                  </p>
                  <div className="settings-field">
                    <label className="settings-checkbox-label">
                      <input
                        type="checkbox"
                        checked={allowEloChangeMidGame}
                        onChange={(e) => onAllowEloChangeMidGameChange(e.target.checked)}
                      />
                      <span>Allow ELO change mid-game</span>
                    </label>
                  </div>
                </section>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export { BOARD_THEMES }
export type { BoardThemeKey }
