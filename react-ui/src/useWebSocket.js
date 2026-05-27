import { useState, useRef, useCallback, useEffect } from 'react'
import { chatBD } from './chatDB'

export default function useWebSocket() {
  const wsRef = useRef(null)
  const [connected, setConnected] = useState(false)
  const [users, setUsers] = useState([])
  const [groups, setGroups] = useState([])
  // per-user maps to avoid cross-user clobbering
  const [groupsByUser, setGroupsByUser] = useState({})
  const [messages, setMessages] = useState([])
  const [dbReady, setDbReady] = useState(false)

  const dbRef = useRef(null)
  const usernameRef = useRef(null)
  const seenIds = useRef(new Set())
  const pending = useRef(new Map()) // clientId -> local message id

  // helper para ejecutar promesas sin await en handlers sincrónicos
  const fire = (p) => { if (!p) return; if (p.then) p.catch(e => console.error('Promise error (fire):', e)) }
  // helper para ejecutar promesas sin await en handlers sincrónicos
  // (nota: la variable 'user' no existe aquí; las referencias a 'user' aparecen sólo en handlers)

  const setGroupsForCurrent = (current, arr) => {
    if (!current) return
    setGroupsByUser(prev => ({ ...(prev || {}), [current]: Array.isArray(arr) ? arr : [] }))
    setGroups(Array.isArray(arr) ? arr : [])
    console.log('USER', current)
    console.log('GROUPS USER', { ...(groupsByUser || {}), [current]: arr })
  }

  // Initialize IndexedDB wrapper for messages/groups (not contacts)
  useEffect(() => {
    let mounted = true
    const initDB = async () => {
      try {
        const db = new chatBD()
        await db.init()
        if (!mounted) return
        dbRef.current = db
        setDbReady(true)
        try { window.chatDB = dbRef.current } catch (e) {}
      } catch (err) {
        console.error('No se pudo inicializar IndexedDB:', err)
      }
    }
    initDB()
    return () => { mounted = false }
  }, [])

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

      // do NOT persist contacts in IndexedDB
      // seed groups from local DB so user's groups appear immediately
      ;(async () => {
        try {
            if (dbRef.current && username) {
            const allGroups = await dbRef.current.getGroups()
            const visible = Array.isArray(allGroups) ? allGroups.filter(g => {
              const miembros = Array.isArray(g.integrantes) ? g.integrantes : []
              const miembrosNorm = miembros.map(x => String(x).trim().toLowerCase())
              return miembrosNorm.includes(usernameNorm)
            }) : []
            const names = visible.map(g => g.id)
            if (names.length) {
              setGroupsForCurrent(usernameNorm, Array.from(names))
            }
          }
        } catch (e) { /* no-op */ }
      })()
    }

    ws.onmessage = (evt) => {
      const p = parse(evt.data)
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
          // intentar migrar el registro local a la id del servidor si es posible
          try {
            if (dbRef.current && item.localId && item.id) {
              try { dbRef.current.migrateLocalId(item.localId, item.id, item).catch(()=>{}) } catch(e){}
            }
          } catch (e) { console.error('Error migrando mensaje local desde echo grupal', e) }
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
            try {
              if (dbRef.current) {
                // ensure group exists in local groups store
                try { dbRef.current.add(item.grupo, []).catch(()=>{}) } catch(e){}
                // DO NOT persist contacts into IndexedDB (groups are handled separately)
                dbRef.current.addMessage(item)
              }
            } catch (e) { console.error('Error guardando mensaje grupal recibido', e) }
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
      if ((p && p.type === 'users') || mensaje === 'USERS' || mensaje === 'CONECTADOS') {
        try {
          // data might be array or object with { users: [] }
          const arr = (p && p.type === 'users' && Array.isArray(p.users)) ? p.users : (Array.isArray(data) ? data : (data && Array.isArray(data.users) ? data.users : []))
          const normalized = arr.map(u => {
            if (!u) return null
            if (typeof u === 'string') return { username: u, online: false, lastSeen: null }
            return { username: u.username || u.nombre || u.name || (u.id || ''), online: !!u.online, lastSeen: u.last_seen || u.lastSeen || null }
          }).filter(Boolean)
          const current = usernameRef.current
          const filtered = normalized.filter(u => norm(u.username) !== (current || ''))
          setUsers(filtered)
          console.log('USERS', filtered)
        } catch (e) { console.error('Error procesando USERS', e) }
        return
      }

      if ((p && p.type === 'status') || mensaje === 'STATUS') {
        try {
          const payload = (p && p.type === 'status') ? p : data
          const uname = payload && (payload.username || payload.user || payload.usuario) ? (payload.username || payload.user || payload.usuario) : null
          const online = payload && typeof payload.online !== 'undefined' ? !!payload.online : Boolean(payload && payload.online)
          const lastSeen = payload && (payload.lastSeen || payload.last_seen) ? (payload.lastSeen || payload.last_seen) : (payload && payload.last_seen === 0 ? 0 : null)
          if (!uname) return
          const current = usernameRef.current
          // update users array: set online/lastSeen for matching username
          setUsers(prev => {
            const arr = Array.isArray(prev) ? prev.slice() : []
            let found = false
            const mapped = arr.map(u => {
              try {
                if (norm(u.username) === norm(uname)) {
                  found = true
                  return Object.assign({}, u, { online: !!online, lastSeen: lastSeen || (online ? u.lastSeen : Date.now()) })
                }
              } catch (e) {}
              return u
            })
            if (!found && norm(uname) !== (current || '')) {
              mapped.push({ username: uname, online: !!online, lastSeen: lastSeen || (online ? null : Date.now()) })
            }
            return mapped
          })
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
          try {
            if (dbRef.current) {
              // do NOT persist contacts in IndexedDB
              try { dbRef.current.addMessage(item).catch(()=>{}) } catch(e){}
            }
          } catch (e) {}
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
            try { if (dbRef.current) dbRef.current.migrateLocalId(localKey, id, Object.assign({}, data, { ts: data.ts || Date.now() })) } catch (e) { console.error('Error migrando local->server', e) }
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

        try {
          if (Array.isArray(visible)) {
            const save = async () => {
              // esperar a que dbRef.current esté listo (reintentos cortos)
              for (let i = 0; i < 10; i++) {
                if (dbRef.current) break
                await new Promise(r => setTimeout(r, 100))
              }
              if (!dbRef.current) return
              // persist groups separately (will clear and rewrite)
              try { await dbRef.current.saveGroups(visible) } catch (e) {}
              // upsert members into contacts store (members only)
              for (const g of visible) {
                const integrantes = Array.isArray(g.miembros) ? g.miembros.map(x => String(x).trim()) : []
                // do NOT persist integrantes as contacts in IndexedDB
                for (const m of integrantes) { /* noop */ }
              }
            }
            save().catch(e => console.error('Error guardando grupos/miembros en IndexedDB', e))
          }
        } catch (e) { console.error(e) }
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
            try { if (dbRef.current) dbRef.current.addMessage(item).catch(()=>{}) } catch(e){}
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
            // do NOT persist contacts in IndexedDB
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
          try { if (dbRef.current) dbRef.current.migrateLocalId(localKey, id, Object.assign({}, data, { ts: data.ts || Date.now() })) } catch (e) { console.error('Error migrando mensaje reconciliado', e) }
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
          try {
            if (dbRef.current && item.localId && item.id) {
              try { dbRef.current.migrateLocalId(item.localId, item.id, item).catch(()=>{}) } catch(e){}
            }
          } catch (e) { console.error('Error migrando mensaje local desde echo', e) }
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
        try {
          if (dbRef.current) {
            if (item.tipo === 'grupo' || item.grupo) {
              try { dbRef.current.add(item.grupo, []).catch(()=>{}) } catch(e){}
              // do NOT persist group as a contact in IndexedDB
              try {
                const current = usernameRef.current
                if (current) {
                  const existing = Array.isArray(groupsByUser[current]) ? groupsByUser[current] : Array.isArray(groups) ? groups : []
                  const newList = Array.from(new Set([...(existing||[]), item.grupo]))
                  setGroupsForCurrent(current, newList)
                }
              } catch (e) {}
            }
            dbRef.current.addMessage(item)
          }
        } catch (e) { console.error('Error guardando mensaje', e) }
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
            if (dbRef.current) dbRef.current.add(nombre, integrantes).catch(err => console.error('Error guardando grupo:', err))
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
      // do NOT persist contacts in IndexedDB on close
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
    let receptorForLocal = null
    let receptorNorm = null
    if (isGroup) {
      receptorForLocal = receptorTrim
    } else if (receptor === 'Todos') {
      receptorForLocal = 'Todos'
      receptorNorm = 'todos'
    } else {
      receptorForLocal = [receptor]
      receptorNorm = [ (receptor || '').toString().trim().toLowerCase() ]
    }

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
    try { if (dbRef.current) dbRef.current.addMessage(local) } catch (e) { console.error('Error guardando mensaje local', e) }

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

  // Cargar mensajes desde IndexedDB para un target (Usuarios o Grupos)
  const loadMessagesFor = useCallback(async (target, usuarioActualParam) => {
    try {
      if (!dbRef.current) return []
      const msgs = await dbRef.current.getMessagesFor(target, usuarioActualParam)
      if (!Array.isArray(msgs) || msgs.length === 0) return msgs
      // merge into state avoiding duplicates by id/localId
      setMessages((prev) => {
        const existingIds = new Set(prev.map(x => x.id || x.localId).filter(Boolean))
        const toAdd = msgs.filter(x => !(existingIds.has(x.id || x.localId)))
        return [...prev, ...toAdd]
      })
      return msgs
    } catch (e) { console.error('loadMessagesFor error', e); return [] }
  }, [])

  const createGroup = useCallback((nombreGrupo, miembros) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({ mensaje: 'CREAR_GRUPO', data: { nombreGrupo, miembros } }))
  }, [])

  const leaveGroup = useCallback(async (grupo) => {
    try {
      const me = usernameRef.current
      if (!dbRef.current || !grupo || !me) return false
      await dbRef.current.removeUserFromGroup(grupo, me)
      // delete local messages for that group
      await dbRef.current.deleteMessagesByGroup(grupo)
      // update UI state: remove group from visible groups and remove messages
      // update only current user's groups
      setGroupsByUser(prev => {
        const copy = Object.assign({}, prev || {})
        const list = Array.isArray(copy[me]) ? copy[me].filter(g => g !== grupo) : []
        copy[me] = list
        return copy
      })
      // refresh visible groups for current user
      if (usernameRef.current) setGroups(groupsByUser[usernameRef.current] || [])
      setMessages(prev => (Array.isArray(prev) ? prev.filter(m => !(m.tipo === 'grupo' && m.grupo === grupo)) : []))
      return true
    } catch (e) { console.error('leaveGroup error', e); return false }
  }, [])

  const deleteContact = useCallback(async (contactId) => {
    try {
      if (!dbRef.current || !contactId) return false
      await dbRef.current.deleteContactAndMessages(contactId)
      // update UI state: remove contact, remove messages
      setUsers(prev => (Array.isArray(prev) ? prev.filter(u => (u && u.username ? u.username : u) !== contactId) : []))
      setMessages(prev => (Array.isArray(prev) ? prev.filter(m => !(m.tipo === 'privado' && (m.emisor === contactId || m.receptor === contactId))) : []))
      return true
    } catch (e) { console.error('deleteContact error', e); return false }
  }, [])

  const addContact = useCallback(async (username) => {
    if (!username) return false
    const uname = (username || '').toString().trim()
    const id = norm(uname)
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
      if (!dbRef.current || !oldName || !newName) return false
      await dbRef.current.renameGroup(oldName, newName)
      // update UI state
      // update only current user's groups
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
      // upsert contact entry for new group id
      // do NOT persist contacts in IndexedDB for group rename
      // remove old group contact entry if exists
      try { if (dbRef.current) fire(dbRef.current.deleteContact((oldName||'').toString().trim().toLowerCase())) } catch (e) {}
      return true
    } catch (e) { console.error('renameGroup error', e); return false }
  }, [])

  const renameContact = useCallback(async (contactId, newName) => {
    try {
      if (!dbRef.current || !contactId || !newName) return false
      // read existing to compute old display name
      const existing = await dbRef.current.getContact(contactId).catch(()=>null)
      const oldName = (existing && existing.nombre) ? existing.nombre : contactId
      await dbRef.current.renameContact(contactId, newName)
      // update UI lists
      setUsers(prev => Array.isArray(prev) ? prev.map(u => (u && u.username === oldName ? Object.assign({}, u, { username: newName }) : u)) : prev)
      setMessages(prev => Array.isArray(prev) ? prev.map(m => {
        if (!m) return m
        if (m.tipo === 'privado') {
          const copy = Object.assign({}, m)
          if (copy.emisor === oldName) { copy.emisor = newName; copy.emisorNorm = norm(newName) }
          if (copy.receptor === oldName) { copy.receptor = newName; copy.receptorNorm = norm(newName) }
          return copy
        }
        return m
      }) : prev)
      return true
    } catch (e) { console.error('renameContact error', e); return false }
  }, [])

  return { connect, disconnect, sendChat, sendReadReceipt, createGroup, leaveGroup, deleteContact, renameGroup, renameContact, addContact, connected, users, groups, messages, groupsByUser, dbReady }

}
