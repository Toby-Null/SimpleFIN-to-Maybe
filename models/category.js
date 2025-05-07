const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

// Get all categories
const getAllCategories = async () => {
  try {
    const result = await pool.query(
      `SELECT * FROM categories ORDER BY name`
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting all categories:', error);
    throw error;
  }
};

// Get category by ID
const getCategoryById = async (id) => {
  try {
    const result = await pool.query(
      `SELECT * FROM categories WHERE id = $1`,
      [id]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error(`Error getting category by ID ${id}:`, error);
    throw error;
  }
};

// Get categories from Maybe DB
const getMaybeCategories = async (maybePool) => {
  try {
    const result = await maybePool.query(
      `SELECT id, name, color, parent_id, family_id FROM categories ORDER BY name`
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting Maybe categories:', error);
    throw error;
  }
};

// Create a category in local DB (for caching)
const createCategory = async (categoryData) => {
  try {
    const { id, name, maybe_id, parent_id } = categoryData;
    
    const result = await pool.query(
      `INSERT INTO categories
       (id, name, maybe_id, parent_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING *`,
      [id || uuidv4(), name, maybe_id, parent_id]
    );
    
    return result.rows[0];
  } catch (error) {
    console.error('Error creating category:', error);
    throw error;
  }
};

// Sync categories from Maybe to local DB
const syncCategoriesFromMaybe = async (maybePool) => {
  try {
    // Get categories from Maybe
    const maybeCategories = await getMaybeCategories(maybePool);
    
    // Start a transaction
    await pool.query('BEGIN');
    
    // Track how many categories were processed
    let processed = 0;
    
    // First get existing categories
    const existingCategoriesResult = await pool.query('SELECT id FROM categories');
    const existingCategoryIds = new Set(existingCategoriesResult.rows.map(row => row.id));
    
    // Process each category
    for (const category of maybeCategories) {
      try {
        if (existingCategoryIds.has(category.id)) {
          // Category exists, update it
          await pool.query(
            `UPDATE categories
             SET name = $1, maybe_id = $2, parent_id = $3, updated_at = NOW()
             WHERE id = $4`,
            [category.name, category.id, category.parent_id, category.id]
          );
        } else {
          await pool.query(
            `INSERT INTO categories
             (id, name, maybe_id, parent_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, NOW(), NOW())`,
            [category.id, category.name, category.id, category.parent_id]
          );
          
          existingCategoryIds.add(category.id);
        }
        
        processed++;
      } catch (categoryError) {
        console.log(`Skipping category ${category.id} (${category.name}) due to error:`, categoryError.message);
        continue;
      }
    }
    
    // Commit the transaction
    await pool.query('COMMIT');
    
    console.log(`Synced ${processed} of ${maybeCategories.length} categories from Maybe`);
    return processed;
  } catch (error) {
    // Rollback in case of error
    try {
      await pool.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error during rollback:', rollbackError);
    }
    
    console.error('Error syncing categories from Maybe:', error);
    throw error;
  }
};

module.exports = {
  getAllCategories,
  getCategoryById,
  getMaybeCategories,
  createCategory,
  syncCategoriesFromMaybe
};