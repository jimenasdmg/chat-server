const DB_NAME = 'Chat'
const STORE_VERSION = 4
const GROUP_STORE = 'grupos'
const MESSAGE_STORE = 'mensajes'
const CONTACT_STORE = 'contactos'

class chatDB {
	constructor() {
		// Guardaremos la conexión aquí para usarla en todos los métodos
		this.db = null
	}

	/**
	 * INIT: Configura y abre la conexión.
	 * Es fundamental porque IndexedDB es una base de datos asíncrona.
	 */
	async init() {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, STORE_VERSION)

			request.onupgradeneeded = (e) => {
				const db = e.target.result
				// On version change, remove old stores to ensure clean schema migration
				try { if (db.objectStoreNames.contains(CONTACT_STORE)) db.deleteObjectStore(CONTACT_STORE) } catch (er) {}
				try { if (db.objectStoreNames.contains(GROUP_STORE)) db.deleteObjectStore(GROUP_STORE) } catch (er) {}
				try { if (db.objectStoreNames.contains(MESSAGE_STORE)) db.deleteObjectStore(MESSAGE_STORE) } catch (er) {}

				// create independent stores
				if (!db.objectStoreNames.contains(MESSAGE_STORE)) db.createObjectStore(MESSAGE_STORE, { keyPath: 'id', autoIncrement: false })
				if (!db.objectStoreNames.contains(CONTACT_STORE)) db.createObjectStore(CONTACT_STORE, { keyPath: 'id', autoIncrement: false })
				if (!db.objectStoreNames.contains(GROUP_STORE)) db.createObjectStore(GROUP_STORE, { keyPath: 'id', autoIncrement: false })
			}

			request.onsuccess = (e) => {
				this.db = e.target.result
				// Limpieza de flags de presencia antiguos en contactos (migration)
				try {
					const tx = this.db.transaction(CONTACT_STORE, 'readwrite')
					const store = tx.objectStore(CONTACT_STORE)
					const getAllReq = store.getAll()
					getAllReq.onsuccess = () => {
						const all = getAllReq.result || []
						for (const c of all) {
							if (c && ('online' in c || 'socketId' in c)) {
								const cleaned = Object.assign({}, c)
								if ('online' in cleaned) delete cleaned.online
								if ('socketId' in cleaned) delete cleaned.socketId
								store.put(cleaned)
							}
						}
					}
				} catch (e) { /* ignore migration errors */ }
				resolve()
			}

