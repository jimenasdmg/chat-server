import "./server/db.js";
import storage from './server/storage.js'
import { WebSocketServer } from 'ws'
import { writeFile, readFile, access } from 'node:fs/promises'
import path from 'node:path'

const DB_FILE = path.join(process.cwd(), 'server_data.json')

await storage.init()

class wsServer {
	constructor() {
		const PORT = Number(process.env.PORT || 8083)
		this.wss = new WebSocketServer({ port: PORT })
		console.log(`Servidor WebSocket iniciado en ws://0.0.0.0:${PORT}`)

		// Un cliente se conecta
		this.wss.on('connection', (ws) => {
			this.MSG(ws, "IDENTIFICATE") // Solicito identificación

			ws.on('message', (datos) => {
				datos = this.jsonAJS(datos) // Conversión segura
				if(datos) {
					const {mensaje, data} = datos

					// Ejecuto dinámicamente al método gestor del mensaje
					if(this[mensaje] && typeof this[mensaje] == "function")
						this[mensaje](ws, data) // Los gestores de mensajes deben llevar la misma firma
				}
			})

			// Un cliente se desconecta
			ws.on('close', () => {
				console.log(`${ws.data} desconectado`)
				// Persistir la desconexión
				storage.removeClient(ws.data).catch(e => console.error('storage:removeClient', e))
				storage.removeUser(ws.data).catch(e => console.error('storage:removeUser', e))
				// Informo a los otros clientes
					this.CONECTADOS()
			})

			// Siempre que se conecte un nuevo cliente, informo a los otros
				// De momento no enviamos la lista hasta que el cliente se IDENTIFIQUE
		})
	}

	//
	// Gestores de mensajes
	// NOTA: Todos los métodos gestores de mensajes llevan la misma firma
	//

	async IDENTIFICACION(ws, data) {
		ws.data = data
		console.log(`${ws.data} conectado...`)

		await storage.addClient(ws.data).catch(e => console.error('storage:addClient', e))
		await storage.addUser(ws.data).catch(e => console.error('storage:addUser', e))
		try {
			const historial = await storage.getMessages()
			ws.send(JSON.stringify({ mensaje: 'HISTORIAL', data: historial }))
			ws.send(JSON.stringify({ mensaje: 'GRUPOS', data: await storage.getGroups(ws.data) }))
			ws.send(JSON.stringify({ mensaje: 'USERS', data: await storage.getUsers() }))
			ws.send(JSON.stringify({ mensaje: 'CONTACTS', data: await storage.getContacts(ws.data) }))
		} catch (e) { }

        try {
            const pending = await storage.getPending(ws.data)
            if (Array.isArray(pending) && pending.length > 0) {
                this.MSG(ws, 'PENDING', { count: pending.length, messages: pending })
            }
        } catch (e) { console.error('storage:getPending', e) }
		try { this.CONECTADOS() } catch (e) { console.error('Error broadcasting CONECTADOS after IDENTIFICACION', e) }
	}

	CONECTADOS(ws, data) {
		// Enviar la lista de usuarios conectados según sockets activos (no storage)
		try {
			const activos = Array.from(this.wss.clients).filter(c => c && c.data).map(c => c.data)
			const únicos = [...new Set(activos)]
			// Broadcast a todos los clientes activos
			for (const cliente of this.wss.clients) {
				if (!cliente || cliente.readyState !== 1) continue
				try { this.MSG(cliente, 'CONECTADOS', únicos) } catch (e) { /* ignore per-client errors */ }
			}
		} catch (e) { console.error('CONECTADOS error', e) }
	}

