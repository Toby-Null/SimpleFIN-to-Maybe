const { Pool } = require('pg');

// Create a pool for the SimpleFIN to Maybe database
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

// Function to get a Maybe database connection
const getMaybeDbConnection = async () => {
  try {
    const { getSetting } = require('../models/setting');
    
    const host = await getSetting('maybe_postgres_host') || process.env.MAYBE_DB_HOST;
    const port = await getSetting('maybe_postgres_port') || process.env.MAYBE_DB_PORT;
    const database = await getSetting('maybe_postgres_db') || process.env.MAYBE_DB_NAME;
    const user = await getSetting('maybe_postgres_user') || process.env.MAYBE_DB_USER;
    const password = await getSetting('maybe_postgres_password') || process.env.MAYBE_DB_PASSWORD;
    
    return new Pool({
      host,
      port,
      database,
      user,
      password
    });
  } catch (error) {
    console.error('Error creating Maybe database connection:', error);
    throw error;
  }
};

module.exports = {
  pool,
  getMaybeDbConnection
};