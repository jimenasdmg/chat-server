// Importa la clase WebSocket para iniciar una conexión como cliente
import WebSocket from 'ws'

/**
 * INICIALIZACIÓN: Se intenta abrir una conexión con el servidor.
 * El objeto 'ws' se convierte en un Emisor de Eventos (EventEmitter).
 */
const ws = new WebSocket('ws://localhost:8083')

// EVENTO 'open': Se dispara una única vez cuando el "handshake" (saludo)
// con el servidor es exitoso y el túnel de comunicación queda abierto.
ws.on('open', () => {
	console.log("Conectado al servidor")
	// Una vez abierto el canal, enviamos el primer mensaje de datos
	ws.send("¡Hola desde el cliente ESM!")
})

/**
 * GESTIÓN DE EVENTOS DE ENTRADA:
 * El cliente no sabe cuándo enviará algo el servidor, por lo que deja
 * este "oyente" (listener) preparado en el Event Loop de Node.js.
 */
ws.on('message', (data) => {
	// Convertimos los datos (Buffer) a un formato de texto legible
	const mensaje = data.toString()
	console.log(`Servidor dice: ${mensaje}`)

	// Lógica de respuesta automática: Reaccionamos a un evento específico ("repórtate")
	if (mensaje === "repórtate") {
		const reporte = `Reporte enviado a las ${new Date().toLocaleTimeString()}`
		
		// Emitimos un mensaje de vuelta al servidor como respuesta al comando
		ws.send(reporte)
		console.log("Respuesta de reporte enviada.")
	}
})

/**
 * NOTA SOBRE ASINCRONÍA:
 * El código no se detiene a esperar mensajes; sigue vivo gracias a los
 * listeners (ws.on). Si el servidor se apaga, este cliente podría 
 * cerrarse silenciosamente a menos que agreguemos un evento 'close'.
 */