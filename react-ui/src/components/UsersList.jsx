import React, { useEffect, useState } from 'react'

export default function UsersList({ usuarios, usuariosInfo = {}, usuarioSeleccionado, onSelect, usuarioActual, mensajes = [], onCreateGroup, groups = [], unread = {}, onOpenCreateGroup }) {
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

  // aliases used by rendering blocks
  const users = (Array.isArray(usuarios) && usuarios.length) ? usuarios : Object.keys(usuariosInfo || {})
  const grupos = Array.isArray(groups) ? groups : []

  return (
    <aside className="users sidebar">
      <div style={{display:'flex', gap:8, alignItems:'center'}}>
        <button className="btn" onClick={() => { if (typeof onOpenCreateGroup === 'function') onOpenCreateGroup(); else if (typeof onCreateGroup === 'function') onCreateGroup() }}>Crear grupo</button>
      </div>
      <div className="tabs">
        <button className={`tab ${activeTab === 'todos' ? 'active' : ''}`} onClick={() => { setActiveTab('todos'); onSelect('Todos') }}>Todos</button>
        <button className={`tab ${activeTab === 'personas' ? 'active' : ''}`} onClick={() => { setActiveTab('personas'); const first = usuarios.find(u => u !== usuarioActual); if (first) onSelect(first) }}>Personas</button>
        <button className={`tab ${activeTab === 'grupos' ? 'active' : ''}`} onClick={() => { setActiveTab('grupos'); const firstG = (groups || [])[0]; if (firstG) onSelect(firstG) }}>Grupos</button>
      </div>
      <h3>{activeTab === 'todos' ? 'Todos' : activeTab === 'personas' ? 'Personas' : 'Grupos'}</h3>
      <ul>
        {activeTab === 'todos' && (() => {
          const l = lastFor('Todos')
          const usuarioNorm = norm(usuarioActual)
          const unreadTodos = mensajes.filter(m => {
            if (m.leido) return false
            const mEmNorm = m.emisorNorm || norm(m.emisor)
            if (mEmNorm === usuarioNorm) return false
            if (m.broadcast === true) return true
            const receptorNorms = Array.isArray(m.receptorNorm) ? m.receptorNorm : (Array.isArray(m.receptor) ? m.receptor.map(r => norm(r)) : [norm(m.receptor)])
            return receptorNorms.includes('todos')
          }).length
          return (
            <li
              className={usuarioSeleccionado === 'Todos' ? 'selected' : ''}
              onClick={() => onSelect('Todos')}
            >
              <div className="user-item">
                <div className="avatar">T</div>
                <div className="meta">
                  <div className="name">Todos</div>
                  <div className="sub">Enviar a todos</div>
                </div>
                <div style={{marginLeft:'auto', display:'flex', gap:8, alignItems:'center'}}>
                  {unreadTodos > 0 && <div className="badge">{unreadTodos}</div>}
                  <div className="dot online" />
                  <div className="time">{l ? fmtTime(l.ts) : ''}</div>
                </div>
              </div>
            </li>
          )
        })()}

        {activeTab === 'usuarios' &&
        (Array.isArray(users) ? users : []).map((u, i) => {

          const name = String(u).trim()

          return (
            <div
              key={i}
              onClick={() => onSelect(name)}
            >
              {name}
            </div>
          )

        })}

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
