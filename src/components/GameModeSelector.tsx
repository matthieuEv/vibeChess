import { useState, useRef, useEffect } from 'react'
import { Bot, Users, ChevronDown } from 'lucide-react'
import { GAME_MODES, type GameMode } from '../chess/types'
import './GameModeSelector.css'

type GameModeSelectorProps = {
  selectedMode: GameMode
  disabled: boolean
  onModeChange: (mode: GameMode) => void
}

const ICON_MAP = {
  bot: Bot,
  users: Users,
}

export default function GameModeSelector({
  selectedMode,
  disabled,
  onModeChange,
}: GameModeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedModeInfo = GAME_MODES.find((m) => m.id === selectedMode) ?? GAME_MODES[0]
  const SelectedIcon = ICON_MAP[selectedModeInfo.icon]

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (mode: GameMode) => {
    onModeChange(mode)
    setIsOpen(false)
  }

  return (
    <div className="game-mode-selector" ref={dropdownRef}>
      <p className="label">Mode de jeu</p>
      <button
        className={`game-mode-dropdown-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <SelectedIcon size={18} className="game-mode-icon" />
        <span className="game-mode-name">{selectedModeInfo.name}</span>
        <ChevronDown size={16} className={`chevron ${isOpen ? 'rotated' : ''}`} />
      </button>
      
      {isOpen && (
        <ul className="game-mode-dropdown-menu" role="listbox">
          {GAME_MODES.map((mode) => {
            const Icon = ICON_MAP[mode.icon]
            const isSelected = mode.id === selectedMode
            return (
              <li
                key={mode.id}
                className={`game-mode-dropdown-item ${isSelected ? 'selected' : ''}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(mode.id)}
              >
                <Icon size={18} className="game-mode-icon" />
                <div className="game-mode-item-text">
                  <span className="game-mode-name">{mode.name}</span>
                  <span className="game-mode-description">{mode.description}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
