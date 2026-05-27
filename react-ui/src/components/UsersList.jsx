import React, { useEffect, useState } from 'react'

export default function UsersList({ users: usersProp = [], usuarioSeleccionado, onSelect, usuarioActual, mensajes = [], onCreateGroup, groups = [], unread = {}, onOpenCreateGroup }) {
  const norm = (s) => (s || '').toString().trim().toLowerCase()
  const [contactsMap, setContactsMap] = useState({})
  const [activeTab, setActiveTab] = useState('todos') // 'todos' | 'personas' | 'grupos'

  // Create group now handled by parent modal; onOpenCreateGroup prop triggers modal
  // helper: obtener último mensaje entre usuarioActual y target
  const lastFor = (target) => {
    if (!mensajes || mensajes.length === 0) return null
    const targetNorm = norm(target)
    // Todos -> preview de broadcasts
    if (targetNorm === 'todos') {
      const relevantes = mensajes.filter(m => m.broadcast === true || (Array.isArray(m.receptor) && (m.receptorNorm ? m.receptorNorm.includes('todos') : m.receptor.map(r => norm(r)).includes('todos'))) || ((m.receptor || '').toString().trim().toLowerCase() === 'todos'))
      return relevantes.length ? relevantes[relevantes.length - 1] : null
    }
    // Si target es grupo -> solo mensajes tipo 'grupo' para ese grupo
    if (Array.isArray(groups) && groups.includes(target)) {
      const relevantes = mensajes.filter(m => m.tipo === 'grupo' && m.grupo === target)
      return relevantes.length ? relevantes[relevantes.length - 1] : null
    }
    // Persona -> solo mensajes privados entre usuarioActual y target
    const relevantes = mensajes.filter(m => m.tipo === 'privado' && (
      (m.emisor === target && m.receptor === usuarioActual) ||
      (m.emisor === usuarioActual && m.receptor === target)
    ))
    return relevantes.length ? relevantes[relevantes.length - 1] : null
  }

  const fmtTime = (ts) => {
    if (!ts) return ''
    const diff = Date.now() - ts
    if (diff < 60000) return 'Ahora'
    if (diff < 3600000) return Math.floor(diff/60000) + 'm'
    return new Date(ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
  }

  useEffect(() => {
    // Si por alguna razón está seleccionado el propio usuario, volver a 'Todos'
    if (usuarioSeleccionado === usuarioActual) {
      onSelect('Todos')
    }
  }, [usuarioSeleccionado, usuarioActual, onSelect])

  // contactsMap from IndexedDB removed: do not use IndexedDB for contacts

  useEffect(() => {
    console.log('USER', usuarioActual)
    console.log('GROUPS USER', groups)
  }, [usuarioActual, groups])

  // determine list of users to display (prefer `users` prop)
  const localUsers = (Array.isArray(usersProp) && usersProp.length) ? usersProp : []
  const grupos = Array.isArray(groups) ? groups : []

  const visibleUsers = Array.isArray(localUsers)
    ? localUsers.filter(
        u =>
          u &&
          u.username &&
          u.username !== usuarioActual
      )
    : []

  const formatLastSeen = (ts) => {
    if (!ts) return 'Desconectado'
    return new Date(ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <aside className="users sidebar">
      <div style={{display:'flex', gap:8, alignItems:'center'}}>
        <button className="btn" onClick={() => { if (typeof onOpenCreateGroup === 'function') onOpenCreateGroup(); else if (typeof onCreateGroup === 'function') onCreateGroup() }}>Crear grupo</button>
      </div>
      <div className="tabs">
        <button className={`tab ${activeTab === 'todos' ? 'active' : ''}`} onClick={() => { setActiveTab('todos'); onSelect('Todos') }}>Todos</button>
        <button className={`tab ${activeTab === 'personas' ? 'active' : ''}`} onClick={() => { setActiveTab('personas'); const first = localUsers.find(u => u !== usuarioActual); if (first) onSelect(first) }}>Personas</button>
        <button className={`tab ${activeTab === 'grupos' ? 'active' : ''}`} onClick={() => { setActiveTab('grupos'); const firstG = (groups || [])[0]; if (firstG) onSelect(firstG) }}>Grupos</button>
      </div>
      <h3>{activeTab === 'todos' ? 'Todos' : activeTab === 'personas' ? 'Personas' : 'Grupos'}</h3>
      <ul>
        {activeTab === 'todos' && (Array.isArray(localUsers) ? localUsers : []).map((u, i) => {
          const name = (u && u.username) ? u.username : (u || '').toString()
          const online = u && typeof u.online !== 'undefined' ? !!u.online : false
          const lastSeen = u && (u.lastSeen || u.last_seen) ? (u.lastSeen || u.last_seen) : null
          return (
            <li key={`u-${i}`} className={usuarioSeleccionado === name ? 'selected' : ''}>
              <div className="user-item" onClick={() => onSelect(name)}>
                <div className="avatar">{String(name).charAt(0).toUpperCase()}</div>
                <div className="meta"><div className="name">{name}</div></div>
                <div style={{marginLeft:'auto', display:'flex', gap:8, alignItems:'center'}}>
                  <div className={`dot ${online ? 'online' : 'offline'}`} />
                  <div className="user-status">{online ? 'En línea' : `Últ. vez ${formatLastSeen(lastSeen)}`}</div>
                </div>
              </div>
            </li>
          )
        })}

        {activeTab === 'personas' && (
          visibleUsers.length > 0
          ? visibleUsers.map((u, i) => (
            <li key={u.id || i} className={usuarioSeleccionado === u.username ? 'selected' : ''}>
              <div
                className="user-item"
                onClick={() => onSelect(u.username)}
              >

                <div className="avatar">
                  {u.username?.[0]?.toUpperCase()}
                </div>

                <div>

                  <div>
                    {u.username}
                  </div>

                  <small>
                    {
                      u.online
                      ? "🟢 En línea"
                      : u.lastSeen
                      ? `⚪ Últ. vez ${new Date(u.lastSeen).toLocaleTimeString()}`
                      : "⚪ Desconectado"
                    }
                  </small>

                </div>

              </div>
            </li>
          ))
          : <li><div>No hay usuarios</div></li>
        )}

        {activeTab === 'grupos' && (Array.isArray(grupos) ? grupos : []).map((g, i) => {
          const groupName = String(g).trim()
          const last = lastFor(groupName)
          const lastEmNormG = last ? (last.emisorNorm || (last.emisor || '').toString().trim().toLowerCase()) : null
          const preview = last ? (lastEmNormG === (usuarioActual||'').toString().trim().toLowerCase() ? `Tú: ${last.mensaje}` : `${last.emisor}: ${last.mensaje}`) : ''
          const usuarioNormG = norm(usuarioActual)
          const unreadCount = mensajes.filter(m => {
            if (m.leido) return false
            if (m.tipo !== 'grupo') return false
            const mEmNorm = m.emisorNorm || norm(m.emisor)
            if (mEmNorm === usuarioNormG) return false
            return m.tipo === 'grupo' && m.grupo === groupName
          }).length
          return (
            <li key={`${groupName}-${i}`} className={usuarioSeleccionado === groupName ? 'selected' : ''}>
              <div className="user-item" onClick={() => onSelect(groupName)}>
                <div className="avatar">G</div>
                <div className="meta">
                  <div className="name">{groupName}</div>
                  <div className="sub">{preview || 'Grupo'}</div>
                </div>
                <div style={{marginLeft:'auto', display:'flex', gap:8, alignItems:'center'}}>
                  {unreadCount > 0 && <div className="badge">{unreadCount}</div>}
                  <div className="dot group" />
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
