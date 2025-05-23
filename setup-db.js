const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./database.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      s3_access_key_id TEXT,
      s3_secret_access_key TEXT,
      s3_region TEXT
    )
  `);
  console.log("Users table created or updated successfully.");
});

db.close();
