const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

// Create a new linkage
const createLinkage = async (simplefinAccountId, maybeAccountId) => {
  try {
    const result = await pool.query(
      `INSERT INTO linkages 
       (id, simplefin_account_id, maybe_account_id, enabled, sync_status, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'initialized', NOW(), NOW())
       RETURNING *`,
      [uuidv4(), simplefinAccountId, maybeAccountId]
    );
    
    return result.rows[0];
  } catch (error) {
    console.error('Error creating linkage:', error);
    throw error;
  }
};

// Get all linkages with account details
const getAllLinkages = async () => {
  try {
    const result = await pool.query(
      `SELECT l.*,
        sf.display_name as simplefin_display_name,
        sf.identifier as simplefin_identifier,
        m.display_name as maybe_display_name,
        m.identifier as maybe_identifier,
        m.accountable_type as maybe_account_type
       FROM linkages l
       JOIN accounts sf ON l.simplefin_account_id = sf.id
       JOIN accounts m ON l.maybe_account_id = m.id
       ORDER BY l.created_at`
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting all linkages:', error);
    throw error;
  }
};

// Get linkage by ID
const getLinkageById = async (id) => {
  try {
    const result = await pool.query(
      `SELECT l.*,
        sf.display_name as simplefin_display_name,
        sf.identifier as simplefin_identifier,
        m.display_name as maybe_display_name,
        m.identifier as maybe_identifier,
        m.accountable_type as maybe_account_type
       FROM linkages l
       JOIN accounts sf ON l.simplefin_account_id = sf.id
       JOIN accounts m ON l.maybe_account_id = m.id
       WHERE l.id = $1`,
      [id]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error(`Error getting linkage by ID ${id}:`, error);
    throw error;
  }
};

// Update linkage enabled status
const updateLinkageStatus = async (id, enabled) => {
  try {
    const result = await pool.query(
      `UPDATE linkages
       SET enabled = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [enabled, id]
    );
    return result.rows[0];
  } catch (error) {
    console.error(`Error updating linkage status ${id}:`, error);
    throw error;
  }
};

// Update linkage sync status
const updateSyncStatus = async (id, syncStatus) => {
  try {
    const result = await pool.query(
      `UPDATE linkages
       SET sync_status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [syncStatus, id]
    );
    return result.rows[0];
  } catch (error) {
    console.error(`Error updating linkage sync status ${id}:`, error);
    throw error;
  }
};

// Update linkage last sync time
const updateLastSync = async (id) => {
  try {
    const result = await pool.query(
      `UPDATE linkages
       SET last_sync = NOW(), updated_at = NOW(), sync_status = 'complete'
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rows[0];
  } catch (error) {
    console.error(`Error updating linkage last sync time ${id}:`, error);
    throw error;
  }
};

// Set linkage error status
const setLinkageError = async (id, errorMessage) => {
  try {
    const result = await pool.query(
      `UPDATE linkages
       SET sync_status = 'error', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    
    console.error(`Linkage ${id} error: ${errorMessage}`);
    
    return result.rows[0];
  } catch (error) {
    console.error(`Error setting linkage error status ${id}:`, error);
    throw error;
  }
};

// Delete a linkage
const deleteLinkage = async (id) => {
  try {
    await pool.query('DELETE FROM linkages WHERE id = $1', [id]);
    return true;
  } catch (error) {
    console.error(`Error deleting linkage ${id}:`, error);
    throw error;
  }
};

// Get all enabled linkages
const getEnabledLinkages = async () => {
  try {
    const result = await pool.query(
      `SELECT l.*,
        sf.display_name as simplefin_display_name,
        sf.identifier as simplefin_identifier,
        m.display_name as maybe_display_name,
        m.identifier as maybe_identifier,
        m.accountable_type as maybe_account_type
       FROM linkages l
       JOIN accounts sf ON l.simplefin_account_id = sf.id
       JOIN accounts m ON l.maybe_account_id = m.id
       WHERE l.enabled = true
       ORDER BY l.created_at`
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting enabled linkages:', error);
    throw error;
  }
};

module.exports = {
  createLinkage,
  getAllLinkages,
  getLinkageById,
  updateLinkageStatus,
  updateSyncStatus,
  updateLastSync,
  setLinkageError,
  deleteLinkage,
  getEnabledLinkages
};