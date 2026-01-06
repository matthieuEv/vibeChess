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
}

type SettingSection = 'board-customization' | 'takebacks'

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
              className={`settings-nav-item ${activeSection === 'takebacks' ? 'active' : ''}`}
              onClick={() => setActiveSection('takebacks')}
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
                <path d="M3 7v6h6" />
                <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
              </svg>
              Stockfish Takebacks
            </button>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="settings-main">
          <header className="settings-content-header">
            <div>
              <h1>
                {activeSection === 'board-customization' ? 'Board Customization' : 'Takebacks'}
              </h1>
              <p className="settings-description">
                {activeSection === 'board-customization'
                  ? 'Customize the board appearance.'
                  : 'Configure takeback options for games vs Stockfish.'}
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

            {activeSection === 'takebacks' && (
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
