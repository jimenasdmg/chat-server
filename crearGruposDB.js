import { db } from './server/db.js'

async function existsTable(name) {
  const [rows] = await db.execute("SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [name])
  return rows && rows.length && rows[0].c > 0
}

async function existsColumn(table, column) {
  const [rows] = await db.execute("SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?", [table, column])
  return rows && rows.length && rows[0].c > 0
}

async function existsForeignKey(table, referencedTable) {
  const [rows] = await db.execute("SELECT COUNT(*) AS c FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND table_name = ? AND referenced_table_name = ?", [table, referencedTable])
  return rows && rows.length && rows[0].c > 0
}

async function main() {
  try {
    // Create grupos table if not exists
    const hasGrupos = await existsTable('grupos')
    if (!hasGrupos) {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS grupos (
          id INT AUTO_INCREMENT PRIMARY KEY,
          nombre VARCHAR(100) NOT NULL,
          creador_id INT NULL,
          creado_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_nombre (nombre),
          FOREIGN KEY (creador_id) REFERENCES usuarios(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
      console.log('Tabla "grupos" creada')
    } else {
      console.log('Tabla "grupos" ya existe')
    }

    // Create grupo_integrantes table if not exists
    const hasIntegrantes = await existsTable('grupo_integrantes')
    if (!hasIntegrantes) {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS grupo_integrantes (
          grupo_id INT NOT NULL,
          usuario_id INT NOT NULL,
          agregado_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (grupo_id, usuario_id),
          FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE CASCADE,
          FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
      console.log('Tabla "grupo_integrantes" creada')
    } else {
      console.log('Tabla "grupo_integrantes" ya existe')
    }

    // Add columna grupo_id en mensajes si no existe
    const hasGrupoId = await existsColumn('mensajes', 'grupo_id')
    if (!hasGrupoId) {
      await db.execute('ALTER TABLE mensajes ADD COLUMN grupo_id INT NULL')
      console.log('Columna "grupo_id" añadida a "mensajes"')
    } else {
      console.log('Columna "grupo_id" ya existe en "mensajes"')
    }

    // Add foreign key from mensajes.grupo_id -> grupos.id if not exists
    const hasFk = await existsForeignKey('mensajes', 'grupos')
    if (!hasFk) {
      try {
        await db.execute('ALTER TABLE mensajes ADD CONSTRAINT fk_mensajes_grupos FOREIGN KEY (grupo_id) REFERENCES grupos(id)')
        console.log('Foreign key fk_mensajes_grupos añadida')
      } catch (e) {
        console.error('No se pudo añadir FK fk_mensajes_grupos:', e.message || e)
      }
    } else {
      console.log('Foreign key hacia "grupos" ya existe en "mensajes"')
    }

    console.log('\nTABLAS DE GRUPOS CREADAS')
    process.exit(0)
  } catch (e) {
    console.error('Error creando tablas de grupos:', e)
    process.exit(1)
  }
}

main()
