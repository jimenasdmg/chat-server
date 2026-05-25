import WebSocket from 'ws'

const url = 'ws://localhost:8083'
const ws = new WebSocket(url)

ws.on('open', () => {
  console.log('test_client: conectado')
  // Identificarse
  ws.send(JSON.stringify({ mensaje: 'IDENTIFICACION', data: 'PruebaCliente' }))

  // Enviar un mensaje broadcast
  setTimeout(() => {
    ws.send(JSON.stringify({ mensaje: 'CHAT', data: { receptor: 'Todos', mensaje: 'Hola desde test_client', emisor: 'PruebaCliente' } }))
    console.log('test_client: enviado CHAT broadcast')
  }, 200)

  // Crear un grupo
  setTimeout(() => {
    ws.send(JSON.stringify({ mensaje: 'CREAR_GRUPO', data: { nombreGrupo: 'GrupoPrueba', miembros: ['PruebaCliente'] } }))
    console.log('test_client: enviado CREAR_GRUPO')
  }, 400)

  // Enviar lectura (LEIDO) sobre id 1 (si existe)
  setTimeout(() => {
    ws.send(JSON.stringify({ mensaje: 'LEIDO', data: { id_mensaje: 1, emisor: 'PruebaCliente', lector: 'PruebaCliente' } }))
    console.log('test_client: enviado LEIDO')
    ws.close()
  }, 800)
})

ws.on('message', (data) => {
  console.log('test_client: recibido ->', data.toString())
})

ws.on('close', () => console.log('test_client: cerrado'))

ws.on('error', (err) => console.error('test_client: error', err.message))