	async CHAT(ws, data) {
		if(data) {
			const emisor = ws.data,
			{receptor, mensaje, clientId} = data || {}

			// Detectar si el receptor corresponde a un grupo
			let groupName = null
			try {
				const grupos = await storage.getGroups()
				if (Array.isArray(receptor) && receptor.length === 1 && typeof receptor[0] === 'string') {
					const g = grupos.find(x => String(x.nombreGrupo).trim() === String(receptor[0]).trim())
					if (g) { groupName = String(g.nombreGrupo).trim(); receptor = g.miembros.slice() }
				}
				if (typeof receptor === 'string' && receptor !== 'Todos') {
					const g = grupos.find(x => String(x.nombreGrupo).trim() === String(receptor).trim())
					if (g) { groupName = String(g.nombreGrupo).trim(); receptor = g.miembros.slice() }
				}
			} catch (e) { /* ignore group resolution errors */ }

			const clientNames = Array.from(this.wss.clients).map(c => c.data).filter(Boolean)
			const isBroadcast = receptor === 'Todos' || (Array.isArray(receptor) && receptor.includes('Todos')) || (Array.isArray(receptor) && receptor.length === clientNames.length)

			if (isBroadcast) {
				const msgObj = { emisor, receptor: 'Todos', mensaje, ts: Date.now(), broadcast: true, readBy: [] }
				if (clientId) msgObj.clientId = clientId
				try {
					const id = await storage.addMessage(msgObj)
					msgObj.id = id
				} catch (e) { console.error('storage:addMessage', e) }
				// ack to sender: sent (include clientId if provided)
				this.MSG(ws, 'SENT', Object.assign({ id_mensaje: msgObj.id, ts: msgObj.ts }, clientId ? { clientId } : {}))
				// notify all clients
				const delivered = []
				for (const cliente of this.wss.clients) {
					if(!cliente || !cliente.data) continue
					this.MSG(cliente, 'CHAT', Object.assign({}, msgObj))
					if (cliente.data) delivered.push(cliente.data)
				}
				// inform sender about delivered list
				this.MSG(ws, 'DELIVERED', Object.assign({ id_mensaje: msgObj.id, deliveredTo: delivered }, clientId ? { clientId } : {}))
			} else {
				const targets = Array.isArray(receptor) ? receptor : [receptor]
				// Si era un mensaje a grupo, crear estructura de mensaje de grupo
				if (groupName) {
					const grupos = await storage.getGroups()
					const g = grupos.find(x => String(x.nombreGrupo).trim() === String(groupName).trim())
					const integrantes = Array.isArray(g && g.miembros) ? g.miembros.slice() : (Array.isArray(receptor) ? receptor.slice() : [])
					const msgObj = { emisor, tipo: 'grupo', grupo: groupName, mensaje, ts: Date.now(), broadcast: false, readBy: [] }
					if (clientId) msgObj.clientId = clientId
					try {
						const id = await storage.addMessage(msgObj)
						msgObj.id = id
					} catch (e) { console.error('storage:addMessage', e) }
					// ack to sender
					this.MSG(ws, 'SENT', Object.assign({ id_mensaje: msgObj.id, ts: msgObj.ts }, clientId ? { clientId } : {}))
					// send to integrantes connected except emisor
					for (const cliente of this.wss.clients) {
						if(!cliente || !cliente.data) continue
						if (String(cliente.data).trim() !== String(emisor).trim() && integrantes.includes(cliente.data)) {
							this.MSG(cliente, 'CHAT', Object.assign({}, msgObj))
						}
						// ensure sender gets a copy
						if (cliente.data === emisor) this.MSG(cliente, 'CHAT', Object.assign({}, msgObj))
					}
					return
				} else {
					const storedReceptor = Array.isArray(receptor) ? receptor.slice() : receptor
					const msgObj = { emisor, receptor: storedReceptor, mensaje, ts: Date.now(), broadcast: false, readBy: [] }
					if (clientId) msgObj.clientId = clientId
					try {
						const id = await storage.addMessage(msgObj)
						msgObj.id = id
					} catch (e) { console.error('storage:addMessage', e) }
					// ack to sender
					this.MSG(ws, 'SENT', Object.assign({ id_mensaje: msgObj.id, ts: msgObj.ts }, clientId ? { clientId } : {}))
					for (const cliente of this.wss.clients) {
						if(!cliente || !cliente.data) continue
						if (targets.includes(cliente.data)) {
							this.MSG(cliente, 'CHAT', Object.assign({}, msgObj, { receptor: cliente.data }))
						}
						if (cliente.data === emisor) this.MSG(cliente, 'CHAT', Object.assign({}, msgObj))
					}
					return
				}

			}
		}
	}

