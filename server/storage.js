import { db } from './db.js'

const storage = {
  async init() {
    try {
      await this._ensureContactUniqueness()
    } catch (e) {
      console.error('storage.init error ensuring contact uniqueness:', e)
    }
  },

  // Ensure contactos table has unique constraint and remove existing duplicates
  async _ensureContactUniqueness() {
    try {
      // remove duplicate rows keeping the lowest id (if id exists)
      await db.execute(`DELETE c1 FROM contactos c1
        JOIN contactos c2
        ON c1.usuario_id = c2.usuario_id
        AND c1.contacto_id = c2.contacto_id
        AND c1.id > c2.id`)
    } catch (e) {
      // if table or columns don't exist, ignore for now
      // console.warn('cleanup duplicates skipped:', e.message || e)
    }

    try {
      // Check information_schema for an existing unique index named 'uq_contacto'
      const [idx] = await db.execute(
        `SELECT COUNT(*) AS cnt FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'contactos' AND index_name = 'uq_contacto'`
      )
      const exists = Array.isArray(idx) && idx.length && idx[0] && idx[0].cnt > 0
      if (!exists) {
        await db.execute('ALTER TABLE contactos ADD UNIQUE KEY uq_contacto (usuario_id, contacto_id)')
      }
    } catch (e) {
      // ignore errors (constraint may already exist)
      // console.warn('add unique constraint skipped:', e.message || e)
    }
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
    if (!nombre) return
    console.log('MariaDB INSERT usuario', nombre)
    const [rows] = await db.execute('SELECT id FROM usuarios WHERE username = ?', [nombre])
    if (rows.length === 0) {
      await db.execute('INSERT INTO usuarios (username, online, created_at, last_seen) VALUES (?, 1, NOW(), NOW())', [nombre])
    } else {
      await db.execute('UPDATE usuarios SET online = 1, last_seen = NOW() WHERE username = ?', [nombre])
    }
  },

  async removeUser(nombre) {
    if (!nombre) return
    console.log('MariaDB UPDATE usuario offline', nombre)
    await db.execute('UPDATE usuarios SET online = 0, last_seen = NOW() WHERE username = ?', [nombre])
  },

  async getUsers() {
    const [rows] = await db.execute('SELECT id, username, online, created_at, last_seen FROM usuarios')
    return rows.map(r => ({ id: r.id, nombre: r.username, connected: !!r.online, firstSeen: r.created_at, lastSeen: r.last_seen }))
  },

  // Ensure a user exists; returns the user id (creates if missing)
  async ensureUser(nombre) {
    if (!nombre) return null
    const [rows] = await db.execute('SELECT id FROM usuarios WHERE username = ?', [nombre])
    if (rows && rows.length) return rows[0].id
    const [ins] = await db.execute('INSERT INTO usuarios (username, created_at) VALUES (?, NOW())', [nombre])
    return ins.insertId
  },

  // Ensure a contact link exists (single direction). Will not create users.
  async ensureContact(usuario, contacto) {
    if (!usuario || !contacto) return
    return this.addContact(usuario, contacto)
  },

  // Return array of usernames
  async getAllUsers() {
    const [rows] = await db.execute('SELECT username FROM usuarios')
    return rows.map(r => r.username)
  },

  // Buscar usuario por nombre; retorna fila o null
  async buscarUsuario(nombre) {
    if (!nombre) return null
    const [rows] = await db.execute('SELECT id, username, online, created_at, last_seen FROM usuarios WHERE username = ?', [nombre])
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
        const [erows] = await db.execute('SELECT id FROM usuarios WHERE username = ?', [msg.emisor])
        if (erows && erows.length) emisorId = erows[0].id
        else {
          const [ins] = await db.execute('INSERT INTO usuarios (username, created_at) VALUES (?, NOW())', [msg.emisor])
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
          const [trows] = await db.execute('SELECT id FROM usuarios WHERE username = ?', [targets[0]])
          if (trows && trows.length) receptorId = trows[0].id
        }
      }

      console.log('MariaDB INSERT mensaje', { emisor: msg.emisor, emisorId, tipo, grupo: msg.grupo })
      const [res] = await db.execute(
        'INSERT INTO mensajes (tipo, emisor_id, receptor_id, grupo_id, contenido, enviado_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [tipo, emisorId, receptorId, grupoId, texto]
      )
      const id = res.insertId

      console.log("CREANDO CONTACTOS", emisorId, receptorId)

      if (
        tipo === "privado" &&
        emisorId &&
        receptorId
      ) {
        await this.addContact(emisorId, receptorId)
        await this.addContact(receptorId, emisorId)
      }

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
          const [urows] = await db.execute('SELECT id FROM usuarios WHERE username = ?', [t])
          let uid = null
          if (urows && urows.length) uid = urows[0].id
          else {
            const [insertRes] = await db.execute('INSERT INTO usuarios (username, created_at) VALUES (?, NOW())', [t])
            uid = insertRes.insertId
          }
          await db.execute('INSERT INTO message_recipients (mensaje_id, usuario_id, entregado, leido, entregado_at, leido_at) VALUES (?, ?, 0, 0, NULL, NULL)', [id, uid])
        }
      }

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
      const [urows] = await db.execute('SELECT id FROM usuarios WHERE username = ?', [lector])
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
      const [urows] = await db.execute('SELECT id FROM usuarios WHERE username = ?', [receptor])
      if (urows && urows.length) uid = urows[0].id
    }
    if (uid) await db.execute('UPDATE message_recipients SET entregado = 1, entregado_at = NOW() WHERE mensaje_id = ? AND usuario_id = ? AND entregado = 0', [mensajeId, uid])
  },

  async getPending(receptor) {
    if (!receptor) return []
    console.log('MariaDB SELECT mensajes pendientes para', receptor)
    let uid = receptor
    if (typeof receptor === 'string') {
      const [urows] = await db.execute('SELECT id FROM usuarios WHERE username = ?', [receptor])
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
      const [urows] = await db.execute('SELECT id FROM usuarios WHERE username = ?', [usuario])
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
    const [erows] = await db.execute('SELECT id FROM usuarios WHERE username = ?', [emisor])
    if (erows && erows.length) emisorId = erows[0].id
    else {
      const [ins] = await db.execute('INSERT INTO usuarios (username, created_at) VALUES (?, NOW())', [emisor])
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
  async getContacts(usuario) {
    if (!usuario) return []
    console.log('MariaDB SELECT contacts for', usuario)
    const [urows] = await db.execute('SELECT id FROM usuarios WHERE username = ?', [usuario])
    if (!urows || !urows.length) return []
    const uid = urows[0].id
    const [rows] = await db.execute('SELECT contacto_id FROM contactos WHERE usuario_id = ?', [uid])
    const out = []
    for (const r of rows) {
      const [crows] = await db.execute('SELECT username, online, last_seen FROM usuarios WHERE id = ?', [r.contacto_id])
      if (crows && crows.length) {
        const c = crows[0]
        out.push({ username: c.username, online: !!c.online, last_seen: c.last_seen })
      }
    }
    return out
  },

  async addContact(usuario, contacto) {
    if (!usuario || !contacto) return
    try {
      // support both username strings and numeric ids
      let uid = usuario
      let cid = contacto

      if (typeof usuario === 'string') {
        const [urows] = await db.execute('SELECT id FROM usuarios WHERE username = ?', [usuario])
        if (!urows || !urows.length) return
        uid = urows[0].id
      }

      if (typeof contacto === 'string') {
        const [crows] = await db.execute('SELECT id FROM usuarios WHERE username = ?', [contacto])
        if (!crows || !crows.length) return
        cid = crows[0].id
      }

      if (!uid || !cid) return

      // avoid duplicates: atomic insert-if-not-exists
      console.log(
        "INSERT CONTACTO",
        uid,
        cid
      )
      try {
        await db.execute(`INSERT INTO contactos (usuario_id, contacto_id, created_at)
          SELECT ?, ?, NOW() FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM contactos WHERE usuario_id = ? AND contacto_id = ?)`, [uid, cid, uid, cid])
      } catch (e) {
        try { await db.execute('INSERT INTO contactos (usuario_id, contacto_id, created_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE usuario_id = usuario_id', [uid, cid]) } catch (e2) { console.error(e2) }
      }
    } catch (e) {
      console.error('storage:addContact error', e)
    }
  },

  async updateOnline(username, estado) {
    if (!username) return
    try {
      if (estado) {
        await db.execute('UPDATE usuarios SET online = 1 WHERE username = ?', [username])
      } else {
        await db.execute('UPDATE usuarios SET online = 0, last_seen = NOW() WHERE username = ?', [username])
      }
    } catch (e) { console.error('storage:updateOnline', e) }
  },

  async addGroup(group) {
    if (!group || !group.nombreGrupo) return
    const nombre = group.nombreGrupo
    // optional creador (username)
    let creadorId = null
    if (group.creador) {
      const [crows] = await db.execute('SELECT id FROM usuarios WHERE username = ?', [group.creador])
      if (crows && crows.length) creadorId = crows[0].id
      else {
        const [insc] = await db.execute('INSERT INTO usuarios (username, created_at) VALUES (?, NOW())', [group.creador])
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
      const [urows] = await db.execute('SELECT id FROM usuarios WHERE username = ?', [m])
      let uid = null
      if (urows && urows.length) uid = urows[0].id
      else {
        const [insu] = await db.execute('INSERT INTO usuarios (username, created_at) VALUES (?, NOW())', [m])
        uid = insu.insertId
      }
      await db.execute('INSERT INTO grupo_integrantes (grupo_id, usuario_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE usuario_id = usuario_id', [gid, uid])
    }
  }
}

export default storage
