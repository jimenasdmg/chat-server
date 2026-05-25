import mysql from "mysql2/promise";

export const db = await mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "040804",
    database: "chat_app"
});

console.log("MariaDB conectada");
