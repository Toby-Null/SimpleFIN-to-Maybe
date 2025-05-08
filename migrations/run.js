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
    
    const appliedResult = await pool.query('SELECT name FROM migrations');
    const appliedMigrations = appliedResult.rows.map(row => row.name);
    
    console.log('Applied migrations:', appliedMigrations);
    
    // Get all migration files
    const migrationFiles = fs.readdirSync(__dirname)
      .filter(file => file.endsWith('.sql'))
      .sort();
    
    console.log('Found migration files:', migrationFiles);
    
    await verifyAllTablesFromMigrations(migrationFiles, appliedMigrations);
    
    for (const file of migrationFiles) {
      if (!appliedMigrations.includes(file)) {
        console.log(`Applying migration: ${file}`);
        
        const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
        
        const statements = sql
          .replace(/\/\*.*?\*\//gs, '')
          .replace(/--.*$/gm, '')
          .split(';')
          .map(statement => statement.trim())
          .filter(statement => statement.length > 0);
        
        await pool.query('BEGIN');
        
        try {
          for (const statement of statements) {
            console.log(`Executing statement: ${statement.substring(0, 150)}${statement.length > 150 ? '...' : ''}`);
            await pool.query(statement);
          }
          
          await pool.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
          
          await pool.query('COMMIT');
          
          console.log(`Successfully applied migration: ${file}`);
        } catch (error) {
          await pool.query('ROLLBACK');
          console.error(`Error applying migration ${file}:`, error);
          throw error;
        }
      } else {
        console.log(`Migration already applied: ${file}`);
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

// Function to extract table names from SQL statements
const extractTableNames = (sql) => {
  const createTableRegex = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([^\s(]+)|CREATE\s+TABLE\s+([^\s(]+)/gi;
  const tables = new Set();
  
  let match;
  while ((match = createTableRegex.exec(sql)) !== null) {
    const tableName = (match[1] || match[2]).replace(/['"]/g, '').trim();
    
    const parts = tableName.split('.');
    const tableNameOnly = parts.length > 1 ? parts[1] : parts[0];
    
    tables.add(tableNameOnly);
  }
  
  return Array.from(tables);
};

// Function to verify all tables from migrations exist
const verifyAllTablesFromMigrations = async (migrationFiles, appliedMigrations) => {
  try {
    console.log('Verifying that all tables from migrations exist...');
    
    const existingTablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    const existingTables = new Set(existingTablesResult.rows.map(row => row.table_name));
    console.log('Existing tables:', Array.from(existingTables));
    
    const tableToMigrationMap = new Map();
    
    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
      const tables = extractTableNames(sql);
      
      tables.forEach(table => {
        if (!tableToMigrationMap.has(table)) {
          tableToMigrationMap.set(table, file);
        }
      });
    }
    
    console.log('Tables from migrations:', Array.from(tableToMigrationMap.keys()));
    
    const missingTables = [];
    const tablesToMigrationFiles = new Map();
    
    for (const [table, migrationFile] of tableToMigrationMap.entries()) {
      if (!existingTables.has(table) && appliedMigrations.includes(migrationFile)) {
        missingTables.push(table);
        tablesToMigrationFiles.set(table, migrationFile);
      }
    }
    
    if (missingTables.length > 0) {
      console.log(`Found ${missingTables.length} missing tables: ${missingTables.join(', ')}`);
      
      for (const missingTable of missingTables) {
        const migrationFile = tablesToMigrationFiles.get(missingTable);
        console.log(`Re-applying migration for missing table ${missingTable} from ${migrationFile}`);
        
        const sql = fs.readFileSync(path.join(__dirname, migrationFile), 'utf8');
        
        const tableRegex = new RegExp(
          `CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${missingTable}[\\s(]|` +
          `CREATE\\s+TABLE\\s+${missingTable}[\\s(]`,
          'i'
        );
        
        if (tableRegex.test(sql)) {
          const statements = sql
            .replace(/\/\*.*?\*\//gs, '')
            .replace(/--.*$/gm, '')
            .split(';')
            .map(statement => statement.trim())
            .filter(statement => statement.length > 0);
          
          const relevantStatements = statements.filter(stmt => {
            return stmt.includes(missingTable) && 
                  (stmt.toUpperCase().includes('CREATE TABLE') || 
                   stmt.toUpperCase().includes('CREATE INDEX') ||
                   stmt.toUpperCase().includes('ALTER TABLE'));
          });
          
          if (relevantStatements.length > 0) {
            for (const statement of relevantStatements) {
              console.log(`Executing statement: ${statement.substring(0, 150)}${statement.length > 150 ? '...' : ''}`);
              await pool.query(statement);
            }
            console.log(`Successfully recreated missing table: ${missingTable}`);
          } else {
            console.log(`Could not find CREATE TABLE statement for ${missingTable} in ${migrationFile}`);
          }
        } else {
          console.log(`Could not find CREATE TABLE statement for ${missingTable} in ${migrationFile}`);
        }
      }
    } else {
      console.log('All tables from applied migrations exist in the database.');
    }
  } catch (error) {
    console.error('Error verifying tables from migrations:', error);
    throw error;
  }
};

// Run migrations
init().then(() => {
  console.log('Migration process completed successfully.');
}).catch(error => {
  console.error('Migration process failed:', error);
  process.exit(1);
});