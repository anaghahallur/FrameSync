const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function migrate() {
    try {
        console.log("Checking for watch_time column in users table...");

        // Check if column exists
        const checkRes = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='users' AND column_name='watch_time'
    `);

        if (checkRes.rows.length === 0) {
            console.log("Adding watch_time column to users table...");
            await pool.query('ALTER TABLE users ADD COLUMN watch_time INTEGER DEFAULT 0');
            console.log("Column added successfully.");
        } else {
            console.log("watch_time column already exists.");
        }

    } catch (err) {
        console.error("Migration Error:", err);
    } finally {
        await pool.end();
    }
}

migrate();
