import mysql from "mysql2/promise";

console.log("DB_HOST:", process.env.DB_HOST);
console.log("DB_USER:", process.env.DB_USER);
console.log("DB_NAME:", process.env.DB_NAME);

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || "3306"),

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

console.log("Pool MySQL creado");

export default db;
export { db };