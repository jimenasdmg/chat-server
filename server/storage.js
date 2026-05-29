import { db } from './db.js'

const norm = (s) => (s != null ? s.toString().trim() : s)

const storage = {
  async init() {
    // initialization hook retained for parity; no contact-table migration performed
  },

  async addClient(nombre) {
    if (!nombre) return
    console.log('MariaDB addClient -> delegando a addUser', nombre)
    return this.addUser(nombre)
  },
  async removeClient(nombre) {
    if (!nombre) return
    console.log('MariaDB removeClient -> delegando a removeUser', nombre)
    return this.removeUser(nombre)
  },

  async addUser(nombre) {
    const nombreLimpio = norm(nombre)
    if (!nombreLimpio) return
    console.log('MariaDB INSERT usuario', nombreLimpio)
    const [rows] = await db.execute('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?)', [nombreLimpio])
    if (rows.length === 0) {
      await db.execute('INSERT INTO usuarios (username, online, created_at, last_seen) VALUES (?, 1, NOW(), NOW())', [nombreLimpio])
    } else {
      await db.execute('UPDATE usuarios SET username = ?, online = 1, last_seen = NOW() WHERE LOWER(username) = LOWER(?)', [nombreLimpio, nombreLimpio])
    }
  },

  async removeUser(nombre) {
    const nombreLimpio = norm(nombre)
    if (!nombreLimpio) return
    console.log('MariaDB UPDATE usuario offline', nombreLimpio)
    await db.execute('UPDATE usuarios SET username = ?, online = 0, last_seen = NOW() WHERE LOWER(username) = LOWER(?)', [nombreLimpio, nombreLimpio])
  },

  async getUsers() {
    const [rows] = await db.execute('SELECT id, username, online, created_at, last_seen FROM usuarios')
    // Deduplicate users by case-insensitive username: prefer most recent last_seen and online=true
    const map = new Map()
    for (const r of rows) {
      if (!r || !r.username) continue
      const key = (r.username || '').toString().trim().toLowerCase()
      const existing = map.get(key)
      const lastSeen = r.last_seen || null
      const online = !!r.online
      if (!existing) {
        map.set(key, { id: r.id, username: r.username, online, last_seen: lastSeen })
      } else {
        // Merge: if any row shows online=true, keep online
        existing.online = existing.online || online
        // keep the most recent last_seen
        if (!existing.last_seen) existing.last_seen = lastSeen
        else if (lastSeen && new Date(lastSeen) > new Date(existing.last_seen)) existing.last_seen = lastSeen
        map.set(key, existing)
      }
    }
    return Array.from(map.values())
  },

  // Ensure a user exists; returns the user id (creates if missing)
  async ensureUser(nombre) {
    const nombreLimpio = norm(nombre)
    if (!nombreLimpio) return null
    const [rows] = await db.execute('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?)', [nombreLimpio])
    if (rows && rows.length) return rows[0].id
    const [ins] = await db.execute('INSERT INTO usuarios (username, created_at) VALUES (?, NOW())', [nombreLimpio])
    return ins.insertId
  },


  // Return array of usernames
  async getAllUsers() {
    const [rows] = await db.execute('SELECT username FROM usuarios')
    return rows.map(r => r.username)
  },

  // Buscar usuario por nombre; retorna fila o null
  async buscarUsuario(nombre) {
    const nombreLimpio = norm(nombre)
    if (!nombreLimpio) return null
    const [rows] = await db.execute('SELECT id, username, online, created_at, last_seen FROM usuarios WHERE LOWER(username) = LOWER(?)', [nombreLimpio])
    if (rows && rows.length) return rows[0]
    return null
  },

  async addMessage(msg) {
    console.log("ENTRÓ addMessage")
    console.log(msg)

    try {
      if (!msg) return null
      let tipo = msg.tipo || (msg.broadcast ? 'broadcast' : (msg.grupo ? 'grupo' : 'private'))
      if (tipo === 'private') tipo = 'privado'
      if (tipo === 'broadcast') tipo = 'privado'
      if (tipo === 'grupo') tipo = 'grupo'
      const texto = msg.mensaje || msg.texto || ''

      let emisorId = null
      if (msg.emisor) {
        const emisorLimpio = norm(msg.emisor)
        const [erows] = await db.execute('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?)', [emisorLimpio])
        if (erows && erows.length) emisorId = erows[0].id
        else {
          const [ins] = await db.execute('INSERT INTO usuarios (username, created_at) VALUES (?, NOW())', [emisorLimpio])
          emisorId = ins.insertId
        }
      }

      let grupoId = null
      if (msg.grupo) {
        const [grows] = await db.execute('SELECT id FROM grupos WHERE nombre = ?', [msg.grupo])
        if (grows && grows.length) grupoId = grows[0].id
      }

      let receptorId = null
      if (tipo !== 'grupo' && !msg.broadcast) {
        const targets = Array.isArray(msg.receptor) ? msg.receptor : [msg.receptor]
        if (targets && targets[0]) {
          const targetLimpio = norm(targets[0])
          const [trows] = await db.execute('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?)', [targetLimpio])
          if (trows && trows.length) receptorId = trows[0].id
        }
      }

      console.log('MariaDB INSERT mensaje', { emisor: msg.emisor, emisorId, tipo, grupo: msg.grupo })
      const [res] = await db.execute(
        'INSERT INTO mensajes (tipo, emisor_id, receptor_id, grupo_id, contenido, enviado_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [tipo, emisorId, receptorId, grupoId, texto]
      )
      const id = res.insertId

      if (tipo === 'privado' && msg.broadcast) {
        const [users] = await db.execute('SELECT id FROM usuarios')
        for (const u of users) {
          await db.execute('INSERT INTO message_recipients (mensaje_id, usuario_id, entregado, leido, entregado_at, leido_at) VALUES (?, ?, 0, 0, NULL, NULL)', [id, u.id])
        }
      } else if (tipo === 'grupo') {
        let gid = grupoId
        if (!gid && msg.grupo) {
          const [grows] = await db.execute('SELECT id FROM grupos WHERE nombre = ?', [msg.grupo])
          if (grows && grows.length) gid = grows[0].id
        }
        if (gid) {
            const [rows] = await db.execute('SELECT usuario_id FROM grupo_integrantes WHERE grupo_id = ?', [gid])
            for (const r of rows) {
              // do not create recipient for the emisor itself
              if (r.usuario_id === emisorId) continue
              await db.execute('INSERT INTO message_recipients (mensaje_id, usuario_id, entregado, leido, entregado_at, leido_at) VALUES (?, ?, 0, 0, NULL, NULL)', [id, r.usuario_id])
            }
        }
        } else {
        const targets = Array.isArray(msg.receptor) ? msg.receptor : [msg.receptor]
        for (const t of targets) {
          if (!t) continue
          const tLimpio = norm(t)
          const [urows] = await db.execute('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?)', [tLimpio])
          let uid = null
          if (urows && urows.length) uid = urows[0].id
          else {
            const [insertRes] = await db.execute('INSERT INTO usuarios (username, created_at) VALUES (?, NOW())', [tLimpio])
            uid = insertRes.insertId
          }
          await db.execute('INSERT INTO message_recipients (mensaje_id, usuario_id, entregado, leido, entregado_at, leido_at) VALUES (?, ?, 0, 0, NULL, NULL)', [id, uid])
        }
      }

      // NOTE: contacts table no longer actively used in Phase 1

      console.log("MENSAJE GUARDADO", id)

      return id
    } catch(e) {
      console.error("ERROR addMessage:", e)
      throw e
    }
  },

  async markRead(id, lector) {
    if (!id) return []
    let uid = lector
    if (typeof lector === 'string') {
      const lectorLimpio = norm(lector)
      const [urows] = await db.execute('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?)', [lectorLimpio])
      if (urows && urows.length) uid = urows[0].id
    }
    if (uid) await db.execute('UPDATE message_recipients SET leido = 1, leido_at = NOW() WHERE mensaje_id = ? AND usuario_id = ?', [id, uid])
    const [rows] = await db.execute('SELECT u.username FROM message_recipients mr JOIN usuarios u ON mr.usuario_id = u.id WHERE mr.mensaje_id = ? AND mr.leido = 1', [id])
    return rows.map(r => r.username)
  },

  async markDelivered(mensajeId, receptor) {
    if (!mensajeId) return
    let uid = receptor
    if (typeof receptor === 'string') {
      const receptorLimpio = norm(receptor)
      const [urows] = await db.execute('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?)', [receptorLimpio])
      if (urows && urows.length) uid = urows[0].id
    }
    if (uid) await db.execute('UPDATE message_recipients SET entregado = 1, entregado_at = NOW() WHERE mensaje_id = ? AND usuario_id = ? AND entregado = 0', [mensajeId, uid])
  },

  async getPending(receptor) {
    if (!receptor) return []
    console.log('MariaDB SELECT mensajes pendientes para', receptor)
    let uid = receptor
    if (typeof receptor === 'string') {
      const receptorLimpio = norm(receptor)
      const [urows] = await db.execute('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?)', [receptorLimpio])
      if (urows && urows.length) uid = urows[0].id
    }
    if (!uid) return []
    const [rows] = await db.execute(
      'SELECT mr.mensaje_id AS id, u.username AS emisor, m.contenido AS mensaje, m.tipo, m.grupo_id AS grupo, m.enviado_at AS ts FROM message_recipients mr JOIN mensajes m ON mr.mensaje_id = m.id LEFT JOIN usuarios u ON m.emisor_id = u.id WHERE mr.usuario_id = ? AND mr.entregado = 0',
      [uid]
    )
    return rows.map(r => ({ id: r.id, emisor: r.emisor, mensaje: r.mensaje, tipo: r.tipo, grupo: r.grupo, ts: r.ts }))
  },

  async getMessages() {
    console.log('MariaDB SELECT mensajes (historial)')
    const [msgs] = await db.execute('SELECT * FROM mensajes ORDER BY enviado_at ASC')
    const out = []
    for (const m of msgs) {
      const [rows] = await db.execute('SELECT usuario_id, entregado, leido FROM message_recipients WHERE mensaje_id = ?', [m.id])
      const readBy = []
      const receptorNames = []
      for (const r of rows) {
        const [urows] = await db.execute('SELECT username FROM usuarios WHERE id = ?', [r.usuario_id])
        const uname = (urows && urows.length) ? urows[0].username : null
        if (r.leido == 1 && uname) readBy.push(uname)
        if (uname) receptorNames.push(uname)
      }
      const receptor = receptorNames.length === 1 ? receptorNames[0] : receptorNames
      let emisorName = null
      if (m.emisor_id) {
        const [erows] = await db.execute('SELECT username FROM usuarios WHERE id = ?', [m.emisor_id])
        if (erows && erows.length) emisorName = erows[0].username
      }
      let grupoName = null
      if (m.grupo_id) {
        const [grows] = await db.execute('SELECT nombre FROM grupos WHERE id = ?', [m.grupo_id])
        if (grows && grows.length) grupoName = grows[0].nombre
      }
      out.push({ id: m.id, emisor: emisorName, receptor, tipo: m.tipo, grupo: grupoName, mensaje: m.contenido, ts: m.enviado_at, readBy })
    }
    return out
  },

  async getGroups(usuario) {
    const out = []
    if (usuario) {
      const usuarioLimpio = norm(usuario)
      const [urows] = await db.execute('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?)', [usuarioLimpio])
      if (!urows || !urows.length) return out
      const uid = urows[0].id
      const [rows] = await db.execute('SELECT grupo_id FROM grupo_integrantes WHERE usuario_id = ?', [uid])
      for (const r of rows) {
        const gid = r.grupo_id
        const [grows] = await db.execute('SELECT id, nombre FROM grupos WHERE id = ?', [gid])
        if (!grows || !grows.length) continue
        const g = grows[0]
        const [members] = await db.execute('SELECT u.username FROM grupo_integrantes gi JOIN usuarios u ON gi.usuario_id = u.id WHERE gi.grupo_id = ?', [gid])
        out.push({ nombreGrupo: g.nombre, miembros: members.map(x => x.username) })
      }
      return out
    }
    const [groups] = await db.execute('SELECT id, nombre FROM grupos')
    for (const g of groups) {
      const [rows] = await db.execute('SELECT u.username FROM grupo_integrantes gi JOIN usuarios u ON gi.usuario_id = u.id WHERE gi.grupo_id = ?', [g.id])
      out.push({ nombreGrupo: g.nombre, miembros: rows.map(r => r.username) })
    }
    return out
  },
  async createGroup(nombre, creador, integrantes) {
    if (!nombre) return
    const group = { nombreGrupo: nombre, miembros: Array.isArray(integrantes) ? integrantes : [], creador }
    return this.addGroup(group)
  },

  async getGroupMembers(grupo) {
    // grupo can be id (number) or nombre (string)
    if (!grupo) return []
    let gid = null
    if (typeof grupo === 'number') gid = grupo
    else {
      const [grows] = await db.execute('SELECT id FROM grupos WHERE nombre = ?', [grupo])
      if (!grows || !grows.length) return []
      gid = grows[0].id
    }
    const [rows] = await db.execute('SELECT u.username FROM grupo_integrantes gi JOIN usuarios u ON gi.usuario_id = u.id WHERE gi.grupo_id = ?', [gid])
    return rows.map(r => r.username)
  },

  async removeUserFromGroup(grupo, usuario) {
    if (!grupo || !usuario) return false
    const [grows] = await db.execute('SELECT id FROM grupos WHERE nombre = ?', [grupo])
    if (!grows || !grows.length) return false
    const usuarioLimpio = norm(usuario)
    const [urows] = await db.execute('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?)', [usuarioLimpio])
    if (!urows || !urows.length) return false
    await db.execute('DELETE FROM grupo_integrantes WHERE grupo_id = ? AND usuario_id = ?', [grows[0].id, urows[0].id])
    return true
  },

  async renameGroup(oldName, newName) {
    if (!oldName || !newName) return false
    const cleanName = String(newName).trim()
    if (!cleanName) return false
    const [result] = await db.execute('UPDATE grupos SET nombre = ? WHERE nombre = ?', [cleanName, oldName])
    return result.affectedRows > 0
  },

  async saveGroupMessage(grupo, emisor, mensaje) {
    if (!grupo || !emisor) return null
    // resolve grupo id
    let gid = null
    if (typeof grupo === 'number') gid = grupo
    else {
      const [grows] = await db.execute('SELECT id FROM grupos WHERE nombre = ?', [grupo])
      if (!grows || !grows.length) return null
      gid = grows[0].id
    }
    // ensure emisor exists
    let emisorId = null
    const emisorLimpio = norm(emisor)
    const [erows] = await db.execute('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?)', [emisorLimpio])
    if (erows && erows.length) emisorId = erows[0].id
    else {
      const [ins] = await db.execute('INSERT INTO usuarios (username, created_at) VALUES (?, NOW())', [emisorLimpio])
      emisorId = ins.insertId
    }

    const tipo = 'grupo'
    const texto = mensaje || ''
    const [res] = await db.execute('INSERT INTO mensajes (tipo, emisor_id, grupo_id, contenido, enviado_at) VALUES (?, ?, ?, ?, NOW())', [tipo, emisorId, gid, texto])
    const id = res.insertId

    // create recipients for integrantes excluding emisor
    const [members] = await db.execute('SELECT usuario_id FROM grupo_integrantes WHERE grupo_id = ?', [gid])
    for (const r of members) {
      if (r.usuario_id === emisorId) continue
      await db.execute('INSERT INTO message_recipients (mensaje_id, usuario_id, entregado, leido, entregado_at, leido_at) VALUES (?, ?, 0, 0, NULL, NULL)', [id, r.usuario_id])
    }
    return id
  },

  async getGroupHistory(grupo) {
    if (!grupo) return []
    let gid = null
    if (typeof grupo === 'number') gid = grupo
    else {
      const [grows] = await db.execute('SELECT id FROM grupos WHERE nombre = ?', [grupo])
      if (!grows || !grows.length) return []
      gid = grows[0].id
    }
    const [msgs] = await db.execute('SELECT m.id, u.username AS emisor, m.contenido AS mensaje, m.enviado_at AS ts FROM mensajes m LEFT JOIN usuarios u ON m.emisor_id = u.id WHERE m.grupo_id = ? ORDER BY m.enviado_at ASC', [gid])
    return msgs.map(r => ({ id: r.id, emisor: r.emisor, mensaje: r.mensaje, ts: r.ts }))
  },
  
  // Devuelve un mapa de contadores de mensajes no leídos para un usuario,
  // agrupado por conversación: clave = nombre de usuario (privado) o nombre de grupo (grupo)
  async getUnreadByConversation(usuario) {
    if (!usuario) return {}
    const usuarioLimpio = norm(usuario)
    const [urows] = await db.execute('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?)', [usuarioLimpio])
    if (!urows || !urows.length) return {}
    const uid = urows[0].id
    const [rows] = await db.execute(
      `SELECT m.tipo AS tipo, g.nombre AS grupo, u.username AS emisor, COUNT(*) AS cnt
       FROM message_recipients mr
       JOIN mensajes m ON mr.mensaje_id = m.id
       LEFT JOIN grupos g ON m.grupo_id = g.id
       LEFT JOIN usuarios u ON m.emisor_id = u.id
       WHERE mr.usuario_id = ? AND mr.leido = 0
       GROUP BY m.tipo, g.nombre, u.username`,
      [uid]
    )
    const out = {}
    for (const r of rows) {
      if (r.tipo === 'grupo' || r.grupo) {
        const gname = r.grupo || 'Grupo desconocido'
        out[gname] = (out[gname] || 0) + (r.cnt || 0)
      } else {
        const ename = r.emisor || 'Desconocido'
        out[ename] = (out[ename] || 0) + (r.cnt || 0)
      }
    }
    return out
  },

  // Devuelve el número total de mensajes no leídos del usuario
  async getUnreadCount(usuario) {
    if (!usuario) return 0
    const usuarioLimpio = norm(usuario)
    const [urows] = await db.execute('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?)', [usuarioLimpio])
    if (!urows || !urows.length) return 0
    const uid = urows[0].id
    const [rows] = await db.execute('SELECT COUNT(*) AS cnt FROM message_recipients WHERE usuario_id = ? AND leido = 0', [uid])
    return (rows && rows[0] && rows[0].cnt) ? Number(rows[0].cnt) : 0
  },
  // contact table removed from server-side phase 1; contact links should be managed by application logic if needed

  async updateOnline(username, estado) {
    if (!username) return
    try {
      const uname = norm(username)
      if (!uname) return
      if (estado) {
        await db.execute('UPDATE usuarios SET username = ?, online = 1 WHERE LOWER(username) = LOWER(?)', [uname, uname])
      } else {
        await db.execute('UPDATE usuarios SET username = ?, online = 0, last_seen = NOW() WHERE LOWER(username) = LOWER(?)', [uname, uname])
      }
    } catch (e) { console.error('storage:updateOnline', e) }
  },

  async addGroup(group) {
    if (!group || !group.nombreGrupo) return
    const nombre = group.nombreGrupo
    // optional creador (username)
    let creadorId = null
    if (group.creador) {
      const creadorLimpio = norm(group.creador)
      const [crows] = await db.execute('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?)', [creadorLimpio])
      if (crows && crows.length) creadorId = crows[0].id
      else {
        const [insc] = await db.execute('INSERT INTO usuarios (username, created_at) VALUES (?, NOW())', [creadorLimpio])
        creadorId = insc.insertId
      }
    }

    const [grows] = await db.execute('SELECT id FROM grupos WHERE nombre = ?', [nombre])
    let gid = null
    if (!grows || !grows.length) {
      if (creadorId) {
        const [ins] = await db.execute('INSERT INTO grupos (nombre, creador_id) VALUES (?, ?)', [nombre, creadorId])
        gid = ins.insertId
      } else {
        const [ins] = await db.execute('INSERT INTO grupos (nombre) VALUES (?)', [nombre])
        gid = ins.insertId
      }
    } else gid = grows[0].id
    const miembros = Array.isArray(group.miembros) ? group.miembros : []
    for (const m of miembros) {
      const mLimpio = norm(m)
      const [urows] = await db.execute('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?)', [mLimpio])
      let uid = null
      if (urows && urows.length) uid = urows[0].id
      else {
        const [insu] = await db.execute('INSERT INTO usuarios (username, created_at) VALUES (?, NOW())', [mLimpio])
        uid = insu.insertId
      }
      await db.execute('INSERT INTO grupo_integrantes (grupo_id, usuario_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE usuario_id = usuario_id', [gid, uid])
    }
  }
}

export default storage