			request.onerror = (e) => {
				reject(`Error crítico: ${e.target.error.message}`)
			}
		})
	}

	/**
	 * CREATE: Guarda un nuevo objeto.
	 */
	async add(id, integrantes) {
		try {
			// Creamos una transacción de 'readwrite' (lectura y escritura).
			const tx = this.db.transaction(GROUP_STORE, 'readwrite')
			const store = tx.objectStore(GROUP_STORE)
			
			return new Promise((resolve, reject) => {
				// .add() inserta el objeto. El ID se genera automáticamente.
				const request = store.put({ id, integrantes })
				request.onsuccess = () => resolve(request.result)
				request.onerror = () => reject("No se pudo añadir/actualizar el grupo")
			})
		} catch (err) {
			console.error("Error en add:", err)
		}
	}

	/**
	 * Añade o actualiza un mensaje en la store `mensajes`.
	 * El objeto `msg` debe contener una propiedad `id` (number o string) o `localId`.
	 */
	async addMessage(msg) {
		try {
			const tx = this.db.transaction([MESSAGE_STORE, CONTACT_STORE], 'readwrite')
			const store = tx.objectStore(MESSAGE_STORE)
			// If server echo includes both localId and final id, migrate existing local record instead of inserting duplicate
			if (msg && msg.localId && msg.id) {
				return new Promise((resolve, reject) => {
					const getReq = store.get(msg.localId)
					getReq.onsuccess = () => {
						const existing = getReq.result || null
						if (existing) {
							const merged = Object.assign({}, existing, msg)
							merged.id = msg.id
							const putReq = store.put(merged)
							putReq.onsuccess = () => {
								const delReq = store.delete(msg.localId)
								delReq.onsuccess = () => resolve(merged.id)
								delReq.onerror = () => resolve(merged.id)
							}
							putReq.onerror = () => reject('Error migrando mensaje local a id servidor')
						} else {
							// no existing local message, just insert with server id
							const request = store.put(Object.assign({}, msg, { id: msg.id }))
							request.onsuccess = () => resolve(request.result)
							request.onerror = () => reject('No se pudo añadir/actualizar mensaje')
						}
					}
					getReq.onerror = () => {
						const request = store.put(Object.assign({}, msg, { id: msg.id }))
						request.onsuccess = () => resolve(request.result)
						request.onerror = () => reject('No se pudo añadir/actualizar mensaje')
					}
				})
			}
			const key = msg.id || msg.localId
			// Normalize contacts references: emisor -> emisorId, receptor -> receptorIds
			const toSaveRaw = Object.assign({}, msg)
			const toSave = Object.assign({}, toSaveRaw, { id: key })
			// Normalize message type and structure: 'privado' | 'grupo' | 'broadcast'
			let tipo = (toSaveRaw.tipo || '').toString().trim().toLowerCase()
			if (!tipo) {
				if (toSaveRaw.grupo) tipo = 'grupo'
				else if (toSaveRaw.receptor === 'Todos' || (Array.isArray(toSaveRaw.receptor) && toSaveRaw.receptor.includes('Todos'))) tipo = 'broadcast'
				else if (Array.isArray(toSaveRaw.receptor)) {
					if (toSaveRaw.receptor.length === 1) {
						tipo = 'privado'
						toSave.receptor = toSaveRaw.receptor[0]
					} else {
						// fallback: treat as privado to first recipient
						tipo = 'privado'
						toSave.receptor = toSaveRaw.receptor[0]
					}
				} else if (typeof toSaveRaw.receptor === 'string') {
					tipo = toSaveRaw.receptor === 'Todos' ? 'broadcast' : 'privado'
				}
			}
			if (!toSave.tipo) toSave.tipo = tipo || 'privado'
			// If group message, ensure `grupo` is set and remove receptor fields
			if (toSave.tipo === 'grupo') {
				if (!toSave.grupo && Array.isArray(toSaveRaw.receptor) && toSaveRaw.receptor.length === 1) toSave.grupo = toSaveRaw.receptor[0]
				if (!toSave.grupo && typeof toSaveRaw.receptor === 'string') toSave.grupo = toSaveRaw.receptor
				if (toSave.grupo) toSave.grupo = toSave.grupo.toString()
				// remove receptor/receptorIds for group messages
				if ('receptor' in toSave) delete toSave.receptor
				if ('receptorIds' in toSave) delete toSave.receptorIds
			}
			try {
				// emisor can be an object { id, nombre } or a string
				if (toSave.emisor && typeof toSave.emisor === 'object' && toSave.emisor.id) {
					const contactStore = tx.objectStore(CONTACT_STORE)
					const existingReq = contactStore.get(toSave.emisor.id)
					existingReq.onsuccess = () => {
						const existing = existingReq.result || {}
						const merged = Object.assign({}, existing, { id: toSave.emisor.id, nombre: toSave.emisor.nombre || toSave.emisor.name || existing.nombre || toSave.emisor.id }, { lastSeen: existing.lastSeen || Date.now() })
						contactStore.put(merged)
					}
					toSave.emisorId = toSave.emisor.id
					toSave.emisor = toSave.emisor.nombre || toSave.emisor.name || toSave.emisor.id
				} else if (toSave.emisor && typeof toSave.emisor === 'string') {
					// attempt to resolve by name
					const contactStore = tx.objectStore(CONTACT_STORE)
					const idxReq = contactStore.get(toSave.emisor)
					idxReq.onsuccess = () => {
						const existing = idxReq.result
						if (existing) toSave.emisorId = existing.id
					}
				}

				// receptor normalization: only for privado messages we keep receptor fields
				if (toSave.tipo === 'privado' && toSave.receptor) {
					if (Array.isArray(toSave.receptor)) {
						toSave.receptorIds = []
						for (const r of toSave.receptor) {
							if (r && typeof r === 'object' && r.id) {
								const contactStore = tx.objectStore(CONTACT_STORE)
								contactStore.put(Object.assign({}, { id: r.id, nombre: r.nombre || r.name || r.id }))
								toSave.receptorIds.push(r.id)
							} else if (typeof r === 'string') {
								toSave.receptorIds.push(r)
							}
						}
						// if receptor array with single element, collapse to string
						if (toSave.receptorIds.length === 1) toSave.receptor = toSave.receptorIds[0]
					} else if (typeof toSave.receptor === 'object' && toSave.receptor.id) {
						const contactStore = tx.objectStore(CONTACT_STORE)
						contactStore.put(Object.assign({}, { id: toSave.receptor.id, nombre: toSave.receptor.nombre || toSave.receptor.name || toSave.receptor.id }))
						toSave.receptorIds = [toSave.receptor.id]
						toSave.receptor = toSave.receptor.id
					}
				}

			} catch (err) {
				console.warn('Normalización de contactos en addMessage falló (no crítico):', err)
			}

			return new Promise((resolve, reject) => {
				const request = store.put(toSave)
				request.onsuccess = () => resolve(request.result)
				request.onerror = () => reject('No se pudo añadir/actualizar mensaje')
			})
		} catch (err) {
			console.error('Error en addMessage:', err)
		}
	}

	/* CONTACTS: CRUD y utilidades */

	async addContact(contact) {
		try {
			const tx = this.db.transaction(CONTACT_STORE, 'readwrite')
			const store = tx.objectStore(CONTACT_STORE)
			return new Promise((resolve, reject) => {
				const id = contact.id || contact.nombre || contact.name
				const toSave = Object.assign({ id }, contact)
				const req = store.add(toSave)
				req.onsuccess = () => resolve(req.result)
				req.onerror = () => reject('No se pudo añadir contacto')
			})
		} catch (err) { console.error('Error en addContact:', err) }
	}

	async upsertContact(contact) {
		try {
			const tx = this.db.transaction(CONTACT_STORE, 'readwrite')
			const store = tx.objectStore(CONTACT_STORE)
			const rawId = contact.id || contact.nombre || contact.name
			const id = rawId ? rawId.toString().trim().toLowerCase() : rawId
			return new Promise((resolve, reject) => {
				const getReq = store.get(id)
				getReq.onsuccess = () => {
					const existing = getReq.result || {}
					// Do not persist transient presence flags (online, socketId)
					const sanitized = Object.assign({}, contact)
					if ('online' in sanitized) delete sanitized.online
					if ('socketId' in sanitized) delete sanitized.socketId
					// Preserve display name in 'nombre', but store id normalized
					if (sanitized.nombre && typeof sanitized.nombre === 'string') sanitized.nombre = sanitized.nombre.toString()
					const merged = Object.assign({}, existing, sanitized, { id })
					const putReq = store.put(merged)
					putReq.onsuccess = () => resolve(merged)
					putReq.onerror = () => reject('Error al upsert contact')
				}
				getReq.onerror = () => reject('Error accediendo contacto')
			})
		} catch (err) { console.error('Error en upsertContact:', err) }
	}

	async getContact(id) {
		try {
			const tx = this.db.transaction(CONTACT_STORE, 'readonly')
			const store = tx.objectStore(CONTACT_STORE)
			return new Promise((resolve, reject) => {
				const req = store.get(id)
				req.onsuccess = () => resolve(req.result)
				req.onerror = () => reject('Error al obtener contacto')
			})
		} catch (err) { console.error('Error en getContact:', err); return null }
	}

	async getContactByName(name) {
		try {
			const all = await this.getAllContacts()
			return all.find(c => String(c.nombre) === String(name) || String(c.id) === String(name)) || null
		} catch (err) { console.error('Error en getContactByName:', err); return null }
	}

	async getAllContacts() {
		try {
			const tx = this.db.transaction(CONTACT_STORE, 'readonly')
			const store = tx.objectStore(CONTACT_STORE)
			return new Promise((resolve) => {
				const req = store.getAll()
				req.onsuccess = () => resolve(req.result || [])
			})
		} catch (err) { console.error('Error en getAllContacts:', err); return [] }
	}

	async updateContact(id, newData) {
		try {
			const tx = this.db.transaction(CONTACT_STORE, 'readwrite')
			const store = tx.objectStore(CONTACT_STORE)
			return new Promise((resolve, reject) => {
				const getReq = store.get(id)
				getReq.onsuccess = () => {
					const existing = getReq.result || {}
					const merged = Object.assign({}, existing, newData, { id })
					const putReq = store.put(merged)
					putReq.onsuccess = () => resolve(merged)
					putReq.onerror = () => reject('Error al actualizar contacto')
				}
				getReq.onerror = () => reject('Error accediendo contacto')
			})
		} catch (err) { console.error('Error en updateContact:', err) }
	}

	async setOnlineStatus(id, online = false, lastSeen = Date.now(), socketId = null) {
		try {
			const tx = this.db.transaction(CONTACT_STORE, 'readwrite')
			const store = tx.objectStore(CONTACT_STORE)
			return new Promise((resolve, reject) => {
				const getReq = store.get(id)
				getReq.onsuccess = () => {
					const existing = getReq.result || { id }
					// Do NOT persist 'online' or 'socketId' as presence is transient. Only update lastSeen.
					const merged = Object.assign({}, existing, { lastSeen })
					const putReq = store.put(merged)
					putReq.onsuccess = () => resolve(merged)
					putReq.onerror = () => reject('Error al actualizar estado online')
				}
				getReq.onerror = () => reject('Error accediendo contacto')
			})
		} catch (err) { console.error('Error en setOnlineStatus:', err) }
	}

	async deleteContact(id) {
		try {
			const tx = this.db.transaction(CONTACT_STORE, 'readwrite')
			const store = tx.objectStore(CONTACT_STORE)
			return new Promise((resolve) => {
				const req = store.delete(id)
				req.onsuccess = () => resolve()
			})
		} catch (err) { console.error('Error en deleteContact:', err) }
	}

	async clearContacts() {
		try {
			const tx = this.db.transaction(CONTACT_STORE, 'readwrite')
			const store = tx.objectStore(CONTACT_STORE)
			return new Promise((resolve, reject) => {
				const req = store.clear()
				req.onsuccess = () => resolve()
				req.onerror = () => reject('Error limpiando contactos')
			})
		} catch (err) { console.error('Error en clearContacts:', err) }
	}

	/**
	 * Devuelve todos los mensajes almacenados.
	 */
	async getAllMessages() {
		try {
			const tx = this.db.transaction(MESSAGE_STORE, 'readonly')
			const store = tx.objectStore(MESSAGE_STORE)
			return new Promise((resolve) => {
				const request = store.getAll()
				request.onsuccess = () => resolve(request.result || [])
			})
		} catch (err) {
			console.error('Error en getAllMessages:', err)
			return []
		}
	}

	/**
	 * Recupera mensajes relevantes para una conversación.
	 * `target` puede ser 'Todos', un nombre de usuario, o el nombre de un grupo.
	 * `usuarioActual` es el nombre del usuario que pide el historial (necesario para mensajes privados).
	 */
	async getMessagesFor(target, usuarioActual) {
		const all = await this.getAllMessages()
		if (!target) return []
		if ((target || '').toString().trim().toLowerCase() === 'todos') return all.filter(m => {
			if (m.broadcast === true) return true
			if (Array.isArray(m.receptor)) return m.receptor.map(r => (r||'').toString().trim().toLowerCase()).includes('todos')
			return (m.receptor || '').toString().trim().toLowerCase() === 'todos'
		})
		// si target es un grupo: mensajes donde receptor array incluye target OR mensajes estructurados de tipo 'group' para ese grupo
		const byGroup = all.filter(m => (Array.isArray(m.receptor) && m.receptor.includes(target)) || (m.tipo === 'grupo' && m.grupo === target))
		if (byGroup.length) return byGroup
		// mensajes privados entre usuarioActual y target (usar normalización si está disponible)
		const usuarioNorm = (usuarioActual || '').toString().trim().toLowerCase()
		const targetNorm = (target || '').toString().trim().toLowerCase()
		return all.filter(m => {
			const receptorNorms = Array.isArray(m.receptorNorm)
				? m.receptorNorm
				: (Array.isArray(m.receptor) ? m.receptor.map(r => (r||'').toString().trim().toLowerCase()) : [])
			const emNorm = m.emisorNorm || (m.emisor || '').toString().trim().toLowerCase()
			if (receptorNorms.length === 0) return false
			return (emNorm === usuarioNorm && receptorNorms.includes(targetNorm)) || (emNorm === targetNorm && receptorNorms.includes(usuarioNorm))
		})
	}

	async updateMessage(id, newData) {
		try {
			const tx = this.db.transaction(MESSAGE_STORE, 'readwrite')
			const store = tx.objectStore(MESSAGE_STORE)
			return new Promise((resolve, reject) => {
				const getReq = store.get(id)
				getReq.onsuccess = () => {
					const existing = getReq.result || {}
					const updated = Object.assign({}, existing, newData, { id })
					const putReq = store.put(updated)
					putReq.onsuccess = () => resolve()
					putReq.onerror = () => reject('Error al actualizar mensaje')
				}
				getReq.onerror = () => reject('Error accediendo mensaje')
			})
		} catch (err) { console.error('Error en updateMessage:', err) }
	}

	/**
	 * Obtener un mensaje por su clave `id` (puede ser server id o localId).
	 */
	async getMessage(id) {
		try {
			const tx = this.db.transaction(MESSAGE_STORE, 'readonly')
			const store = tx.objectStore(MESSAGE_STORE)
			return new Promise((resolve, reject) => {
				const req = store.get(id)
				req.onsuccess = () => resolve(req.result)
				req.onerror = () => reject('Error al obtener mensaje')
			})
		} catch (err) { console.error('Error en getMessage:', err); return null }
	}

	/**
	 * Migrar un mensaje almacenado con `localId` a su `newId` asignado por el servidor.
	 * Conserva/mezcla datos y elimina la entrada antigua.
	 */
	async migrateLocalId(localId, newId, newData = {}) {
		try {
			const tx = this.db.transaction(MESSAGE_STORE, 'readwrite')
			const store = tx.objectStore(MESSAGE_STORE)
			return new Promise((resolve, reject) => {
				const getReq = store.get(localId)
				getReq.onsuccess = () => {
					const existing = getReq.result || {}
					const merged = Object.assign({}, existing, newData)
					merged.id = newId
					const putReq = store.put(merged)
					putReq.onsuccess = () => {
						if (String(localId) !== String(newId)) {
							const delReq = store.delete(localId)
							delReq.onsuccess = () => resolve(newId)
							delReq.onerror = () => resolve(newId)
						} else resolve(newId)
					}
					putReq.onerror = () => reject('Error al guardar mensaje migrado')
				}
				getReq.onerror = () => reject('Error leyendo mensaje local')
			})
		} catch (err) { console.error('Error en migrateLocalId:', err) }
	}

	/**
	 * READ: Trae todos los datos del almacén.
	 */
	async getAll(storeName) {
		try {
			// If caller passed a storeName, delegate to getAllStore
			if (storeName) return await this.getAllStore(storeName)
			const tx = this.db.transaction(GROUP_STORE, 'readonly')
			const store = tx.objectStore(GROUP_STORE)
			return new Promise((resolve) => {
				const request = store.getAll()
				request.onsuccess = () => resolve(request.result)
			})
		} catch (err) {
			console.error("Error en getAll:", err)
			return []
		}
	}

	// Generic getAll for any store name
	async getAllStore(storeName) {
		try {
			if (!this.db) return []
			if (!this.db.objectStoreNames.contains(storeName)) return []
			const tx = this.db.transaction(storeName, 'readonly')
			const store = tx.objectStore(storeName)
			return new Promise((resolve) => {
				const req = store.getAll()
				req.onsuccess = () => resolve(req.result || [])
			})
		} catch (err) { console.error('Error in getAllStore:', err); return [] }
	}

	// Contacts / Groups helpers
	async saveContacts(list) {
		try {
			if (!Array.isArray(list)) return
			const tx = this.db.transaction(CONTACT_STORE, 'readwrite')
			const store = tx.objectStore(CONTACT_STORE)
			await new Promise((res) => { const r = store.clear(); r.onsuccess = () => res(); r.onerror = () => res() })
			for (const c of list) {
				const username = (typeof c === 'string') ? c : (c.username || c.nombre || c.id || '')
				const id = username ? username.toString().trim().toLowerCase() : null
				if (!id) continue
				const toSave = { id, nombre: (typeof c === 'string') ? username : (c.username || c.nombre || username), lastSeen: c.last_seen || c.lastSeen || null }
				try { store.put(toSave) } catch (e) {}
			}
			console.log('CONTACTOS DB', await this.getAllStore(CONTACT_STORE))
		} catch (err) { console.error('saveContacts error', err) }
	}

	async getContacts() {
		try { return await this.getAllStore(CONTACT_STORE) } catch (e) { return [] }
	}

	async clearAllContacts() { return this.clearContacts() }

	async saveGroups(list) {
		try {
			if (!Array.isArray(list)) return
			const tx = this.db.transaction(GROUP_STORE, 'readwrite')
			const store = tx.objectStore(GROUP_STORE)
			await new Promise((res) => { const r = store.clear(); r.onsuccess = () => res(); r.onerror = () => res() })
			for (const g of list) {
				const name = (typeof g === 'string') ? g : (g.nombreGrupo || g.nombre || g.id || '')
				const id = name ? name.toString().trim() : null
				if (!id) continue
				const integrantes = Array.isArray(g.integrantes) ? g.integrantes : (Array.isArray(g.miembros) ? g.miembros : [])
				try { store.put({ id, integrantes }) } catch (e) {}
			}
			console.log('GRUPOS DB', await this.getAllStore(GROUP_STORE))
		} catch (err) { console.error('saveGroups error', err) }
	}

	async getGroups() {
		try { return await this.getAllStore(GROUP_STORE) } catch (e) { return [] }
	}

	async clearGroups() {
		try {
			const tx = this.db.transaction(GROUP_STORE, 'readwrite')
			const store = tx.objectStore(GROUP_STORE)
			return new Promise((resolve, reject) => {
				const req = store.clear()
				req.onsuccess = () => resolve()
				req.onerror = () => reject('Error limpiando grupos')
			})
		} catch (err) { console.error('Error en clearGroups:', err) }
	}

	/**
	 * Eliminar al usuario `usuarioId` de los integrantes del grupo `groupId`.
	 * Si el grupo existe, actualiza la lista de integrantes.
	 */
	async removeUserFromGroup(groupId, usuarioId) {
		try {
			const tx = this.db.transaction(GROUP_STORE, 'readwrite')
			const store = tx.objectStore(GROUP_STORE)
			return new Promise((resolve, reject) => {
				const req = store.get(groupId)
				req.onsuccess = () => {
					const g = req.result
					if (!g) return resolve(false)
					const miembros = Array.isArray(g.integrantes) ? g.integrantes.filter(x => String(x) !== String(usuarioId)) : []
					const updated = Object.assign({}, g, { integrantes: miembros })
					const putReq = store.put(updated)
					putReq.onsuccess = () => resolve(true)
					putReq.onerror = () => reject('Error actualizando grupo')
				}
				req.onerror = () => reject('Error leyendo grupo')
			})
		} catch (err) { console.error('Error en removeUserFromGroup:', err); return false }
	}

	/**
	 * Elimina todos los mensajes de un grupo localmente.
	 */
	async deleteMessagesByGroup(groupId) {
		try {
			const tx = this.db.transaction(MESSAGE_STORE, 'readwrite')
			const store = tx.objectStore(MESSAGE_STORE)
			return new Promise((resolve, reject) => {
				const req = store.getAll()
				req.onsuccess = () => {
					const all = req.result || []
					let pending = 0
					const toDelete = all.filter(m => m && m.tipo === 'grupo' && m.grupo === groupId).map(m => m.id || m.localId).filter(Boolean)
					if (toDelete.length === 0) return resolve(0)
					for (const id of toDelete) {
						pending++
						const dreq = store.delete(id)
						dreq.onsuccess = () => {
							pending--
							if (pending === 0) resolve(toDelete.length)
						}
						dreq.onerror = () => {
							pending--
							if (pending === 0) resolve(toDelete.length)
						}
					}
				}
				req.onerror = () => reject('Error leyendo mensajes')
			})
		} catch (err) { console.error('Error en deleteMessagesByGroup:', err); return 0 }
	}

	/**
	 * Elimina mensajes privados relacionados con un contacto y elimina el contacto.
	 */
	async deleteContactAndMessages(contactId) {
		try {
			// delete messages first
			const tx = this.db.transaction([MESSAGE_STORE, CONTACT_STORE], 'readwrite')
			const msgStore = tx.objectStore(MESSAGE_STORE)
			const contactStore = tx.objectStore(CONTACT_STORE)
			return new Promise((resolve, reject) => {
				const req = msgStore.getAll()
				req.onsuccess = () => {
					const all = req.result || []
					const toDelete = all.filter(m => m && m.tipo === 'privado' && ((m.emisor === contactId) || (m.receptor === contactId))).map(m => m.id || m.localId).filter(Boolean)
					let pending = 0
					if (toDelete.length === 0) {
						// delete contact
						const d = contactStore.delete(contactId)
						d.onsuccess = () => resolve(0)
						d.onerror = () => resolve(0)
						return
					}
					for (const id of toDelete) {
						pending++
						const dreq = msgStore.delete(id)
						dreq.onsuccess = () => {
							pending--
							if (pending === 0) {
								// then delete contact
								const d = contactStore.delete(contactId)
								d.onsuccess = () => resolve(toDelete.length)
								d.onerror = () => resolve(toDelete.length)
							}
						}
						dreq.onerror = () => {
							pending--
							if (pending === 0) {
								const d = contactStore.delete(contactId)
								d.onsuccess = () => resolve(toDelete.length)
								d.onerror = () => resolve(toDelete.length)
							}
						}
					}
				}
				req.onerror = () => reject('Error leyendo mensajes')
			})
		} catch (err) { console.error('Error en deleteContactAndMessages:', err); return 0 }
	}

	/**
	 * Renombra un grupo: crea una nueva entrada con newName (id), borra la antigua,
	 * y actualiza todos los mensajes que referencian el grupo antiguo para usar newName.
	 */
	async renameGroup(oldName, newName) {
		try {
			const tx = this.db.transaction([GROUP_STORE, MESSAGE_STORE], 'readwrite')
			const gStore = tx.objectStore(GROUP_STORE)
			const mStore = tx.objectStore(MESSAGE_STORE)
			return new Promise((resolve, reject) => {
				const getReq = gStore.get(oldName)
				getReq.onsuccess = () => {
					const g = getReq.result
					if (!g) return reject('Grupo no encontrado')
					const newGroup = Object.assign({}, g, { id: newName })
					// put new group
					const putReq = gStore.put(newGroup)
					putReq.onsuccess = () => {
						// delete old
						const delReq = gStore.delete(oldName)
						delReq.onsuccess = () => {
							// update messages
							const allReq = mStore.getAll()
							allReq.onsuccess = () => {
								const all = allReq.result || []
								let pending = 0
								for (const m of all) {
									if (m && m.tipo === 'grupo' && m.grupo === oldName) {
										pending++
										const updated = Object.assign({}, m, { grupo: newName })
										const upReq = mStore.put(updated)
										upReq.onsuccess = () => { pending--; if (pending === 0) resolve(true) }
										upReq.onerror = () => { pending--; if (pending === 0) resolve(true) }
									}
								}
								if (pending === 0) resolve(true)
							}
							allReq.onerror = () => resolve(true)
							
						}
						delReq.onerror = () => resolve(true)
					}
					putReq.onerror = () => reject('Error renombrando grupo')
				}
				getReq.onerror = () => reject('Error leyendo grupo')
			})
		} catch (err) { console.error('Error en renameGroup:', err); return false }
	}

	/**
	 * Actualiza el nombre de un contacto en contactos y actualiza mensajes donde
	 * aparezca como emisor o receptor (display name).
	 * `contactId` es la clave en la store CONTACT_STORE.
	 */
	async renameContact(contactId, newName) {
		try {
			const tx = this.db.transaction([CONTACT_STORE, MESSAGE_STORE], 'readwrite')
			const cStore = tx.objectStore(CONTACT_STORE)
			const mStore = tx.objectStore(MESSAGE_STORE)
			return new Promise((resolve, reject) => {
				const getReq = cStore.get(contactId)
				getReq.onsuccess = () => {
					const existing = getReq.result || null
					if (!existing) return reject('Contacto no encontrado')
					const oldName = existing.nombre || contactId
					const updatedContact = Object.assign({}, existing, { nombre: newName })
					const putReq = cStore.put(updatedContact)
					putReq.onsuccess = () => {
						// update messages where emisor/receptor matches oldName
						const allReq = mStore.getAll()
						allReq.onsuccess = () => {
							const all = allReq.result || []
							let pending = 0
							for (const m of all) {
								if (m && m.tipo === 'privado') {
									let changed = false
									const copy = Object.assign({}, m)
									if (copy.emisor === oldName) { copy.emisor = newName; changed = true; copy.emisorNorm = (newName||'').toString().trim().toLowerCase() }
									if (copy.receptor === oldName) { copy.receptor = newName; changed = true; copy.receptorNorm = (newName||'').toString().trim().toLowerCase() }
									if (changed) {
										pending++
										const upReq = mStore.put(copy)
										upReq.onsuccess = () => { pending--; if (pending === 0) resolve(true) }
										upReq.onerror = () => { pending--; if (pending === 0) resolve(true) }
									}
								}
							}
							if (pending === 0) resolve(true)
						}
						allReq.onerror = () => resolve(true)
					}
					putReq.onerror = () => reject('Error actualizando contacto')
				}
				getReq.onerror = () => reject('Error leyendo contacto')
			})
		} catch (err) { console.error('Error en renameContact:', err); return false }
	}

	/**
	 * UPDATE: Modifica un registro existente.
	 */
	async update(id, nuevoNombre) {
		try {
			const tx = this.db.transaction(GROUP_STORE, 'readwrite')
			const store = tx.objectStore(GROUP_STORE)
			
			return new Promise((resolve, reject) => {
				// .put() busca el ID. Si existe lo actualiza, si no, lo crea.
				const request = store.put({ id, nombre: nuevoNombre })
				request.onsuccess = () => resolve()
				request.onerror = () => reject("Error al actualizar")
			})
		} catch (err) {
			console.error("Error en update:", err)
		}
	}

	/**
	 * DELETE: Elimina por clave primaria.
	 */
	async delete(id) {
		try {
			const tx = this.db.transaction(GROUP_STORE, 'readwrite')
			const store = tx.objectStore(GROUP_STORE)
			
			return new Promise((resolve) => {
				// Borramos el objeto que coincida con el ID numérico.
				const request = store.delete(id)
				request.onsuccess = () => resolve()
			})
		} catch (err) {
			console.error("Error en delete:", err)
		}
	}

	/**
	 * CLEAR: Vacía todo el contenido sin borrar la base de datos.
	 */
	async clearAll() {
		try {
			const tx = this.db.transaction(GROUP_STORE, 'readwrite')
			const store = tx.objectStore(GROUP_STORE)
			
			return new Promise((resolve, reject) => {
				const request = store.clear()
				request.onsuccess = () => resolve()
				request.onerror = () => reject("Error al limpiar")
			})
		} catch (err) {
			console.error("Error en clearAll:", err)
		}
	}
}

// Compatibilidad: exportar nombres y default
export { chatDB }
export const chatBD = chatDB
export default chatDB

// Exponer el constructor globalmente para pruebas desde la consola (dev only)
if (typeof window !== 'undefined') {
	try {
		window.chatBD = chatBD
		window.chatDBClass = chatDB
	} catch (e) { }
}
