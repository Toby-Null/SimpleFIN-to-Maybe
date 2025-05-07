const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

// Create an account
const createAccount = async (accountData) => {
  try {
    const { account_type, identifier, display_name, accountable_type, currency, maybe_family_id } = accountData;
    
    const result = await pool.query(
      `INSERT INTO accounts 
       (id, account_type, identifier, display_name, accountable_type, currency, maybe_family_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING *`,
      [uuidv4(), account_type, identifier, display_name, accountable_type, currency, maybe_family_id]
    );
    
    return result.rows[0];
  } catch (error) {
    console.error('Error creating account:', error);
    throw error;
  }
};

// Get all accounts
const getAllAccounts = async () => {
  try {
    const result = await pool.query(
      `SELECT a.*, 
       (SELECT COUNT(*) > 0 FROM linkages WHERE simplefin_account_id = a.id OR maybe_account_id = a.id) as in_use
       FROM accounts a
       ORDER BY a.account_type, a.display_name`
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting all accounts:', error);
    throw error;
  }
};

// Get accounts by type
const getAccountsByType = async (accountType) => {
  try {
    const result = await pool.query(
      `SELECT a.*, 
       (SELECT COUNT(*) > 0 FROM linkages WHERE simplefin_account_id = a.id OR maybe_account_id = a.id) as in_use
       FROM accounts a
       WHERE a.account_type = $1
       ORDER BY a.display_name`,
      [accountType]
    );
    return result.rows;
  } catch (error) {
    console.error(`Error getting accounts by type ${accountType}:`, error);
    throw error;
  }
};

// Get accounts by type that are not linked
const getUnlinkedAccountsByType = async (accountType, linkageColumn) => {
  const column = linkageColumn || (accountType === 'simplefin' ? 'simplefin_account_id' : 'maybe_account_id');
  
  try {
    const result = await pool.query(
      `SELECT a.*
       FROM accounts a
       WHERE a.account_type = $1
       AND a.id NOT IN (SELECT ${column} FROM linkages)
       ORDER BY a.display_name`,
      [accountType]
    );
    return result.rows;
  } catch (error) {
    console.error(`Error getting unlinked accounts by type ${accountType}:`, error);
    throw error;
  }
};

// Get account by ID
const getAccountById = async (id) => {
  try {
    const result = await pool.query(
      `SELECT a.*, 
       (SELECT COUNT(*) > 0 FROM linkages WHERE simplefin_account_id = a.id OR maybe_account_id = a.id) as in_use
       FROM accounts a
       WHERE a.id = $1`,
      [id]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error(`Error getting account by ID ${id}:`, error);
    throw error;
  }
};

// Get account by identifier and type
const getAccountByIdentifier = async (identifier, accountType) => {
  try {
    const result = await pool.query(
      `SELECT * FROM accounts 
       WHERE identifier = $1 AND account_type = $2`,
      [identifier, accountType]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error(`Error getting account by identifier ${identifier}:`, error);
    throw error;
  }
};

// Update an account
const updateAccount = async (id, accountData) => {
  try {
    const { display_name, accountable_type, currency } = accountData;
    
    const result = await pool.query(
      `UPDATE accounts 
       SET display_name = $1, accountable_type = $2, currency = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [display_name, accountable_type, currency, id]
    );
    
    return result.rows[0];
  } catch (error) {
    console.error(`Error updating account ${id}:`, error);
    throw error;
  }
};

// Delete an account
const deleteAccount = async (id) => {
  try {
    await pool.query('DELETE FROM accounts WHERE id = $1', [id]);
    return true;
  } catch (error) {
    console.error(`Error deleting account ${id}:`, error);
    throw error;
  }
};

// Check if account is in use by linkages
const isAccountInUse = async (id) => {
  try {
    const result = await pool.query(
      `SELECT EXISTS(
         SELECT 1 FROM linkages 
         WHERE simplefin_account_id = $1 OR maybe_account_id = $1
       ) as in_use`,
      [id]
    );
    return result.rows[0].in_use;
  } catch (error) {
    console.error(`Error checking if account ${id} is in use:`, error);
    throw error;
  }
};

module.exports = {
  createAccount,
  getAllAccounts,
  getAccountsByType,
  getUnlinkedAccountsByType,
  getAccountById,
  getAccountByIdentifier,
  updateAccount,
  deleteAccount,
  isAccountInUse
};