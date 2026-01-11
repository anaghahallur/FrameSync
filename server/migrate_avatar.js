require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    try {
        console.log("Adding avatar column to users table...");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;");
        console.log("Migration successful!");
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        pool.end();
    }
}

migrate();
