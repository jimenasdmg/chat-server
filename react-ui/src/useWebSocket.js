import { useState, useRef, useCallback } from 'react'

export default function useWebSocket() {
  const wsRef = useRef(null)
  const [connected, setConnected] = useState(false)
  const [users, setUsers] = useState([])
  const [groups, setGroups] = useState([])
  // per-user maps to avoid cross-user clobbering
  const [groupsByUser, setGroupsByUser] = useState({})
  const [messages, setMessages] = useState([])
  const [unreadMap, setUnreadMap] = useState({})
  const [dbReady] = useState(true)
  const usernameRef = useRef(null)
  const seenIds = useRef(new Set())
  const pending = useRef(new Map()) // clientId -> local message id

  const setGroupsForCurrent = (current, arr) => {
    if (!current) return
    setGroupsByUser(prev => ({ ...(prev || {}), [current]: Array.isArray(arr) ? arr : [] }))
    setGroups(Array.isArray(arr) ? arr : [])
    console.log('USER', current)
    console.log('GROUPS USER', { ...(groupsByUser || {}), [current]: arr })
  }

  const parse = (text) => {
    try { return JSON.parse(text) } catch { return null }
  }

  const norm = (s) => (s || '').toString().trim().toLowerCase()

  // contacts removed: UI uses `users` provided by server

  const connect = useCallback((username, url = 'wss://chat-server-production-1abc.up.railway.app') => {
    if (!username) return
    if (!url) return
    if (wsRef.current) wsRef.current.close()

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      const usernameTrim = username.toString().trim()
      const usernameNorm = norm(usernameTrim)
      usernameRef.current = usernameNorm

      // send identification and ask for connected list (send original display name)
      ws.send(JSON.stringify({ mensaje: 'IDENTIFICACION', data: usernameTrim }))
      // do NOT request server-side contacts; UI will use USERS/CONECTADOS/STATUS

      setGroupsForCurrent(usernameNorm, [])
    }

    ws.onmessage = (evt) => {
      const p = parse(evt.data)
      // Log raw parsed websocket frame for debugging
      try { console.log('WS RECIBIDO:', p) } catch (e) {}
      if (!p) return

      // soporte para frames directos de grupo: { tipo: 'CHAT_GRUPO', grupo, emisor, mensaje, ts, id }
      if (p.tipo === 'CHAT_GRUPO' || p.tipo === 'chat_grupo') {
        const incoming = p
        const item = Object.assign({}, {
          id: incoming.id || incoming.id_mensaje || null,
          tipo: 'grupo',
          grupo: incoming.grupo,
          emisor: incoming.emisor,
          mensaje: incoming.mensaje,
          ts: incoming.ts || Date.now(),
          leido: false,
          status: 'received'
        })
        // preserve clientId/localId when server echoes it
        if (incoming.clientId) item.localId = incoming.clientId
        // normalizaciones
        try {
          item.emisorNorm = (item.emisor || '').toString().trim().toLowerCase()
          item.grupoNorm = (item.grupo || '').toString().trim().toLowerCase()
        } catch (e) { }
        // Si el emisor es el usuario actual, esto es un eco/ack: NO insertar duplicado.
        const currentUser = usernameRef.current
        if (currentUser && item.emisorNorm === currentUser) {
          // actualizar estado local mezclando datos en la entrada optimista
          setMessages(prev => prev.map(m => m.localId === item.localId ? Object.assign({}, m, item) : m))
          return
        }

        // persistir y actualizar estado para mensajes recibidos de otros integrantes
        setMessages((prev) => {
          try {
            if (item.localId) {
              const existe = prev.some(x => x.localId === item.localId)
              if (existe) return prev.map(m => m.localId === item.localId ? Object.assign({}, m, item) : m)
            }
          } catch (e) {}
          return [...prev, item]
        })
        // ensure UI knows about this group (only for current user)
        try {
          const current = usernameRef.current
          if (current) {
            const existing = Array.isArray(groupsByUser[current]) ? groupsByUser[current] : Array.isArray(groups) ? groups : []
            const newList = Array.from(new Set([...(existing||[]), item.grupo]))
            setGroupsForCurrent(current, newList)
          }
        } catch (e) {}
        return
      }

      const { mensaje, data } = p

      // Support backend status frame via p.type === 'status' (handled below)

      // Nuevo: manejo de CONTACTS (lista de contactos ricos) y STATUS (cambios de presencia)
      // CONTACTS messages are ignored in the users-first UI (server provides USERS/CONECTADOS/STATUS)

      // New: server can send a rich USERS list via { type: 'users', users: [...] }
      // Ignore CONTACTS frames (server sends CONTACTS but UI uses USERS/CONECTADOS/STATUS)
      if ((p && p.type === 'contacts') || mensaje === 'CONTACTS') {
        console.log('CONTACTS ignorados')
        return
      }

      if ((p && p.type === 'users') || mensaje === 'USERS') {
        try {
          const arr = (p && p.type === 'users' && Array.isArray(p.users))
            ? p.users
            : (Array.isArray(data) ? data : (data && Array.isArray(data.users) ? data.users : []))
          const mapped = Array.isArray(arr)
            ? arr.map(u => {
                if (!u) return null
                if (typeof u === 'string') return { username: u, online: false, lastSeen: null }
                return { username: u.username || u.nombre || u.name || (u.id || ''), online: u.online === true, lastSeen: u.lastSeen || u.last_seen || null }
              }).filter(Boolean)
            : []
          setUsers(mapped)
          console.log('USERS', mapped)
        } catch (e) { console.error('Error procesando USERS', e) }
        return
      }

      if ((p && p.type === 'unread_counts') || mensaje === 'UNREAD_COUNTS') {
        try {
          const map = (p && p.type === 'unread_counts' && p.data) ? p.data : (data || {})
          setUnreadMap(typeof map === 'object' ? map : {})
        } catch (e) { console.error('Error procesando UNREAD_COUNTS', e) }
        return
      }

      if ((p && p.type === 'conectados') || mensaje === 'CONECTADOS') {
        try {
          const conectados = Array.isArray(data) ? data : (data && Array.isArray(data.users) ? data.users : [])
          const conectadosNorm = Array.isArray(conectados) ? conectados.map(c => (c||'').toString().trim().toLowerCase()) : []
          setUsers(prev => Array.isArray(prev) ? prev.map(u => ({ ...u, online: conectadosNorm.includes((u.username||'').toString().trim().toLowerCase()) })) : prev)
        } catch (e) { console.error('Error procesando CONECTADOS', e) }
        return
      }

      if ((p && p.type === 'status') || mensaje === 'STATUS') {
        try {
          const payload = (p && p.type === 'status') ? p : data
          if (!payload) return
          const uname = payload.username || payload.user || payload.usuario
          if (!uname) return
          const online = typeof payload.online !== 'undefined' ? !!payload.online : Boolean(payload && payload.online)
          const lastSeen = payload && (payload.lastSeen || payload.last_seen) ? (payload.lastSeen || payload.last_seen) : (payload && payload.last_seen === 0 ? 0 : null)
          const unameNorm = (uname||'').toString().trim().toLowerCase()
          setUsers(prev => Array.isArray(prev) ? prev.map(u => {
            try {
              const uNorm = (u.username||'').toString().trim().toLowerCase()
              if (uNorm === unameNorm) return { ...u, online: online, lastSeen: lastSeen }
            } catch(e) {}
            return u
          }) : prev)
        } catch (e) { console.error('Error procesando STATUS', e) }
        return
      }

        if (mensaje === 'HISTORIAL') {
        try {
          if (Array.isArray(data) && data.length) {
            setMessages(prev => {
              const existentes = new Set(prev.map(m => m.id ?? `${m.ts}-${m.emisor}-${m.mensaje}`))
              const nuevos = []
              for (const it of data) {
                const id = it.id ?? null
                const key = id ?? `${it.ts}-${it.emisor}-${it.mensaje}`
                if (existentes.has(key)) continue
                existentes.add(key)
                const item = Object.assign({}, {
                  id: it.id || null,
                  emisor: it.emisor || null,
                  receptor: it.receptor || it.receptor || null,
                  tipo: it.tipo || (it.grupo ? 'grupo' : 'privado'),
                  grupo: it.grupo || null,
                  mensaje: it.mensaje || it.contenido || '',
                  ts: it.ts || it.enviado_at || Date.now(),
                  leido: !!it.leido,
                  status: 'received',
                  readBy: Array.isArray(it.readBy) ? it.readBy.slice() : (it.readBy || [])
                })
                try { item.emisorNorm = (item.emisor || '').toString().trim().toLowerCase() } catch(e){}
                nuevos.push(item)
              }
              const updated = [...prev, ...nuevos]
              
              return updated
            })
          }
        } catch (e) { console.error('Error procesando HISTORIAL', e) }
        return
      }

      // Ensure pending CHAT messages received on IDENTIFICACION are added to state
      if (mensaje === 'CHAT' && data) {
        const incoming = data
        const id = incoming.id || incoming.id_mensaje || null
        if (id && !seenIds.current.has(id)) {
          seenIds.current.add(id)
          const item = Object.assign({}, incoming, { ts: incoming.ts || Date.now(), id, status: 'received', leido: incoming.leido || false })
          setMessages(prev => (prev.some(x => (x.id || x.localId) === id) ? prev : [...prev, item]))
        }
      }

      if (mensaje === 'SENT') {
        if (data) {
          const id = data.id_mensaje || data.id
          const clientId = data.clientId
          if (clientId && pending.current.has(clientId)) {
            const localKey = pending.current.get(clientId)
            setMessages((m) => m.map(msg => msg.localId === localKey ? Object.assign({}, msg, { id, ts: data.ts || Date.now(), status: 'sent' }) : msg))
            pending.current.delete(clientId)
            if (id) seenIds.current.add(id)
          }
        }
        return
      }

      if (mensaje === 'DELIVERED') {
        if (data) {
          const id = data.id_mensaje || data.id
          const clientId = data.clientId
          setMessages((m) => m.map(msg => {
            if ((id && msg.id === id) || (clientId && msg.localId === clientId)) return Object.assign({}, msg, { status: 'delivered' })
            return msg
          }))
        }
        return
      }

      // legacy CONECTADOS handled above as type 'users'

      if (mensaje === 'GRUPOS') {
        const current = usernameRef.current
        const visible = Array.isArray(data) ? data.filter(g => {
          const miembros = Array.isArray(g.miembros) ? g.miembros : []
          const miembrosNorm = miembros.map(x => String(x).trim().toLowerCase())
          return !!current && miembrosNorm.includes(current)
        }) : []

        const names = visible.map(g => (g.nombreGrupo || g.nombre || '').toString().trim())
        setGroupsForCurrent(current, Array.from(names))
        console.log('GROUPS', names)
        return
      }

      if (mensaje === 'PENDING') {
        try {
          const msgs = data && Array.isArray(data.messages) ? data.messages : (data && data.messages ? [data.messages] : [])
          for (const it of msgs) {
            const item = Object.assign({}, {
              id: it.id || it.id_mensaje || null,
              emisor: it.emisor || null,
              tipo: it.tipo || (it.grupo ? 'grupo' : 'privado'),
              grupo: it.grupo || null,
              mensaje: it.mensaje || it.contenido || '',
              ts: it.ts || it.enviado_at || Date.now(),
              leido: false,
              status: 'received'
            })
            try { item.emisorNorm = (item.emisor || '').toString().trim().toLowerCase() } catch(e){}
            setMessages(prev => (prev.some(x => x.id === item.id) ? prev : [...prev, item]))
          }
        } catch (e) { console.error('Error procesando PENDING', e) }
        return
      }

      

      if (mensaje === 'CHAT') {
        const id = data.id || data.id_mensaje || null
        if (id && seenIds.current.has(id)) return
        if (id) seenIds.current.add(id)

        try {
          if (data && data.emisor && typeof data.emisor === 'object') {
            const idE = data.emisor.id || data.emisor.nombre || data.emisor.name
            const name = (data.emisor.nombre || data.emisor.name || idE || '').toString()
            const idNorm = norm(name)
            data.emisorId = idNorm
            data.emisor = name
          }
        } catch (e) { console.error('Error normalizando emisor en CHAT', e) }

        if (data.clientId && pending.current.has(data.clientId)) {
          const localKey = pending.current.get(data.clientId)
          // normalize emisor/receptor/grupo for the reconciled message
          const em = (data.emisor || '').toString()
          const emNorm = norm(em)
          let receptorNorm = null
          if (Array.isArray(data.receptor)) receptorNorm = data.receptor.map(r => (r||'').toString().trim().toLowerCase())
          else if (typeof data.receptor === 'string') receptorNorm = (data.receptor||'').toString().trim().toLowerCase()
          const grupoNorm = data.grupo ? norm(data.grupo) : null

          setMessages((m) => m.map(msg => msg.localId === localKey ? Object.assign({}, data, { id, ts: data.ts || Date.now(), status: 'sent', emisorNorm: emNorm, receptorNorm, grupoNorm }) : msg))
          pending.current.delete(data.clientId)
          return
        }

        // normalize emisor and receptor for storage/comparisons
        const em = (data.emisor || '').toString()
        const emNorm = norm(em)
        let receptorNorm = null
        if (Array.isArray(data.receptor)) receptorNorm = data.receptor.map(r => (r||'').toString().trim().toLowerCase())
        else if (typeof data.receptor === 'string') receptorNorm = (data.receptor||'').toString().trim().toLowerCase()
        const grupoNorm = data.grupo ? norm(data.grupo) : null

        // If this is a group message, include tipo/grupo and grupoNorm
        const item = Object.assign({}, data, { ts: data.ts || Date.now(), id: id, leido: data.leido || false, status: 'received', emisorNorm: emNorm, receptorNorm, grupoNorm })
        if (data && data.clientId) item.localId = data.clientId
        // Si el emisor es el usuario actual, esto es un eco/ack: NO insertar duplicado.
        const currentUser = usernameRef.current
        if (currentUser && (item.emisorNorm || norm(item.emisor)) === currentUser) {
          setMessages(prev => prev.map(m => m.localId === item.localId ? Object.assign({}, m, item) : m))
          return
        }

        // merge if optimistic local exists, else append
        setMessages((prev) => {
          try {
            if (item.localId) {
              const existe = prev.some(x => x.localId === item.localId)
              if (existe) return prev.map(m => m.localId === item.localId ? Object.assign({}, m, item) : m)
            }
          } catch (e) {}
          return [...prev, item]
        })
        if (item.tipo === 'grupo' || item.grupo) {
              try {
                const current = usernameRef.current
                if (current) {
                  const existing = Array.isArray(groupsByUser[current]) ? groupsByUser[current] : Array.isArray(groups) ? groups : []
                  const newList = Array.from(new Set([...(existing||[]), item.grupo]))
                  setGroupsForCurrent(current, newList)
                }
              } catch (e) {}
        }
        return
      }

      if (mensaje === 'LEIDO') {
        if (data && data.id_mensaje) {
          const lectorNorm = data.lector ? norm(data.lector) : null
          setMessages((m) => m.map(msg => {
            if (msg.id !== data.id_mensaje) return msg
            const updated = Object.assign({}, msg)
            updated.leido = true
            if (Array.isArray(data.readers)) updated.readBy = data.readers.slice()
            else if (data.lector) updated.readBy = Array.from(new Set([...(msg.readBy||[]), data.lector]))
            // si el mensaje lo enviamos nosotros, actualizar estado a 'read'
            if ((msg.emisorNorm || norm(msg.emisor)) === usernameRef.current) {
              updated.status = 'read'
            }
            return updated
          }))
        }
        return
      }

      if (mensaje === 'GRUPO_CREADO') {
        try {
          const current = usernameRef.current
          const integrantes = Array.isArray(data && data.miembros) ? (data.miembros.map(x => String(x).trim())) : []
          const nombre = (data && (data.nombreGrupo || data.nombre) ? (data.nombreGrupo || data.nombre) : JSON.stringify(data)).toString().trim()
          if (current && integrantes.includes(String(current).trim())) {
            const current = usernameRef.current
            if (current) {
              const existing = Array.isArray(groupsByUser[current]) ? groupsByUser[current] : Array.isArray(groups) ? groups : []
              const newList = Array.from(new Set([...(existing||[]), nombre]))
              setGroupsForCurrent(current, newList)
            }
          }
        } catch (e) { console.error(e) }
        return
      }
    }

    ws.onclose = () => {
      setConnected(false)
      setUsers([])
    }

    ws.onerror = () => {
      // no-op minimal handling
    }
  }, [])

  const disconnect = useCallback(() => {
    if (wsRef.current) wsRef.current.close()
    wsRef.current = null
    setConnected(false)
    setUsers([])
  }, [])

  const sendChat = useCallback((receptor, texto, emisorName) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    const receptorTrim = (receptor || '').toString().trim()
    const groupNames = Array.isArray(groups) ? groups.map(g => String(g).trim()) : []
    const isGroup = groupNames.includes(receptorTrim)

    const clientId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `c-${Date.now()}-${Math.floor(Math.random()*1000000)}`
    const em = (emisorName || '').toString()
    const emNorm = em.toString().trim().toLowerCase()
    const receptorNorm = isGroup
      ? null
      : (receptor === 'Todos' ? 'todos' : [ (receptor || '').toString().trim().toLowerCase() ])

    // build local message with explicit tipo and fields: 'privado' or 'grupo' (or broadcast)
    let local = null
    if (isGroup) {
      local = { localId: clientId, tipo: 'grupo', grupo: receptorTrim, emisor: em, emisorNorm: emNorm, mensaje: texto, ts: Date.now(), status: 'sending', leido: false }
    } else if (receptor === 'Todos') {
      local = { localId: clientId, tipo: 'broadcast', emisor: em, emisorNorm: emNorm, receptor: 'Todos', mensaje: texto, ts: Date.now(), status: 'sending', leido: false, broadcast: true }
    } else {
      local = { localId: clientId, tipo: 'privado', emisor: em, emisorNorm: emNorm, receptor: (receptor || '').toString(), receptorNorm, mensaje: texto, ts: Date.now(), status: 'sending', leido: false }
    }
    setMessages((m) => [...m, local])
    pending.current.set(clientId, clientId)

    const payload = receptor === 'Todos'
      ? { mensaje: 'CHAT', data: { receptor: 'Todos', mensaje: texto, emisor: em, clientId } }
      : isGroup
        ? { mensaje: 'CHAT_GRUPO', data: { grupo: receptorTrim, mensaje: texto, emisor: em, clientId } }
        : { mensaje: 'CHAT', data: { receptor: receptor, mensaje: texto, emisor: em, clientId } }

    wsRef.current.send(JSON.stringify(payload))
  }, [users, groups])

  const sendReadReceipt = useCallback((id_mensaje, originalEmisor, lector) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    if (!id_mensaje || !originalEmisor) return

    setMessages((m) => m.map(msg => {
      if (msg.id !== id_mensaje) return msg
      const updated = Object.assign({}, msg, { leido: true })
      updated.readBy = Array.from(new Set([...(msg.readBy||[]), lector]))
      return updated
    }))

    wsRef.current.send(JSON.stringify({ mensaje: 'LEIDO', data: { id_mensaje, emisor: originalEmisor, lector: lector || null } }))
  }, [setMessages])

  const clearUnreadFor = useCallback((contactId) => {
    if (!contactId) return
    setUnreadMap(prev => Object.assign({}, prev, { [contactId]: 0 }))
  }, [])

  const loadMessagesFor = useCallback(async () => {
    return []
  }, [])

  const createGroup = useCallback((nombreGrupo, miembros) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({ mensaje: 'CREAR_GRUPO', data: { nombreGrupo, miembros } }))
  }, [])

  const leaveGroup = useCallback(async (grupo) => {
    try {
      const me = usernameRef.current
      if (!grupo || !me) return false
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ mensaje: 'LEAVE_GROUP', data: { grupo } }))
      }
      setGroupsByUser(prev => {
        const copy = Object.assign({}, prev || {})
        const list = Array.isArray(copy[me]) ? copy[me].filter(g => g !== grupo) : []
        copy[me] = list
        return copy
      })
      setGroups(prev => Array.isArray(prev) ? prev.filter(g => g !== grupo) : [])
      setMessages(prev => (Array.isArray(prev) ? prev.filter(m => !(m.tipo === 'grupo' && m.grupo === grupo)) : []))
      return true
    } catch (e) { console.error('leaveGroup error', e); return false }
  }, [])

  const deleteContact = useCallback(async (contactId) => {
    try {
      // Ask backend to delete contact link and related server-side data
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ mensaje: 'DELETE_CONTACT', data: contactId }))
      }
      // Update UI state while the backend owns the canonical data.
      setUsers(prev => (Array.isArray(prev) ? prev.filter(u => (u && u.username ? u.username : u) !== contactId) : []))
      setMessages(prev => (Array.isArray(prev) ? prev.filter(m => !(m.tipo === 'privado' && (m.emisor === contactId || m.receptor === contactId))) : []))
      return true
    } catch (e) { console.error('deleteContact error', e); return false }
  }, [])

  const addContact = useCallback(async (username) => {
    if (!username) return false
    const uname = (username || '').toString().trim()
    // In users-first design, avoid local contact stores; request server to add contact if connected
    // If connected, ask server to add contact (will validate existence and create mutual links)
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ mensaje: 'ADD_CONTACT', data: uname }))
        return true
      }
    } catch (e) { console.error('Error sending ADD_CONTACT', e) }

    // fallback: local-only
    return true
  }, [])

  const renameGroup = useCallback(async (oldName, newName) => {
    try {
      if (!oldName || !newName) return false
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ mensaje: 'RENAME_GROUP', data: { oldName, newName } }))
      }
      const me = usernameRef.current
      if (me) {
        setGroupsByUser(prev => {
          const copy = Object.assign({}, prev || {})
          const list = Array.isArray(copy[me]) ? copy[me].map(g => g === oldName ? newName : g) : []
          copy[me] = list
          return copy
        })
        setGroups(prev => Array.isArray(prev) ? prev.map(g => g === oldName ? newName : g) : prev)
      }
      setMessages(prev => Array.isArray(prev) ? prev.map(m => (m && m.tipo === 'grupo' && m.grupo === oldName) ? Object.assign({}, m, { grupo: newName, grupoNorm: norm(newName) }) : m) : prev)
      return true
    } catch (e) { console.error('renameGroup error', e); return false }
  }, [])

  const renameContact = useCallback(async (contactId, newName) => {
    try {
      if (!contactId || !newName) return false
      // ask backend to rename/update contact label; backend owns canonical usernames
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ mensaje: 'RENAME_CONTACT', data: { contactId, newName } }))
      }
      // update UI lists optimistically based on current users state
      setUsers(prev => Array.isArray(prev) ? prev.map(u => (u && (u.username === contactId || u.username === (u.nombre || '')) ? Object.assign({}, u, { username: newName }) : u)) : prev)
      setMessages(prev => Array.isArray(prev) ? prev.map(m => {
        if (!m) return m
        if (m.tipo === 'privado') {
          const copy = Object.assign({}, m)
          if (copy.emisor === contactId) { copy.emisor = newName; copy.emisorNorm = norm(newName) }
          if (copy.receptor === contactId) { copy.receptor = newName; copy.receptorNorm = norm(newName) }
          return copy
        }
        return m
      }) : prev)
      return true
    } catch (e) { console.error('renameContact error', e); return false }
  }, [])

  return { connect, disconnect, sendChat, sendReadReceipt, createGroup, leaveGroup, deleteContact, renameGroup, renameContact, addContact, connected, users, groups, messages, groupsByUser, dbReady, unreadMap, clearUnreadFor }

}
