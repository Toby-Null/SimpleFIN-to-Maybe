const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

// Create a new rule
const createRule = async (name, enabled = true) => {
  try {
    const result = await pool.query(
      `INSERT INTO rules
       (id, name, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING *`,
      [uuidv4(), name, enabled]
    );
    
    return result.rows[0];
  } catch (error) {
    console.error('Error creating rule:', error);
    throw error;
  }
};

// Add a condition to a rule
const addRuleCondition = async (ruleId, field, operator, value) => {
  try {
    const result = await pool.query(
      `INSERT INTO rule_conditions
       (id, rule_id, field, operator, value, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING *`,
      [uuidv4(), ruleId, field, operator, value]
    );
    
    return result.rows[0];
  } catch (error) {
    console.error('Error adding rule condition:', error);
    throw error;
  }
};

// Add an action to a rule
const addRuleAction = async (ruleId, actionType, actionValue) => {
  try {
    const result = await pool.query(
      `INSERT INTO rule_actions
       (id, rule_id, action_type, action_value, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING *`,
      [uuidv4(), ruleId, actionType, actionValue]
    );
    
    return result.rows[0];
  } catch (error) {
    console.error('Error adding rule action:', error);
    throw error;
  }
};

// Get all rules with conditions and actions
const getAllRules = async () => {
  try {
    const rules = await pool.query(
      `SELECT * FROM rules ORDER BY created_at DESC`
    );
    
    const result = [];
    
    for (const rule of rules.rows) {
      const conditions = await pool.query(
        `SELECT * FROM rule_conditions WHERE rule_id = $1::uuid ORDER BY created_at`,
        [rule.id]
      );
      
      const actions = await pool.query(
        `SELECT ra.*, 
          CASE 
            WHEN ra.action_type = 'set_transaction_category' THEN c.name 
            ELSE NULL 
          END as category_name
         FROM rule_actions ra
         LEFT JOIN categories c ON ra.action_value = c.id::text
         WHERE ra.rule_id = $1::uuid 
         ORDER BY ra.created_at`,
        [rule.id]
      );
      
      result.push({
        ...rule,
        conditions: conditions.rows,
        actions: actions.rows
      });
    }
    
    return result;
  } catch (error) {
    console.error('Error getting all rules:', error);
    throw error;
  }
};

// Get rule by ID with conditions and actions
const getRuleById = async (id) => {
  try {
    const rule = await pool.query(
      `SELECT * FROM rules WHERE id = $1`,
      [id]
    );
    
    if (rule.rows.length === 0) {
      return null;
    }
    
    const conditions = await pool.query(
      `SELECT * FROM rule_conditions WHERE rule_id = $1::uuid ORDER BY created_at`,
      [id]
    );
    
    const actions = await pool.query(
      `SELECT ra.*, 
        CASE 
          WHEN ra.action_type = 'set_transaction_category' THEN c.name 
          ELSE NULL 
        END as category_name
       FROM rule_actions ra
       LEFT JOIN categories c ON ra.action_value = c.id::text
       WHERE ra.rule_id = $1::uuid 
       ORDER BY ra.created_at`,
      [id]
    );
    
    return {
      ...rule.rows[0],
      conditions: conditions.rows,
      actions: actions.rows
    };
  } catch (error) {
    console.error(`Error getting rule by ID ${id}:`, error);
    throw error;
  }
};