	// Nuevo handler para mensajes grupales explícitos
	async CHAT_GRUPO(ws, data) {
		if (!data) return
		const grupo = data.grupo || data.nombreGrupo || data.group
		const mensaje = data.mensaje || data.texto || data.message
		const emisor = ws.data
		if (!grupo || !mensaje) return
			try {
				const grupos = await storage.getGroups()
			const g = grupos.find(x => String(x.nombreGrupo).trim().toLowerCase() === String(grupo).trim().toLowerCase())
			if (!g) {
				this.MSG(ws, 'ERROR', 'Grupo no encontrado')
				return
			}
			const integrantes = Array.isArray(g.miembros) ? g.miembros.slice() : []
			const msgObj = { emisor, tipo: 'grupo', grupo: g.nombreGrupo, mensaje, ts: Date.now(), broadcast: false, readBy: [] }
			const id = await storage.addMessage(msgObj)
			msgObj.id = id

			const integrantesNorm = integrantes.map(x => String(x).trim().toLowerCase())
			for (const cliente of this.wss.clients) {
				if (!cliente || !cliente.data) continue
				const cname = String(cliente.data).trim().toLowerCase()
				if (cname === String(emisor).trim().toLowerCase()) continue
				if (integrantesNorm.includes(cname)) {
					this.MSG(cliente, 'CHAT', Object.assign({}, msgObj))
				}
			}
			// copia al emisor (incluir clientId si lo recibimos para evitar duplicados locales)
			const echo = Object.assign({}, msgObj)
			if (data && data.clientId) echo.clientId = data.clientId
			this.MSG(ws, 'CHAT', echo)
		} catch (e) { console.error('CHAT_GRUPO error', e) }
	}

	async CREAR_GRUPO(ws, data) {
		if (!data) return
		const nombreGrupo = data.nombreGrupo || data.nombre || ''
		let miembros = Array.isArray(data.miembros) ? data.miembros.slice() : []
		// Ensure the creator is included
		if (ws && ws.data && !miembros.includes(ws.data)) miembros.push(ws.data)
		await storage.addGroup({ nombreGrupo, miembros })
		// Notify requester
		this.MSG(ws, 'GRUPO_CREADO', { nombreGrupo, miembros })
		// Broadcast updated groups to all connected clients
		const grupos = await storage.getGroups()
		for (const cliente of this.wss.clients) {
			if (!cliente || !cliente.data) continue
			this.MSG(cliente, 'GRUPOS', grupos)
		}
	}

	//
	// Métodos auxiliares
	//

	socketId(id) {
		// Recorro la lista de clientes para localizar al receptor
		for (const cliente of this.wss.clients)
			if(cliente.data == id) return cliente
		return false
	}

	// Envía un mensaje al socket indicado
	MSG(ws, mensaje, data) {
		// Solo voy a enviar data, si hay data
		const msg = data != {} && data != undefined && data != null ?
			this.JSAJson({mensaje, data}) : this.JSAJson({mensaje})
		
		if(msg) {
			ws.send(msg)
			// console.log(`Mensaje enviado: ${msg}`)
		}
	}

	// Conversión a Javascript segura
	jsonAJS(json) {
		try { return JSON.parse(json) }
		catch { return false }
	}

	// Conversión a JSON segura
	JSAJson(js) {
		try { return JSON.stringify(js) }
		catch { return false }
	}

	async LEIDO(ws, data) {
		if(!data) return
		const { id_mensaje, emisor: originalEmisor, lector } = data
		try {
			const readers = await storage.markRead(id_mensaje, lector)
			// Notificar al emisor original con la lista actualizada de lectores
			for (const cliente of this.wss.clients) {
				if(!cliente || !cliente.data) continue
				if (cliente.data === originalEmisor) this.MSG(cliente, 'LEIDO', { id_mensaje, readers })
			}
		} catch (e) { console.error('storage:markRead', e) }
	}
}
new wsServer()