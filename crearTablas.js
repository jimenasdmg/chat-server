import mysql from "mysql2/promise"

const db = await mysql.createConnection({
 host:"zephyr.proxy.rlwy.net",
 user:"root",
 password:"esraYFQooQbMMjyCsMKdktATadvQzegO",
 database:"railway",
 port:53959
})

console.log("Conectado")

await db.query(`
CREATE TABLE IF NOT EXISTS usuarios (
 id INT AUTO_INCREMENT PRIMARY KEY,
 username VARCHAR(100) UNIQUE NOT NULL,
 online BOOLEAN DEFAULT TRUE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`)

await db.query(`
DROP TABLE IF EXISTS mensajes
`)

await db.query(`
CREATE TABLE mensajes (
 id INT AUTO_INCREMENT PRIMARY KEY,
 tipo VARCHAR(30) DEFAULT 'privado',
 emisor_id INT,
 receptor_id INT,
 grupo_id INT NULL,
 contenido TEXT,
 enviado_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`)

await db.query(`
CREATE TABLE IF NOT EXISTS message_recipients (
 mensaje_id INT,
 usuario_id INT,
 entregado BOOLEAN DEFAULT FALSE,
 leido BOOLEAN DEFAULT FALSE,
 entregado_at TIMESTAMP NULL,
 leido_at TIMESTAMP NULL,
 PRIMARY KEY (mensaje_id, usuario_id)
)
`)

await db.query(`
CREATE TABLE IF NOT EXISTS grupos (
 id INT AUTO_INCREMENT PRIMARY KEY,
 nombre VARCHAR(100)
)
`)

await db.query(`
CREATE TABLE IF NOT EXISTS grupo_integrantes (
 grupo_id INT,
 usuario_id INT
)
`)

await db.query(`
CREATE TABLE IF NOT EXISTS contactos (
 id INT AUTO_INCREMENT PRIMARY KEY,
 usuario_id INT,
 contacto_id INT,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY usuario_contacto_unique (usuario_id, contacto_id)
)
`)

console.log("TODAS LAS TABLAS CREADAS")

await db.end()
process.exit()