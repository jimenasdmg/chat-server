import path from 'node:path'
import {createServer} from 'node:http'
import {fileURLToPath} from 'node:url'
import {createReadStream, existsSync, readFileSync} from 'node:fs'

import {Textos} from './librerías/Textos.js'
import {Usuarios} from './librerías/Usuarios.js'
import {Calculadora} from './librerías/Calculadora.js'

import "./server/db.js"

class server {
	constructor() {
		// La oferta de servicios
		this.modulos = new Map([['calculadora', new Calculadora()], ['textos', new Textos()],
			['usuarios', new Usuarios()]])

		createServer((req, res) => {
			res.setHeader('Access-Control-Allow-Origin', '*') // Conexión desde cualquier parte
			res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS') // Métodos permitidos
			res.setHeader('Access-Control-Allow-Headers', 'Content-Type') // Cabeceras permitidas

			if (req.method === 'OPTIONS') { // Respuesta al Preflight
				res.writeHead(204)
				res.end()
				return
			}

			// Ejecución dinámica del metodo de comunicación correspondiente
			if(this[req.method] && typeof this[req.method] === "function")
				this[req.method](req, res)
		})
		.listen(80, '0.0.0.0', () => { // Se aceptan conexiones desde cualquier parte
			console.log("Servidor web en marcha (server.js)")
		})
	}

	GET(requisicion, respuesta) {
		const meta = fileURLToPath(import.meta.url) // Archivo meta (el que se está ejecutando)
		const directorio = path.dirname(meta) // Recupero el directorio base
		const url = this.url(requisicion.url, directorio)

		if(url) {
			try {
				const ruta = path.join(directorio, url) // Ruta absoluta del recurso solicitado
				const flujo = createReadStream(ruta, 'UTF-8'),
				extension = this.extension(ruta).toLowerCase()

				respuesta.writeHead(200, {'Content-Type': this.contentType(extension)})
				if(this.esArchivoBinario(extension)) {
					if(existsSync(ruta))
						try { respuesta.end(readFileSync(ruta), 'binary') }
						catch(e){console.log(`Error leyendo el archivo: ${ruta}`)}
				}
				else flujo.pipe(respuesta) // Respuesta fragmentada al cliente (chunk)
			}
			catch(e) {
				respuesta.writeHead(404, {'Content-Type': this.contentType("txt")})
				respuesta.end("404 Error: Ruta de archivo invalida - " + url)
			}
		}
		else {
			respuesta.writeHead(404, {'Content-Type': this.contentType("txt")})
			respuesta.end("404 Error: Archivo no encontrado - " + url)
		}
	}

	async POST(req, res) {
		let data = ""

		req.on('data', chunk => data += chunk) // Armando el dato
		req.on('end', async () => {
			const requisicion = this.esJSON(data) // ¿Los datos recibidos son un JSON?
			/*
			Valido 4 cosas:
			1. Que se trate de un dato JSON
			2. Que la requisición incluya un campo llamado modulo
			3. Que la requisicion incluya un campo llamado servicio
			4. Que la requisicion incluya un campo llamado datos
			*/
			if(requisicion && requisicion.modulo && requisicion.servicio && requisicion.datos) {
				/*
				Valido 3 cosas:
				1. Que el módulo indicado exista
				2. Que el servicio indicado exista
				*/
				if(this.modulos.has(requisicion.modulo) && this.modulos.get(requisicion.modulo)[requisicion.servicio]) {
					const modulo = this.modulos.get(requisicion.modulo),
						firma = await modulo[requisicion.servicio]() // Obtengo la firma del método

					console.log('server: POST recibido ->', requisicion.modulo, requisicion.servicio, Object.keys(requisicion.datos || {}))

					if(this.datosOk(firma, requisicion.datos)) { // 3. Que los datos cumplan con la firma del método
						const resultado = await modulo[requisicion.servicio](requisicion.datos)

						res.writeHead(200, {'Content-Type': this.contentType("json")})
						if(typeof resultado === 'object' && resultado !== null)
							res.end(JSON.stringify(resultado))
						else
							res.end(JSON.stringify({ resultado }))
					}
					else {
						console.log('server: datosOk fallo. firma:', firma, 'datos:', requisicion.datos)
						res.writeHead(200, {'Content-Type': this.contentType("txt")})
						res.end("Datos inválidos")
					}
				}
				else {
					res.writeHead(200, {'Content-Type': this.contentType("txt")})
					res.end("Servicio desconocido")
				}
			}
			else {
				res.writeHead(200, {'Content-Type': this.contentType("txt")})
				res.end("Formato de datos incorrecto")
			}
		})
	}

