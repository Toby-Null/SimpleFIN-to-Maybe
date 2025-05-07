require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Create a pool
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

const init = async () => {
  try {
    console.log('Creating migrations table if it doesn\'t exist...');
    
    // Create migrations table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('Migrations table ready.');
    
    // Get applied migrations
    const appliedResult = await pool.query('SELECT name FROM migrations');
    const appliedMigrations = appliedResult.rows.map(row => row.name);
    
    console.log('Applied migrations:', appliedMigrations);
    
    // Get all migration files
    const migrationFiles = fs.readdirSync(__dirname)
      .filter(file => file.endsWith('.sql'))
      .sort();
    
    console.log('Found migration files:', migrationFiles);
    
    // Apply migrations that haven't been applied yet
    for (const file of migrationFiles) {
      if (!appliedMigrations.includes(file)) {
        console.log(`Applying migration: ${file}`);
        
        const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
        
        // Start a transaction
        await pool.query('BEGIN');
        
        try {
          // Apply the migration
          await pool.query(sql);
          
          // Record the migration
          await pool.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
          
          // Commit the transaction
          await pool.query('COMMIT');
          
          console.log(`Successfully applied migration: ${file}`);
        } catch (error) {
          // Rollback on error
          await pool.query('ROLLBACK');
          console.error(`Error applying migration ${file}:`, error);
          throw error;
        }
      }
    }
    
    console.log('All migrations applied successfully.');
  } catch (error) {
    console.error('Error running migrations:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
};

// Run migrations
init();