import 'dotenv/config'
import mysql from "mysql2/promise";

const dbConfig = {
    host: process.env.DB_HOST || process.env.MYSQLHOST,
    user: process.env.DB_USER || process.env.MYSQLUSER,
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD,
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE,
    port: parseInt(process.env.DB_PORT || process.env.MYSQLPORT || "3306", 10),
}

console.log("DB_HOST:", dbConfig.host);
console.log("DB_USER:", dbConfig.user);
console.log("DB_NAME:", dbConfig.database);

const db = mysql.createPool({
    ...dbConfig,

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

console.log("Pool MySQL creado");

export default db;
export { db };