	url(url, directorio) {
		const checkUrl = (url) => {
			const regex = new RegExp(`\\.(${['png', 'jpg', 'ico', 'svg', 'json', 'css', 'txt', 'html', 'js', 'crt', 'key', 'mp4', 'pdf'].join('|')})$|/$`)
			return regex.test(url)
		}
		/*
		Filtro de Seguridad y Extensiones (checkUrl):

		Usa una expresión regular para verificar que la URL termine en una de las extensiones permitidas
		(las mismas del método anterior) o en una barra diagonal (/). Si no cumple, el método retorna
		false inmediatamente, ignorando la solicitud.
		*/
		if(!checkUrl(url)) return false

		/*
		Manejo de Directorios (URLs terminadas en /):

		Si la URL apunta a una carpeta, el código intenta "adivinar" el archivo HTML principal de dos
		formas:

		Archivo Homónimo: Busca un archivo .html que se llame igual que la carpeta
		(ej. si pides /contacto/, busca /contacto/contacto.html).

		Archivo Index: Si el anterior no existe, busca el estándar /index.html.

		Verificación: Utiliza existsSync para confirmar que el archivo realmente está en el disco antes
		de devolver la ruta.
		*/
		else if(url.endsWith("/")) {
			const u = url.replace(/\/$/, "") // Elimino la diagonal al final de la URL
			const componentes = u.split("/") // divido la url por la barras
			const html = path.join(directorio, `${url}${componentes[componentes.length - 1]}.html`) // La última parte del array es objetivo
			const index = path.join(directorio, `${url}index.html`)

			if(existsSync(html)) return `${url}${componentes[componentes.length - 1]}.html`
			else if(existsSync(index)) return `${url}index.html`
			else return false
		}
		/*
		Si la URL no termina en / pero pasó el filtro de extensiones, simplemente verifico si el archivo
		existe en el directorio físico. Si existe, devuelve la url tal cual.
		*/
		else if(existsSync(path.join(directorio, url))) return url

		// Si no encuentra ninguna coincidencia válida en el sistema de archivos, retorna false
		else return false
	}

	extension(archivo) {
		return archivo.slice((archivo.lastIndexOf(".") - 1 >>> 0) + 2)
	}

	contentType(extension) {
		switch(extension) {
			case "png": return 'image/png'
			case "jpg": return 'image/jpeg'
			case "ico": return 'image/x-icon'
			case "svg": return 'image/svg+xml'
			case "json": return 'application/json'
			case "css": return 'text/css; charset=UTF-8'
			case "txt": return 'text/plain; charset=UTF-8'
			case "html": return 'text/html; charset=UTF-8'
			case "js": return 'text/javascript; charset=UTF-8'
			case 'crt': return 'application/x-x509-ca-cert'
			case 'key': return 'application/x-pem-file'
			case 'mp4': return 'video/mp4'
			case 'pdf': return 'application/pdf'
		}
		return 'text/plain'
	}

	esJSON(texto) {
		try { return JSON.parse(texto) }
		catch (e) { return false }
	}

	esArchivoBinario(extension) {
		return ["png", "jpg", "ico", "crt", "key", "mp4", "pdf"].indexOf(extension) >= 0
	}

	datosOk(firma, datos) {
		// 1. Obtengo las claves del objeto firma
		const keysFirma = Object.keys(firma)

		// 2. Valido que cada atributo exista y que el tipo coincida con el valor de la firma
		return keysFirma.every(key => {
			const tipoRequerido = firma[key] // Ej: "string" o "number"
			const valorEvaluar = datos[key]

			return typeof valorEvaluar === tipoRequerido
		});
	}
}
new server()