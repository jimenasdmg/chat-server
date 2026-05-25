import WebSocket, { WebSocketServer } from 'ws'

class wsCliente {
	constructor(cliente) {
		// Modo: si se pasa --no-central o --solo-ui, no intentamos conectar al servidor central
		this.noCentral = process.argv.includes('--no-central') || process.argv.includes('--solo-ui')
		this.serverUrl = 'ws://localhost:8083'
		this.reconnectDelay = 5000
		this.reconnectTimer = null
		if (!this.noCentral) this.connectToCentral(this.serverUrl)
		else console.log('wsCliente: ejecutando en modo solo-UI (no intenta conectar al servidor central)')

		// Exponer un servidor WebSocket local para que la UI se conecte
		this.uiClients = new Set()
		this.wss = new WebSocketServer({ port: 8081 })
		console.log('wsCliente: WebSocket local para UI iniciado en ws://localhost:8081')

		this.wss.on('connection', (uiWs) => {
			console.log('UI conectada al cliente Node')
			this.uiClients.add(uiWs)

			uiWs.on('message', (data) => {
				if (this.ws && this.ws.readyState === WebSocket.OPEN) {
					try { this.ws.send(data) } catch (e) { /* ignore */ }
				}
				try {
					const txt = data.toString()
					const msg = this.jsonAJS(txt)
					if (msg && msg.mensaje && typeof this[msg.mensaje] === 'function') this[msg.mensaje](msg.data)
				} catch (e) { }
			})

			uiWs.on('close', () => {
				this.uiClients.delete(uiWs)
				console.log('UI desconectada del cliente Node')
			})
		})

		this.ws && (this.ws.data = cliente)
		// mensaje desde servidor central
		this._onServerMessage = (data) => {
			const datos = this.jsonAJS(data.toString())
			for (const ui of this.uiClients) {
				if (ui && ui.readyState === WebSocket.OPEN) {
					try { ui.send(data.toString()) } catch (e) { }
				}
			}

			if(datos) {
				const {mensaje, data} = datos
				if(this[mensaje] && typeof this[mensaje] == "function")
					this[mensaje](data)
			}
		}
		if (this.ws) this.ws.on('message', this._onServerMessage)

		// Si la instancia se crea más tarde, handlers se adjuntarán en connectToCentral
	}

	// Enviar un payload JSON a todos los clientes UI conectados
	_broadcastToUI(payload) {
		const txt = typeof payload === 'string' ? payload : JSON.stringify(payload)
		for (const ui of this.uiClients) {
			if (!ui || ui.readyState !== WebSocket.OPEN) continue
			try { ui.send(txt) } catch (e) { /* ignore */ }
		}
	}

	// Manejador local para creación de grupos (aceptar CREAR_GRUPO desde la UI)
	CREAR_GRUPO(data) {
		// data: { nombreGrupo, miembros }
		const payload = { mensaje: 'GRUPO_CREADO', data }
		// Reenviamos a todas las UIs conectadas
		this._broadcastToUI(payload)
		// Si hay conexión al servidor central, también intentamos reenviarlo
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			try { this.ws.send(JSON.stringify({ mensaje: 'CREAR_GRUPO', data })) } catch (e) { }
		}
	}

	//
	// Gestores de mensajes
	//

	IDENTIFICATE() {
		this.MSG("IDENTIFICACION", this.ws && this.ws.data ? this.ws.data : null)
		this.MSG("CONECTADOS") 
	}

	CONECTADOS(data) {
		if(data) {
			console.log("*** CLIENTES CONECTADOS ***")
			for (const cliente of data)
				console.log(cliente)
		}	
	}

	//
	// Métodos auxiliares
	//

	MSG(mensaje, data = {}) {
		// Solo voy a enviar data, si hay data
		const msg = data != {} && data != undefined && data != null ?
			this.JSAJson({mensaje, data}) : this.JSAJson({mensaje})

		if (!msg) return
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			try { this.ws.send(msg) } catch (e) { console.error('wsCliente: error enviando mensaje:', e && e.message ? e.message : e) }
		} else {
			console.warn('wsCliente: no hay conexión abierta al servidor central, mensaje no enviado')
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

	// Crea la conexión al servidor central y añade handlers de error/close
	connectToCentral(url) {
		try {
			this.ws = new WebSocket(url)
		} catch (e) {
			console.error('wsCliente: fallo al crear WebSocket:', e && e.message ? e.message : e)
			this.scheduleReconnect()
			return
		}

		this.ws.on('open', () => {
			console.log('wsCliente: conectado al servidor central')
			if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
			// asignar data si ya existe
			if (this.ws && !this.ws.data) this.ws.data = this.ws.data || null
			// adjuntar handler de mensajes si existe
			if (this._onServerMessage) this.ws.on('message', this._onServerMessage)
		})

		this.ws.on('error', (err) => {
			console.error('wsCliente: error al conectar/usar servidor central:', err && err.message ? err.message : err)
			// no lanzar, dejamos que 'close' gestione reconexión
		})

		this.ws.on('close', (code, reason) => {
			console.log('wsCliente: conexión con servidor central cerrada', code, reason && reason.toString ? reason.toString() : reason)
			this.ws = null
			this.scheduleReconnect()
		})
	}

	scheduleReconnect() {
		if (this.noCentral) return
		if (this.reconnectTimer) return
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			console.log('wsCliente: intentando reconectar al servidor central...')
			this.connectToCentral(this.serverUrl)
		}, this.reconnectDelay)
	}
}

// Obtener el nombre de cliente como el primer argumento que no sea una bandera
const argv = process.argv
const cliente = argv.find((a, idx) => idx > 1 && !a.startsWith('--')) || null
new wsCliente(cliente)