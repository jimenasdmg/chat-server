import React, { useState, useEffect } from 'react'

export default function ContactList({ contacts = [], contactsByUser = {}, groupsByUser = {}, users = [], usuarios = [], groups = [], usuarioSeleccionado, onSelect, usuarioActual, username, mensajes = [], onCreateGroup, unread = {}, addContact, onOpenAddContact, onOpenCreateGroup, dbReady = true }) {
  const [filter, setFilter] = useState('')
  // Modal opening is controlled by parent via onOpenAddContact
  const [newContact, setNewContact] = useState('')

  const norm = (s) => (s || '').toString().trim().toLowerCase()

  const lastFor = (target) => {
    if (!mensajes || mensajes.length === 0) return null
    const relevantes = mensajes.filter(m => m.tipo === 'privado' && ((m.emisor === target) || (m.receptor === target)))
    return relevantes.length ? relevantes[relevantes.length - 1] : null
  }

  const fmtTime = (ts) => {
    if (!ts) return ''
    const diff = Date.now() - ts
    if (diff < 60000) return 'Ahora'
    if (diff < 3600000) return Math.floor(diff/60000) + 'm'
    return new Date(ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
  }

  // kept for compatibility if parent wants to call directly
  const handleAdd = async (val) => {
    const value = (val || newContact || '').toString().trim()
    if (!value) return
    try {
      if (typeof addContact === 'function') await addContact(value)
    } catch (e) { console.error(e) }
    setNewContact('')
  }

  // determine current user (display name)
  const currentUser = (usuarioActual || username || '')

  // Visible contacts: always derive presence from `contacts` prop (source of truth)
  const visibleContacts = React.useMemo(() => {
    const raw = Array.isArray(contacts) ? contacts : (Array.isArray(contactsByUser && contactsByUser[currentUser]) ? contactsByUser[currentUser] : [])
    // deduplicate by normalized username (preserve last occurrence)
    const mapa = new Map()
    for (const c of raw) {
      try {
        const key = (c && (c.username || c.nombre || c.id || '')).toString().trim().toLowerCase()
        if (!key) continue
        mapa.set(key, c)
      } catch (e) { /* ignore */ }
    }
    const source = Array.from(mapa.values())
    return source.filter(c => {
      const name = (c.nombre || c.username || c.user || c.contacto || c).toString().trim()
      return name && name.toLowerCase() !== (currentUser || '').toString().toLowerCase()
    }).map(c => {
      const name = (c.nombre || c.username || c.user || c.contacto || c).toString().trim()
      const online = c.online === true
      return Object.assign({}, c, { nombre: name, online })
    })
  }, [contacts, contactsByUser, currentUser])

  useEffect(() => {
    console.log('USER', currentUser)
    console.log('CONTACTS USER', contacts)
    console.log('GROUPS USER', groups)
    console.log('VISIBLE', visibleContacts)
    if (!usuarioSeleccionado) {
      if (visibleContacts && visibleContacts.length) {
        const first = visibleContacts[0]
        const firstName = first ? (first.nombre || first.username || first.id || String(first)) : null
        if (firstName) onSelect && onSelect(firstName)
      } else if (groups && groups.length) onSelect && onSelect(groups[0])
    }
  }, [visibleContacts, groups, usuarioSeleccionado, currentUser])

  return (
    <aside className="users sidebar">
      <div style={{display:'flex', gap:8, alignItems:'center'}}>
        <button className="btn" onClick={() => { if (typeof onOpenCreateGroup === 'function') onOpenCreateGroup() }}>{'Crear grupo'}</button>
      </div>

      <div style={{marginTop:8, display:'flex', flexDirection:'column', gap:8}}>
      </div>
          <input placeholder="Buscar usuario..." value={filter} onChange={(e) => setFilter(e.target.value)} style={{padding:8,borderRadius:8,border:'1px solid #e6edf6'}} />
          <button className="btn add-contact-btn" style={{height:42,borderRadius:12, display:'none'}}>+ Agregar contacto</button>
        </div>

        <h3 style={{marginTop:12, marginBottom:6}}>USUARIOS</h3>

      <ul>
        {(!dbReady && (!contacts || contacts.length === 0)) ? (
          <li style={{padding:12,color:'#666'}}>Cargando...</li>
        ) : (visibleContacts && visibleContacts.length ? visibleContacts.map((c,i) => {
          const name = c.username || c.nombre || c.id || ''
          const isOnline = c.online === true
          const last = lastFor(name)
          const rawPreview = last ? (last.emisor === usuarioActual ? `Tú: ${last.mensaje}` : `${last.emisor}: ${last.mensaje}`) : ''
          const preview = rawPreview.length > 20 ? rawPreview.slice(0,20) + '…' : rawPreview
          const lastSeen = c.last_seen || (last ? last.ts : null)
          return (
            <li key={`${name}-${String(isOnline)}`} className={usuarioSeleccionado === name ? 'selected' : ''}>
              <div className="user-item compact" onClick={() => onSelect && onSelect(name)} style={{display:'flex', alignItems:'center', gap:8}}>
                <span style={{fontSize:18}}>{isOnline ? '🟢' : '⚪'}</span>
                <div style={{flex:1}}>
                  <div className="name small-name">{name}</div>
                  <small className="small-sub">
                    {isOnline === true ? '🟢 En línea' : (lastSeen ? `Últ. vez ${new Date(lastSeen).toLocaleTimeString('es-MX',{hour:'2-digit', minute:'2-digit'})}` : 'Offline')}
                  </small>
                </div>
                { (unread && unread[name]) > 0 && <div className="unread-badge">{unread[name]}</div> }
              </div>
            </li>
          )
        }) : <li style={{padding:12,color:'#666'}}>No hay personas conectadas</li>)}

      </ul>

      <h3 style={{marginTop:12, marginBottom:6}}>GRUPOS</h3>
      <ul>
        {(Array.isArray(groups) && groups.length ? groups.map((g,i) => (
          <li key={`g-${g}-${i}`} className={usuarioSeleccionado === g ? 'selected' : ''}>
            <div className="user-item compact" onClick={() => onSelect && onSelect(g)}>
              <div className="avatar small">G</div>
              <div className="meta">
                <div className="name small-name">{g}</div>
                <div className="sub small-sub">Grupo</div>
              </div>
              <div style={{marginLeft:'auto'}} />
            </div>
          </li>
        )) : <li style={{padding:12,color:'#666'}}>No hay grupos.</li>)}
      </ul>

      {/* Modal controlled by parent via onOpenAddContact / App */}

    </aside>
  )
}
