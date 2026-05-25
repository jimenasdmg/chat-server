import WebSocket from 'ws'

class wsCliente {
	constructor(emisor, receptor) {
		this.ws = new WebSocket('ws://localhost:8083')
		this.conectados = [] // Se actualiza en el mensaje CONECTADOS
		this.ws.data = emisor // Línea de comandos
		this.receptor = receptor // Línea de comandos

		this.ws.on('open', () => { console.log("Conectado al servidor") })

		this.ws.on('message', (data) => {
			const datos = this.jsonAJS(data.toString())

			if(datos) {
				const {mensaje, data} = datos

				// Ejecución dinámica del método correspondiente al mensaje
				if(this[mensaje] && typeof this[mensaje] == "function")
					this[mensaje](data)
			}
		})

		setInterval(() => {
			// const fh = this.fechaYHora()
			this.CHAT_FECHA()
		}, 15000)
	}

	//
	// Mensajes entrantes
	//

	IDENTIFICATE() {
		this.ws.send(this.MSG("IDENTIFICACION", this.ws.data))
		this.ws.send(this.MSG("CONECTADOS"))
	}

	CONECTADOS(data) {
		if(data) {
			this.conectados = data
			console.log("*** CLIENTES CONECTADOS ***")
			console.log(this.conectados)
		}
	}

	CHAT(data) {
		if(data) {
			const {emisor, mensaje} = data
			console.log(`${emisor} dice: ${mensaje}`)
		}
	}

	//
	// Mensajes salientes
	//

	CHAT_FECHA() {
		// Para homogenizar la forma de tratar a los destinatarios, siempre los
		// manejaré como un array de destinatarios.
		const receptor = this.receptor == "Todos" ? this.conectados : [this.receptor],

		// El mensaje a enviar será la fecha y la hora actual
		mensaje = this.fechaYHora()

		this.MSG("CHAT", {receptor, mensaje})
	}

	//
	// Métodos auxiliares
	//

	MSG(mensaje, data = {}) {
		// Solo voy a enviar data, si hay data
		const msg = data != {} && data != undefined && data != null ?
			this.JSAJson({mensaje, data}) : this.JSAJson({mensaje})

		if(msg){
			//console.log("Enviando: ", msg)   // Se puede descomentar para ver el mensaje que se envía al servidor
			this.ws.send(msg)
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

	fechaYHora() {
		const ahora = new Date();

		const anio = ahora.getFullYear();
		const mes = String(ahora.getMonth() + 1).padStart(2, '0');
		const dia = String(ahora.getDate()).padStart(2, '0');
		const horas = String(ahora.getHours()).padStart(2, '0');
		const minutos = String(ahora.getMinutes()).padStart(2, '0');
		const segundos = String(ahora.getSeconds()).padStart(2, '0');

		return `${anio}-${mes}-${dia}/${horas}:${minutos}:${segundos}`;
	}
}

const argumentos = process.argv
const emisor = argumentos[2] // El índice 0 es la ruta de Node, el 1 es el archivo
const receptor = argumentos[3] // El índice 3 indica el receptor de los mensajes
new wsCliente(emisor, receptor)