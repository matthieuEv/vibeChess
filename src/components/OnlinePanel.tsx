type OnlinePanelProps = {
  connectionText: string
  error: string | null
  gameId: string | null
  joinCode: string
  canCreate: boolean
  canJoin: boolean
  canResync: boolean
  canLeave: boolean
  onJoinCodeChange: (value: string) => void
  onCreateGame: () => void
  onJoinGame: () => void
  onCopyGameId: () => void
  onResync: () => void
  onLeave: () => void
}

export default function OnlinePanel({
  connectionText,
  error,
  gameId,
  joinCode,
  canCreate,
  canJoin,
  canResync,
  canLeave,
  onJoinCodeChange,
  onCreateGame,
  onJoinGame,
  onCopyGameId,
  onResync,
  onLeave,
}: OnlinePanelProps) {
  const hasSession = Boolean(gameId)
  const headerText = hasSession ? connectionText : 'Create or join a game'

  return (
    <div className="online-panel">
      <div className="online-header">
        <p className="label">Online</p>
        {headerText && <p className="muted online-presence">{headerText}</p>}
      </div>

      {error && <div className="online-error">{error}</div>}

      {hasSession ? (
        <div className="online-section">
          {gameId && (
            <div className="online-code">
              <div className="online-code-row">
                <span className="online-code-value">{gameId}</span>
                <button className="ghost small online-copy" onClick={onCopyGameId}>
                  Copy
                </button>
              </div>
            </div>
          )}
          {canLeave && (
            <button className="ghost" onClick={onLeave}>
              Leave game
            </button>
          )}
          {canResync && (
            <button className="ghost" onClick={onResync}>
              Resync from last state
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="online-section">
            <p className="label">Create</p>
            <button className="primary" onClick={onCreateGame} disabled={!canCreate}>
              Create game
            </button>
          </div>

          <div className="online-section">
            <p className="label">Join</p>
            <div className="online-join">
              <input
                value={joinCode}
                onChange={(event) => onJoinCodeChange(event.target.value)}
                placeholder="AB12-CD34"
                className="online-input"
                inputMode="text"
                autoComplete="off"
              />
              <button className="primary" onClick={onJoinGame} disabled={!canJoin}>
                Join
              </button>
            </div>
          </div>

          {canResync && (
            <div className="online-section">
              <p className="label">Resync</p>
              <button className="ghost" onClick={onResync}>
                Resync from last state
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
