// Importa el constructor de la clase que emite eventos de servidor
import { WebSocketServer } from 'ws'
import { writeFile, readFile, access } from 'node:fs/promises'
import path from 'node:path'
import storage from './server/storage.js'

const DB_FILE = path.join(process.cwd(), 'server_data.json')

await storage.init()
// Instancia el servidor: wss es un "EventEmitter" (Emisor de Eventos)
const PORT = Number(process.env.PORT || 8083)
const wss = new WebSocketServer({ port: PORT })

console.log(`Servidor WebSocket iniciado en ws://0.0.0.0:${PORT}`)

// Lista global de clientes (almacena las instancias ws)
let clientes = []

// contador simple para ids de mensaje
let mensajeId = 1

let mensajesStore = []

// Enviar lista de conectados a todos los clientes
function enviarConectados() {
	// Obtener usuarios conectados desde sockets activos (no usar storage para presencia realtime)
	try {
		const activos = clientes.filter(c => c && c.readyState === 1 && c.nombre).map(c => c.nombre)
		const nombresUnicos = [...new Set(activos)]
		const payload = JSON.stringify({ mensaje: 'CONECTADOS', data: nombresUnicos })
		clientes.forEach(c => {
			if (c && c.readyState === 1) {
				try { c.send(payload) } catch (e) { /* ignore send errors */ }
			}
		})
	} catch (e) { console.error('enviarConectados error', e) }
}

