type HistoryPair = {
  moveNumber: number
  white?: string
  black?: string
}

type InfoPanelProps = {
  turnText: string
  formattedHistory: HistoryPair[]
  currentHistoryIndex: number
  analysisMode: boolean
  analysisIndex: number
  analysisEntriesLength: number
  analysisTurnLabel: string
  analysisError: string | null
  analysisLoading: boolean
  isExploringVariant: boolean
  onGoToAnalysisIndex: (index: number) => void
  onResetAnalysisPosition: () => void
}

export default function InfoPanel({
  turnText,
  formattedHistory,
  currentHistoryIndex,
  analysisMode,
  analysisIndex,
  analysisEntriesLength,
  analysisTurnLabel,
  analysisError,
  analysisLoading,
  isExploringVariant,
  onGoToAnalysisIndex,
  onResetAnalysisPosition,
}: InfoPanelProps) {
  return (
    <aside className="info-panel">
      <div className="panel-header">
        <h3 style={{ margin: 0 }}>{turnText}</h3>
      </div>

      <div className="history-container">
        {formattedHistory.length ? (
          formattedHistory.map(({ moveNumber, white, black }) => {
            const baseIndex = (moveNumber - 1) * 2
            const isCurrentLine =
              currentHistoryIndex === baseIndex || currentHistoryIndex === baseIndex + 1
            return (
              <div
                className={`move-row ${isCurrentLine ? 'active' : ''}`}
                key={moveNumber}
                ref={isCurrentLine ? (el) => el?.scrollIntoView({ block: 'nearest' }) : null}
              >
                <span className="move-number">{moveNumber}.</span>
                <span
                  className={`move-white ${currentHistoryIndex === baseIndex ? 'active' : ''}`}
                  onClick={() => analysisMode && onGoToAnalysisIndex(baseIndex + 1)}
                >
                  {white ?? '-'}
                </span>
                <span
                  className={`move-black ${currentHistoryIndex === baseIndex + 1 ? 'active' : ''}`}
                  onClick={() => analysisMode && black && onGoToAnalysisIndex(baseIndex + 2)}
                >
                  {black ?? ''}
                </span>
              </div>
            )
          })
        ) : (
          <div className="muted" style={{ padding: 20, textAlign: 'center' }}>
            Moves will appear here
          </div>
        )}
      </div>

      {analysisMode && (
        <div className="analysis-panel">
          {analysisError && (
            <div style={{ color: 'red', fontSize: 12, marginBottom: 8 }}>{analysisError}</div>
          )}
          {analysisLoading && (
            <div style={{ fontSize: 12, marginBottom: 8 }}>Loading analysis...</div>
          )}
          <div className="analysis-controls">
            <button
              className="ghost small"
              onClick={() => onGoToAnalysisIndex(analysisIndex - 1)}
              disabled={analysisIndex === 0}
            >
              &larr;
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              {analysisIndex + 1} / {Math.max(analysisEntriesLength, 1)}
              {analysisTurnLabel ? ` - ${analysisTurnLabel}` : ''}
            </span>
            <button
              className="ghost small"
              onClick={() => onGoToAnalysisIndex(analysisIndex + 1)}
              disabled={analysisIndex >= analysisEntriesLength - 1}
            >
              &rarr;
            </button>
          </div>

          {isExploringVariant && (
            <div style={{ marginBottom: 8 }}>
              <button
                className="ghost small"
                style={{ width: '100%', color: '#ffad71', borderColor: '#ffad71' }}
                onClick={onResetAnalysisPosition}
              >
                Return to Main Line
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
