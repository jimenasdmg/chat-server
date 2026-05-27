import React, { useState, useMemo, useRef, useEffect } from 'react'
import MessageBubble from './MessageBubble'

export default function ChatWindow({ usuarioActual, usuarioSeleccionado, setUsuarioSeleccionado, users = [], groups = [], mensajes, onSend, onMarkAsRead, loadMessagesFor, clearUnread, leaveGroup, deleteContact, renameGroup, renameContact, contacts = [] }) {
  const [texto, setTexto] = useState('')
  const mensajesArea = useRef(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    const onDocClick = (e) => {
      const header = document.querySelector('.chat-header')
      if (!header) return
      if (!header.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  const mensajesFiltrados = useMemo(() => {
    if (!mensajes || !Array.isArray(mensajes)) return []
    const usuarioNorm = (usuarioActual || '').toString().trim().toLowerCase()
    const seleccionadoNorm = (usuarioSeleccionado || '').toString().trim().toLowerCase()

    if ((usuarioSeleccionado || '').toString().trim().toLowerCase() === 'todos') {
      // Mostrar solo mensajes de grupo/broadcast en la vista 'Todos'
      return mensajes.filter(m => {
        if (m.broadcast === true) return true
        if (Array.isArray(m.receptor)) return m.receptor.map(r => (r||'').toString().trim().toLowerCase()).includes('todos')
        return (m.receptor || '').toString().trim().toLowerCase() === 'todos'
      })
    }

    // Si la conversación seleccionada es un grupo
    if (Array.isArray(groups) && groups.includes(usuarioSeleccionado)) {
      return mensajes.filter(m => (
        !m.broadcast && (
          (m.receptor === usuarioSeleccionado) ||
          (Array.isArray(m.receptor) && m.receptor.includes(usuarioSeleccionado)) ||
          (m.tipo === 'grupo' && m.grupo === usuarioSeleccionado)
        )
      ))
    }

    // Vista individual: mostrar solo mensajes directos entre los dos usuarios
    // y excluir mensajes marcados como broadcast (para que los broadcasts queden solo en 'Todos')
    return mensajes.filter(m => {
      if (m.broadcast) return false

      const mEmNorm = m.emisorNorm || ((m.emisor || '').toString().trim().toLowerCase())
      const receptorIsArray = Array.isArray(m.receptorNorm) || Array.isArray(m.receptor)
      const receptorNorms = Array.isArray(m.receptorNorm)
        ? m.receptorNorm
        : (Array.isArray(m.receptor) ? m.receptor.map(r => (r||'').toString().trim().toLowerCase()) : [(m.receptor || '').toString().trim().toLowerCase()])

      const receptorIncludes = (targetNorm) => receptorNorms.includes(targetNorm)

      const aEmiteAB = (aNorm, bNorm) => (mEmNorm === aNorm && receptorIncludes(bNorm))

      return aEmiteAB(usuarioNorm, seleccionadoNorm) || aEmiteAB(seleccionadoNorm, usuarioNorm)
    })
  }, [mensajes, usuarioSeleccionado, usuarioActual])

  useEffect(() => {
    // auto-scroll to bottom
    const el = mensajesArea.current
    if (el) el.scrollTop = el.scrollHeight
  }, [mensajesFiltrados])

  // cuando se abre o cambia la conversación, marcar mensajes entrantes como leídos
  useEffect(() => {
    // Al cambiar la conversación, cargar historial desde IndexedDB si está disponible
    if (typeof loadMessagesFor === 'function') {
      try { loadMessagesFor(usuarioSeleccionado, usuarioActual) } catch (e) {}
    }

    if (!onMarkAsRead || !usuarioActual) return
    const usuarioNorm = (usuarioActual || '').toString().trim().toLowerCase()
    const toMark = mensajesFiltrados.filter(m => !m.leido && (m.emisorNorm || (m.emisor || '').toString().trim().toLowerCase()) !== usuarioNorm && m.id)
    toMark.forEach(m => {
      if (m.id) onMarkAsRead(m.id, m.emisor, usuarioActual)
    })
    // clear unread counter for private chats
    try {
      if (typeof clearUnread === 'function' && usuarioSeleccionado && !(Array.isArray(groups) && groups.includes(usuarioSeleccionado)) && usuarioSeleccionado !== 'Todos') {
        clearUnread(usuarioSeleccionado)
      }
    } catch (e) {}
  }, [usuarioSeleccionado])

  function handleSend() {
    const txt = String(texto || '').trim()
    if (!txt || !usuarioActual) return
    onSend(usuarioSeleccionado, txt, usuarioActual)
    setTexto('')
  }

  return (
    <section className="chat phone-chat">
      <div className="chat-header">
        <button className="back" onClick={() => setUsuarioSeleccionado('Todos')}>←</button>
        <div style={{display:'flex', alignItems:'center', gap:12}}>
          <div className="avatar small">{(usuarioSeleccionado||'').charAt(0).toUpperCase()}</div>
          <div style={{display:'flex',flexDirection:'column'}}>
            <div className="header-title">{usuarioSeleccionado || 'Todos'}</div>
            {(usuarioSeleccionado && usuarioSeleccionado !== 'Todos') && (() => {
              const c = (contacts || []).find(x => (x.username || '').toString().trim().toLowerCase() === (usuarioSeleccionado||'').toString().trim().toLowerCase())
              const online = c ? !!c.online : (Array.isArray(users) ? users.some(u => (u && u.username || '').toString().trim().toLowerCase() === (usuarioSeleccionado||'').toString().trim().toLowerCase()) : false)
              const lastSeen = c ? c.last_seen : null
              return (<div style={{fontSize:13, color: online ? '#22c55e' : '#888'}}>{online ? 'En línea' : `Últ. vez ${lastSeen ? new Date(lastSeen).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}`}</div>)
            })()}
          </div>
        </div>
        {(usuarioSeleccionado && usuarioSeleccionado !== 'Todos') && (
          <div className="menu-wrapper" style={{position:'relative', marginLeft:8}}>
            <button className="btn" onClick={(e) => { e.stopPropagation(); setMenuOpen(s => !s) }} aria-label="Opciones">⋮</button>
            {menuOpen && (
              <div className="menu" style={{position:'absolute', right:0, top:'100%', background:'#fff', border:'1px solid #ddd', borderRadius:4, boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}>
                {Array.isArray(groups) && groups.includes(usuarioSeleccionado) ? (
                  <>
                    <div className="menu-item" style={{padding:8, cursor:'pointer'}} onClick={() => { setConfirmAction('renameGroup'); setRenameValue(usuarioSeleccionado || ''); setConfirmOpen(true); setMenuOpen(false) }}>✏️ Renombrar grupo</div>
                    <div className="menu-item" style={{padding:8, cursor:'pointer'}} onClick={() => { setConfirmAction('leaveGroup'); setConfirmOpen(true); setMenuOpen(false) }}>🗑 Salir del grupo</div>
                  </>
                ) : (
                  <>
                    <div className="menu-item" style={{padding:8, cursor:'pointer'}} onClick={() => { setConfirmAction('renameContact'); setRenameValue(usuarioSeleccionado || ''); setConfirmOpen(true); setMenuOpen(false) }}>✏️ Renombrar contacto</div>
                    <div className="menu-item" style={{padding:8, cursor:'pointer'}} onClick={() => { setConfirmAction('deleteContact'); setConfirmOpen(true); setMenuOpen(false) }}>🗑 Eliminar contacto</div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {confirmOpen && (
          <div className="modal-backdrop" style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <div className="modal" style={{background:'#fff',padding:20,borderRadius:8,maxWidth:480,width:'92%'}}>
              {confirmAction === 'renameGroup' || confirmAction === 'renameContact' ? (
                <>
                  <div style={{marginBottom:8,fontWeight:700}}>{confirmAction === 'renameGroup' ? 'Nuevo nombre del grupo' : 'Nuevo nombre del contacto'}</div>
                  <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} style={{width:'100%',padding:8,marginBottom:12,borderRadius:6,border:'1px solid #ddd'}} />
                  <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
                    <button className="btn" onClick={() => { setConfirmOpen(false); setConfirmAction(null); setRenameValue('') }}>Cancelar</button>
                    <button className="btn" onClick={async () => {
                      try {
                        if (confirmAction === 'renameGroup') {
                          if (typeof renameGroup === 'function') await renameGroup(usuarioSeleccionado, renameValue)
                          setUsuarioSeleccionado(renameValue)
                        } else if (confirmAction === 'renameContact') {
                          if (typeof renameContact === 'function') await renameContact(usuarioSeleccionado, renameValue)
                          setUsuarioSeleccionado(renameValue)
                        }
                      } catch (e) { console.error(e) }
                      setConfirmOpen(false); setConfirmAction(null); setRenameValue('')
                    }}>Guardar</button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{marginBottom:12,fontWeight:700}}>{confirmAction === 'leaveGroup' ? '¿Seguro quieres salir de este grupo?' : '¿Seguro quieres eliminar este contacto?'}</div>
                  <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
                    <button className="btn" onClick={() => { setConfirmOpen(false); setConfirmAction(null) }}>No</button>
                    <button className="btn" onClick={async () => {
                      try {
                        if (confirmAction === 'leaveGroup') {
                          if (typeof leaveGroup === 'function') await leaveGroup(usuarioSeleccionado)
                        } else if (confirmAction === 'deleteContact') {
                          if (typeof deleteContact === 'function') await deleteContact(usuarioSeleccionado)
                        }
                        setUsuarioSeleccionado('Todos')
                      } catch (e) { console.error(e) }
                      setConfirmOpen(false); setConfirmAction(null)
                    }}>Sí</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {(!usuarioSeleccionado || usuarioSeleccionado === 'Todos') ? (
        <div style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#667', padding:20}}>
          Selecciona un contacto para ver la conversación
        </div>
      ) : (
        <div className="messages" ref={mensajesArea}>
          {mensajesFiltrados.map((m, i) => (
            <MessageBubble key={m.id || m.localId || i} m={m} usuarioActual={usuarioActual} />
          ))}
        </div>
      )}

      {mensajesFiltrados.some(m => {
        const mEmNorm = m.emisorNorm || (m.emisor || '').toString().trim().toLowerCase()
        const usuarioNorm = (usuarioActual || '').toString().trim().toLowerCase()
        return !m.leido && mEmNorm !== usuarioNorm
      }) && (
        <div className="new-bubble" onClick={() => { const el = mensajesArea.current; if(el) el.scrollTop = el.scrollHeight }}>Nuevos mensajes</div>
      )}

      {usuarioSeleccionado && usuarioSeleccionado !== 'Todos' && (
        <div className="chat-send">
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={usuarioSeleccionado ? `Mensaje a ${usuarioSeleccionado}` : 'Selecciona un contacto'} />
          <button onClick={handleSend} className="btn send" aria-label="Enviar">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
          </button>
        </div>
      )}
    </section>
  )
}
