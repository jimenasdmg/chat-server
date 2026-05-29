import "dotenv/config"
import mysql from "mysql2/promise"

const db = await mysql.createConnection({
 host: process.env.DB_HOST || process.env.MYSQLHOST,
 user: process.env.DB_USER || process.env.MYSQLUSER,
 password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD,
 database: process.env.DB_NAME || process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE,
 port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306)
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
CREATE TABLE IF NOT EXISTS mensajes (
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
 nombre VARCHAR(100) UNIQUE NOT NULL,
 creador_id INT NULL
)
`)

try {
 await db.query(`ALTER TABLE grupos ADD COLUMN creador_id INT NULL`)
} catch (e) {
 if (!String(e.message || e).includes("Duplicate column")) console.warn("No se pudo agregar creador_id:", e.message)
}

try {
 await db.query(`ALTER TABLE grupos ADD UNIQUE KEY grupos_nombre_unique (nombre)`)
} catch (e) {
 if (!String(e.message || e).includes("Duplicate key name")) console.warn("No se pudo agregar unique a grupos.nombre:", e.message)
}

await db.query(`
CREATE TABLE IF NOT EXISTS grupo_integrantes (
 grupo_id INT,
 usuario_id INT,
 PRIMARY KEY (grupo_id, usuario_id)
)
`)

try {
 await db.query(`ALTER TABLE grupo_integrantes ADD PRIMARY KEY (grupo_id, usuario_id)`)
} catch (e) {
 const msg = String(e.message || e)
 if (!msg.includes("Multiple primary key") && !msg.includes("Duplicate entry")) {
  console.warn("No se pudo agregar primary key a grupo_integrantes:", e.message)
 }
}

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
