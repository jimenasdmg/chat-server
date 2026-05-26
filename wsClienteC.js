import WebSocket from 'ws'

export class wsCliente {
	constructor(url = 'wss://chat-server-production-1abc.up.railway.app', nombre = 'Jimena Del Moral García', curp = 'MOGJ040804MVZRRMA8') {
		this.url = url
		this.nombre = nombre
		this.curp = curp
		this.ws = null
	}

	connect() {
		this.ws = new WebSocket(this.url)

		this.ws.on('open', () => {
			console.log('Conectado al servidor')
			this.ws.send('¡Hola desde el cliente ESM!')
		})

		this.ws.on('message', (data) => {
			const mensaje = data.toString()
			console.log(`Servidor dice: ${mensaje}`)
			if (mensaje === 'repórtate') {
				const reporte = `Reporte enviado a las ${new Date().toLocaleTimeString()}`
				this.ws.send(reporte)
				console.log('Respuesta de reporte enviada.')
			}

			if (mensaje.toLowerCase() === 'quien eres?' || mensaje.toLowerCase() === 'quien eres') {
				const respuesta = `Nombre: ${this.nombre}, CURP: ${this.curp}`
				this.ws.send(respuesta)
				console.log('Respuesta de identidad enviada.')
			}
		})

		this.ws.on('close', () => {
			console.log('Conexión cerrada.')
		})

		this.ws.on('error', (err) => {
			console.error('Error en WebSocket:', err)
		})
	}

	send(mensaje) {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(mensaje)
		} else {
			console.error('No hay conexión abierta para enviar el mensaje.')
		}
	}

	close() {
		if (this.ws) this.ws.close()
	}
}

// Cambia 'Tu Nombre' y 'TU_CURP' por tus datos reales si quieres que se envíen.
const cliente = new wsCliente('wss://chat-server-production-1abc.up.railway.app', 'Jimena Del Moral García', 'MOGJ040804MVZRRMA8')
cliente.connect()