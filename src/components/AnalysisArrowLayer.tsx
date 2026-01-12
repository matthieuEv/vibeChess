import type { Square } from 'chess.js'
import type { PlayerColor } from '../chess/types'

export type ArrowToDraw = {
  from: Square
  to: Square
  color: string
  width: number
  opacity?: number
}

type AnalysisArrowLayerProps = {
  arrows: ArrowToDraw[]
  boardSize: number
  playerColor: PlayerColor
}

export default function AnalysisArrowLayer({
  arrows,
  boardSize,
  playerColor,
}: AnalysisArrowLayerProps) {
  if (!arrows.length) return null
  const squareSize = boardSize / 8
  const getCenter = (square: Square) => {
    const file = square.charCodeAt(0) - 97
    const rank = Number(square[1]) - 1
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null

    const xIndex = playerColor === 'white' ? file : 7 - file
    const yIndex = playerColor === 'white' ? 7 - rank : rank

    return {
      x: xIndex * squareSize + squareSize / 2,
      y: yIndex * squareSize + squareSize / 2,
    }
  }

  return (
    <svg
      className="analysis-arrow-canvas"
      width={boardSize}
      height={boardSize}
      viewBox={`0 0 ${boardSize} ${boardSize}`}
      style={{ pointerEvents: 'none' }}
    >
      {arrows.map((arrow, idx) => {
        const from = getCenter(arrow.from)
        const to = getCenter(arrow.to)
        if (!from || !to) return null

        const dx = to.x - from.x
        const dy = to.y - from.y
        const len = Math.sqrt(dx * dx + dy * dy)
        if (len === 0) return null

        const width = arrow.width
        const headLength = width * 3
        const headWidth = width * 2.4

        // Shorten slightly for aesthetics
        const margin = squareSize * 0.22
        const actualLen = Math.max(0, len - margin)

        if (actualLen < headLength) return null

        const uX = dx / len
        const uY = dy / len

        const tipX = from.x + uX * actualLen
        const tipY = from.y + uY * actualLen

        const neckX = tipX - uX * headLength
        const neckY = tipY - uY * headLength

        const pX = -uY
        const pY = uX

        const slX = from.x - pX * (width / 2)
        const slY = from.y - pY * (width / 2)
        const nlX = neckX - pX * (width / 2)
        const nlY = neckY - pY * (width / 2)
        const hblX = neckX - pX * (headWidth / 2)
        const hblY = neckY - pY * (headWidth / 2)
        const hbrX = neckX + pX * (headWidth / 2)
        const hbrY = neckY + pY * (headWidth / 2)
        const nrX = neckX + pX * (width / 2)
        const nrY = neckY + pY * (width / 2)
        const srX = from.x + pX * (width / 2)
        const srY = from.y + pY * (width / 2)

        const d = `M ${slX} ${slY} L ${nlX} ${nlY} L ${hblX} ${hblY} L ${tipX} ${tipY} L ${hbrX} ${hbrY} L ${nrX} ${nrY} L ${srX} ${srY} Z`

        return (
          <path
            key={`${arrow.from}-${arrow.to}-${idx}`}
            d={d}
            fill={arrow.color}
            opacity={arrow.opacity ?? 0.8}
          />
        )
      })}
    </svg>
  )
}