// Update rule
const updateRule = async (id, name, enabled) => {
  try {
    let updateFields = [];
    let queryParams = [];
    let paramIndex = 1;
    
    if (name !== null && name !== undefined) {
      updateFields.push(`name = $${paramIndex}`);
      queryParams.push(name);
      paramIndex++;
    }
    
    if (enabled !== null && enabled !== undefined) {
      updateFields.push(`enabled = $${paramIndex}`);
      queryParams.push(enabled);
      paramIndex++;
    }
    
    updateFields.push(`updated_at = NOW()`);
    queryParams.push(id);
    
    const query = `
      UPDATE rules
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    
    const result = await pool.query(query, queryParams);
    
    return result.rows[0];
  } catch (error) {
    console.error(`Error updating rule ${id}:`, error);
    throw error;
  }
};

// Delete rule condition
const deleteRuleCondition = async (id) => {
  try {
    await pool.query('DELETE FROM rule_conditions WHERE id = $1', [id]);
    return true;
  } catch (error) {
    console.error(`Error deleting rule condition ${id}:`, error);
    throw error;
  }
};

// Delete rule action
const deleteRuleAction = async (id) => {
  try {
    await pool.query('DELETE FROM rule_actions WHERE id = $1', [id]);
    return true;
  } catch (error) {
    console.error(`Error deleting rule action ${id}:`, error);
    throw error;
  }
};

// Delete rule with all conditions and actions
const deleteRule = async (id) => {
  try {
    // Start a transaction
    await pool.query('BEGIN');
    
    // Delete rule conditions
    await pool.query('DELETE FROM rule_conditions WHERE rule_id = $1', [id]);
    
    // Delete rule actions
    await pool.query('DELETE FROM rule_actions WHERE rule_id = $1', [id]);
    
    // Delete the rule itself
    await pool.query('DELETE FROM rules WHERE id = $1', [id]);
    
    // Commit the transaction
    await pool.query('COMMIT');
    
    return true;
  } catch (error) {
    // Rollback in case of error
    await pool.query('ROLLBACK');
    console.error(`Error deleting rule ${id}:`, error);
    throw error;
  }
};

// Apply rules to a transaction
const applyRulesToTransaction = async (transaction) => {
  try {
    const rules = await getAllRules();
    let appliedRules = [];
    
    for (const rule of rules) {
      if (!rule.enabled) continue;
      
      let conditionsMet = true;
      
      for (const condition of rule.conditions) {
        if (!evaluateCondition(transaction, condition)) {
          conditionsMet = false;
          break;
        }
      }
      
      if (conditionsMet && rule.actions.length > 0) {
        const appliedActions = [];
        
        for (const action of rule.actions) {
          const applied = await applyAction(transaction, action);
          if (applied) {
            appliedActions.push(action);
          }
        }
        
        if (appliedActions.length > 0) {
          appliedRules.push({
            rule,
            appliedActions
          });
        }
      }
    }
    
    return appliedRules;
  } catch (error) {
    console.error('Error applying rules to transaction:', error);
    throw error;
  }
};

// Helper function to evaluate a condition against a transaction
const evaluateCondition = (transaction, condition) => {
  const { field, operator, value } = condition;
  
  let fieldValue;
  if (field === 'transaction_name') {
    fieldValue = transaction.name || transaction.description || '';
  } else if (field === 'transaction_amount') {
    fieldValue = parseFloat(transaction.amount) || 0;
  } else {
    return false;
  }
  
  // Compare using the specified operator
  switch (operator) {
    case 'contains':
      return typeof fieldValue === 'string' && fieldValue.toLowerCase().includes(value.toLowerCase());
    case '=':
    case 'equals':
      if (field === 'transaction_amount') {
        return fieldValue === parseFloat(value);
      }
      return fieldValue.toLowerCase() === value.toLowerCase();
    case 'like':
      return typeof fieldValue === 'string' && fieldValue.toLowerCase().includes(value.toLowerCase());
    case '>':
    case 'greater_than':
      return fieldValue > parseFloat(value);
    case '>=':
    case 'greater_than_or_equal':
      return fieldValue >= parseFloat(value);
    case '<':
    case 'less_than':
      return fieldValue < parseFloat(value);
    case '<=':
    case 'less_than_or_equal':
      return fieldValue <= parseFloat(value);
    default:
      return false;
  }
};

// Helper function to apply an action to a transaction
const applyAction = async (transaction, action) => {
  const { action_type, action_value } = action;
  
  try {
    if (action_type === 'set_transaction_category') {
      transaction.category_id = action_value;
      return true;
    } else if (action_type === 'add_tag') {
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`Error applying action ${action_type}:`, error);
    return false;
  }
};

module.exports = {
  createRule,
  addRuleCondition,
  addRuleAction,
  getAllRules,
  getRuleById,
  updateRule,
  deleteRuleCondition,
  deleteRuleAction,
  deleteRule,
  applyRulesToTransaction
};