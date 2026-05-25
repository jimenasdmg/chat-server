import React from 'react'

function fmtTime(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60000) return 'Ahora'
  if (diff < 3600000) return Math.floor(diff/60000) + 'm'
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function MessageBubble({ m, usuarioActual }) {
  const emisorNorm = (m.emisor || '').toString().trim().toLowerCase()
  const usuarioNorm = (usuarioActual || '').toString().trim().toLowerCase()
  const esPropio = emisorNorm === usuarioNorm

  // Determinar un único estado visual. Prioridad: leido -> delivered -> sent -> sending -> default
  let indicator = '·'
  let indicatorClass = ''

  if (m.leido) {
    indicator = '✓✓'
    indicatorClass = 'read'
  } else {
    const st = (m.status || '').toString().toLowerCase()
    if (st === 'sending') {
      indicator = '…'
      indicatorClass = 'sending'
    } else if (st === 'sent') {
      indicator = '✓'
      indicatorClass = 'sent'
    } else if (st === 'delivered') {
      indicator = '✓✓'
      indicatorClass = 'delivered'
    } else {
      indicator = '·'
      indicatorClass = ''
    }
  }

  return (
    <div className={`message-bubble ${esPropio ? 'mensaje-propio' : 'mensaje-otro'}`}>
      <div className="bubble-text">{m.mensaje}</div>
      <div className="bubble-meta">{m.emisor} · <span className="time">{fmtTime(m.ts)}</span>
        {esPropio && (
          <span className={`read-indicator ${indicatorClass}`} title={m.id ? `id: ${m.id}` : ''}>
            {indicator}
          </span>
        )}
      </div>
    </div>
  )
}
