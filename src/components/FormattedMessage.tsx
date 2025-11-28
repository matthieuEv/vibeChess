

export const parseMessageContent = (content: string) => {
  const lines = content.split('\n')
  return lines.map(line => {
    const trimmed = line.trim()
    const isBullet = trimmed.startsWith('* ') || trimmed.startsWith('- ')
    const text = isBullet ? trimmed.substring(2) : line
    
    const parts = text.split(/(\*\*.*?\*\*|`[^`]+`)/g).map(part => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return { type: 'bold' as const, content: part.slice(2, -2) }
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return { type: 'code' as const, content: part.slice(1, -1) }
      }
      return { type: 'text' as const, content: part }
    })

    return {
      isBullet,
      parts
    }
  })
}

const FormattedMessage = ({ content }: { content: string }) => {
  const parsedLines = parseMessageContent(content)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {parsedLines.map((line, i) => {
        const renderedParts = line.parts.map((part, j) => {
          if (part.type === 'bold') {
            return <strong key={j} style={{ color: 'var(--accent)', fontWeight: 600 }}>{part.content}</strong>
          }
          if (part.type === 'code') {
            return (
              <code 
                key={j} 
                style={{ 
                  background: 'rgba(255,255,255,0.1)', 
                  padding: '2px 4px', 
                  borderRadius: 4, 
                  fontFamily: 'monospace', 
                  fontSize: '0.9em',
                  color: '#e9eef6'
                }}
              >
                {part.content}
              </code>
            )
          }
          return part.content
        })

        if (line.isBullet) {
           return (
             <div key={i} style={{ display: 'flex', gap: 8, paddingLeft: 8, marginTop: 2 }}>
               <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>•</span>
               <span>{renderedParts}</span>
             </div>
           )
        }
        
        if (line.parts.length === 1 && !line.parts[0].content.trim()) {
          return <div key={i} style={{ height: 6 }} />
        }

        return <div key={i}>{renderedParts}</div>
      })}
    </div>
  )
}

export default FormattedMessage