// Manejo de conexiones
wss.on('connection', (ws) => {
	console.log('Nuevo cliente conectado')

	// Añadimos el socket a la lista para poder limpiarlo cuando se cierre
	if (!clientes.includes(ws)) clientes.push(ws)

	ws.on('message', async (data) => {
		const txt = data.toString()
		let msg
		try { msg = JSON.parse(txt) } catch (e) {
			console.log('Mensaje no JSON recibido:', txt)
			return
		}

		const { mensaje, data: payload } = msg
		console.log('SERVER RECV ->', mensaje, payload, 'from', ws.nombre || '<anon>')

			// Handler específico para CHAT_GRUPO: persistir y distribuir a integrantes conectados
			if (mensaje === 'CHAT_GRUPO') {
				if (!payload) return
				let { grupo, mensaje: texto, emisor } = payload
				if (!grupo || !emisor) return
				try {
					const grupos = await storage.getGroups()
					const g = grupos.find(x => String(x.nombreGrupo).trim().toLowerCase() === String(grupo).trim().toLowerCase())
					if (!g) {
						try { ws.send(JSON.stringify({ mensaje: 'ERROR', data: 'Grupo no encontrado' })) } catch (e) {}
						return
					}
					const integrantes = Array.isArray(g.miembros) ? g.miembros.slice() : []
					const msgObj = { id: null, tipo: 'grupo', grupo: g.nombreGrupo, emisor, mensaje: texto, ts: Date.now(), broadcast: false, readBy: [] }
					// persistir
					const id = await storage.addMessage(msgObj)
					msgObj.id = id

					// Enviar a integrantes conectados (excluir emisor). Normalizar comparación por trim().toLowerCase().
					const integrantesNorm = integrantes.map(x => String(x).trim().toLowerCase())
					for (const c of clientes) {
						if (!c || c.readyState !== 1 || !c.nombre) continue
						const cname = String(c.nombre).trim().toLowerCase()
						if (cname === String(emisor).trim().toLowerCase()) continue
						if (integrantesNorm.includes(cname)) {
							try {
								c.send(JSON.stringify({ tipo: 'CHAT_GRUPO', grupo: g.nombreGrupo, emisor, mensaje: texto, ts: msgObj.ts, id: msgObj.id }))
							} catch (e) { }
						}
					}

								// enviar copia al emisor (incluir clientId si fue proporcionado por el emisor para evitar duplicados)
								try {
									const echo = { tipo: 'CHAT_GRUPO', grupo: g.nombreGrupo, emisor, mensaje: texto, ts: msgObj.ts, id: msgObj.id }
									if (payload && payload.clientId) echo.clientId = payload.clientId
									ws.send(JSON.stringify(echo))
								} catch (e) {}
				} catch (e) { console.error('CHAT_GRUPO error', e) }
				return
			}

		if (mensaje === 'CONECTADOS') {
			// Client asked for current connected users — respond from active sockets
			try {
				const activos = clientes.filter(c => c && c.readyState === 1 && c.nombre).map(c => c.nombre)
				const nombresUnicos = [...new Set(activos)]
				ws.send(JSON.stringify({ mensaje: 'CONECTADOS', data: nombresUnicos }))
			} catch (e) { console.error('Error respondiendo CONECTADOS', e) }
			return
		}

		if (mensaje === 'IDENTIFICACION') {
			let nombre = String(payload || '').trim()
			if (!nombre) return // no aceptamos nombres vacíos

			// Evitar duplicados: si ya existe, agregar sufijo numérico
			const existe = clientes.some(c => c !== ws && c.nombre === nombre)
			if (existe) {
				let i = 1
				let nuevo = `${nombre}-${i}`
				while (clientes.some(c => c.nombre === nuevo)) { i++; nuevo = `${nombre}-${i}` }
				nombre = nuevo
			}

		ws.nombre = nombre
		console.log(`Cliente identificado como: ${ws.nombre}`)

		// Persistir listado de clientes (compat) y usuario enriquecido
			await storage.addClient(ws.nombre).catch(e => console.error('storage:addClient', e))
			await storage.addUser(ws.nombre).catch(e => console.error('storage:addUser', e))
			await storage.updateOnline(ws.nombre, true).catch(e => console.error('storage:updateOnline', e))

		// Enviar lista actualizada a todos
		enviarConectados()

		// Enviar historial persistente, grupos y usuarios al cliente recién identificado
		try {
			const historial = await storage.getMessages()
			ws.send(JSON.stringify({ mensaje: 'HISTORIAL', data: historial }))
			ws.send(JSON.stringify({ mensaje: 'GRUPOS', data: await storage.getGroups(ws.nombre) }))
						const allUsers = await storage.getUsers()
						ws.send(JSON.stringify({ mensaje: 'USERS', data: allUsers }))
						// For backward compatibility, send CONTACTS as the list of users except the current one
						try {
							const contactsForClient = Array.isArray(allUsers) ? allUsers.filter(u => String(u.username).trim() !== String(ws.nombre).trim()) : []
							ws.send(JSON.stringify({ mensaje: 'CONTACTS', data: contactsForClient }))
						} catch (e) { console.error('send CONTACTS error', e) }
			// enviar mensajes pendientes
			try {
				const pending = await storage.getPending(ws.nombre)
				if (Array.isArray(pending) && pending.length > 0) {
					for (const m of pending) {
						try {
							ws.send(JSON.stringify({ mensaje: 'CHAT', data: m }))
							await storage.markDelivered(m.id, ws.nombre)
						} catch (e) {
							console.error('Error entregando pending message', e)
						}
					}
				}
			} catch (e) { console.error('storage:getPending', e) }
		} catch (e) { /* ignore send errors */ }
		}

		else if (mensaje === 'CHAT') {
			// payload esperado: { receptor: 'Todos' | 'Nombre' | ['Nombre1','Nombre2'] | 'GroupName', mensaje, emisor }
			if (!payload) return
			let { receptor, mensaje: texto, emisor } = payload
			const id_mensaje = mensajeId++

			// Normalize targets and detect broadcast or group
			const clientNames = clientes.map(c => c.nombre).filter(Boolean)
			// If receptor is string and matches a group name, resolve members
			let groupName = null
			// If receptor is an array with a single element that matches a group name,
			// treat it as a group message for backward compatibility.
			if (Array.isArray(receptor) && receptor.length === 1 && typeof receptor[0] === 'string') {
				const grupos = await storage.getGroups()
				const g = grupos.find(x => String(x.nombreGrupo).trim() === String(receptor[0]).trim())
				if (g) { groupName = String(g.nombreGrupo).trim(); receptor = g.miembros.slice() }
			}
			// If receptor is string and matches a group name, resolve members
			if (typeof receptor === 'string' && receptor !== 'Todos') {
				const grupos = await storage.getGroups()
				const g = grupos.find(x => String(x.nombreGrupo).trim() === String(receptor).trim())
				if (g) { groupName = String(g.nombreGrupo).trim(); receptor = g.miembros.slice() }
			}

			// Debug: log resolved targets for group messages
			if (groupName) {
				console.log(`CHAT: group message resolved to group='${groupName}', members=${JSON.stringify(receptor)}`)
			}
			const targets = Array.isArray(receptor) ? receptor : [receptor]
			// Considerar broadcast SOLO si receptor es 'Todos' o incluye explícitamente 'Todos'.
			// No asumir broadcast cuando el número de destinatarios coincide con clientes conectados.
			const isBroadcast = receptor === 'Todos' || (Array.isArray(receptor) && receptor.includes('Todos'))

			if (isBroadcast) {
				const msgObj = { id: id_mensaje, emisor, receptor: 'Todos', mensaje: texto, ts: Date.now(), broadcast: true, readBy: [] }
				mensajesStore.push(msgObj)
				await storage.addMessage(msgObj).catch(e => console.error('storage:addMessage', e))
				clientes.forEach(c => {
					if (!c || c.readyState !== 1 || !c.nombre) return
					try {
						const payloadToClient = Object.assign({}, msgObj)
						console.log(`SERVER SEND -> CHAT to ${c.nombre}:`, payloadToClient)
						c.send(JSON.stringify({ mensaje: 'CHAT', data: payloadToClient }))
					} catch (e) { }
				})
			} else {
				// If this was a group message, produce a structured group message and distribute to integrantes
				if (groupName) {
					const grupos = storage.getGroups()
					const g = grupos.find(x => String(x.nombreGrupo).trim() === String(groupName).trim())
					const integrantes = Array.isArray(g && g.miembros) ? g.miembros.slice() : (Array.isArray(receptor) ? receptor.slice() : [])

					const msgObj = { id: id_mensaje, tipo: 'grupo', grupo: groupName, emisor, mensaje: texto, ts: Date.now(), broadcast: false, readBy: [] }
					mensajesStore.push(msgObj)
					await storage.addMessage(msgObj).catch(e => console.error('storage:addMessage', e))

					// Enviar a cada integrante conectado, excepto el emisor
					clientes.forEach(c => {
						if (!c || c.readyState !== 1 || !c.nombre) return
						try {
							if (integrantes.some(r => String(r).trim() === String(c.nombre).trim())) {
								if (String(c.nombre).trim() === String(emisor).trim()) return // excluir emisor
								const payloadToClient = Object.assign({}, msgObj)
								console.log(`SERVER SEND -> GROUP CHAT to ${c.nombre}:`, payloadToClient)
								c.send(JSON.stringify({ mensaje: 'CHAT', data: payloadToClient }))
							}
						} catch (e) { }
					})

					// Enviar copia al emisor (confirmación)
					clientes.forEach(c => {
						if (!c || c.readyState !== 1 || !c.nombre) return
						if (String(c.nombre).trim() === String(emisor).trim()) {
							try {
								const payloadToClient = Object.assign({}, msgObj)
								console.log(`SERVER SEND -> GROUP CHAT (emisor copy) to ${c.nombre}:`, payloadToClient)
								c.send(JSON.stringify({ mensaje: 'CHAT', data: payloadToClient }))
							} catch (e) {}
						}
					})

				} else {
					// regular private message to specific targets
					let storedReceptor = Array.isArray(receptor) ? receptor.slice() : receptor
					const msgObj = { id: id_mensaje, emisor, receptor: storedReceptor, mensaje: texto, ts: Date.now(), broadcast: false, readBy: [] }
					mensajesStore.push(msgObj)
					await storage.addMessage(msgObj).catch(e => console.error('storage:addMessage', e))
					clientes.forEach(c => {
						if (!c || c.readyState !== 1 || !c.nombre) return
						// Si c es receptor objetivo -> enviar con receptor igual al receptor (para que el UI muestre en la conversación correspondiente)
						if (Array.isArray(receptor) && receptor.some(r => String(r).trim() === String(c.nombre).trim())) {
							try {
								const payloadToClient = { id_mensaje, emisor, receptor: c.nombre, mensaje: texto, broadcast: false, leido: false }
								console.log(`SERVER SEND -> CHAT to ${c.nombre}:`, payloadToClient)
								c.send(JSON.stringify({ mensaje: 'CHAT', data: payloadToClient }))
							} catch (e) {}
						}
						// Si c es emisor, enviarle copia con receptor igual al primer target (útil para UI)
						if (c.nombre === emisor) {
							const firstTarget = (Array.isArray(receptor) && receptor[0]) || ''
							try {
								const payloadToClient = { id_mensaje, emisor, receptor: firstTarget, mensaje: texto, broadcast: false, leido: false }
								console.log(`SERVER SEND -> CHAT to ${c.nombre} (emisor copy):`, payloadToClient)
								c.send(JSON.stringify({ mensaje: 'CHAT', data: payloadToClient }))
							} catch (e) {}
						}
					})
				}
			}
		}

		else if (mensaje === 'LEIDO') {
			// payload: { id_mensaje, emisor: originalEmisor, lector }
			if (!payload) return
			const { id_mensaje, emisor: originalEmisor, lector } = payload
			// Actualizar almacenamiento en memoria
			const msg = mensajesStore.find(x => x.id === id_mensaje)
			if (msg) {
				if (!Array.isArray(msg.readBy)) msg.readBy = []
				if (lector && !msg.readBy.includes(lector)) msg.readBy.push(lector)
			}
			// Persistir lectura
			await storage.markRead(id_mensaje, lector).catch(e => console.error('storage:markRead', e))
			// enviar evento de lectura al emisor original para que marque como leído
			clientes.forEach(c => {
				if (!c || c.readyState !== 1 || !c.nombre) return
				if (c.nombre === originalEmisor) {
					try { c.send(JSON.stringify({ mensaje: 'LEIDO', data: { id_mensaje, lector, readers: msg ? msg.readBy.slice() : [] } })) } catch (e) {}
				}
			})

		}

		else if (mensaje === 'CREAR_GRUPO') {
			// payload: { nombreGrupo, miembros: [] }
			if (!payload) return
			let { nombreGrupo, miembros } = payload
			miembros = Array.isArray(miembros) ? miembros.slice() : []
			// Asegurar que el creador (ws.nombre) esté en la lista de miembros
			if (ws && ws.nombre && !miembros.includes(ws.nombre)) miembros.push(ws.nombre)
			// Debug
			console.log('CREAR_GRUPO request from', ws.nombre, 'payload members:', miembros)
			// Persistir grupo y notificar a los clientes (esperar a que se guarde)
			try {
				await storage.addGroup({ nombreGrupo, miembros })
				try { ws.send(JSON.stringify({ mensaje: 'GRUPO_CREADO', data: { nombreGrupo, miembros } })) } catch (e) {}
				// Enviar lista de grupos actualizada a todos
				const grupos = await storage.getGroups()
				clientes.forEach(c => {
					if (!c || c.readyState !== 1) return
					try { c.send(JSON.stringify({ mensaje: 'GRUPOS', data: grupos })) } catch (e) { }
				})
			} catch (e) {
				console.error('storage:addGroup failed', e)
				try { ws.send(JSON.stringify({ mensaje: 'ERROR', data: 'No se pudo crear el grupo' })) } catch (err) {}
			}
		}
	})

	ws.on('close', () => {
		console.log('Cliente desconectado', ws.nombre || '')
			// Marcar desconexión en storage and update online status, then limpiar lista de sockets
			storage.updateOnline(ws.nombre, false).catch(e => console.error('storage:updateOnline', e))
			storage.removeUser(ws.nombre).catch(e => console.error('storage:removeUser', e))
			clientes = clientes.filter(c => c !== ws)
			// Notificar a todos la lista actualizada
			enviarConectados()
	})
})

// Nota: se mantiene la funcionalidad de "repórtate" solo si la necesitan.