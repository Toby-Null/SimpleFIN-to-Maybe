const { 
  createRule, 
  addRuleCondition, 
  addRuleAction,
  getAllRules,
  getRuleById,
  updateRule,
  deleteRuleCondition,
  deleteRuleAction,
  deleteRule
} = require('../models/rule');
const { getAllCategories } = require('../models/category');
const { pool } = require('../config/database');

// Helper function to display operator in a readable format
const getOperatorDisplay = (operator) => {
  switch (operator) {
    case 'contains':
    case 'like':
      return 'contains';
    case '=':
    case 'equals':
      return 'equals';
    case '>':
    case 'greater_than':
      return 'is greater than';
    case '>=':
    case 'greater_than_or_equal':
      return 'is greater than or equal to';
    case '<':
    case 'less_than':
      return 'is less than';
    case '<=':
    case 'less_than_or_equal':
      return 'is less than or equal to';
    default:
      return operator;
  }
}

// Get all rules
const getRules = async (req, res) => {
  try {
    const rules = await getAllRules();
    
    res.render('rules/index', {
      title: 'Transaction Rules',
      rules,
      getOperatorDisplay
    });
  } catch (error) {
    console.error('Error getting rules:', error);
    req.flash('error_msg', `Error getting rules: ${error.message}`);
    res.redirect('/');
  }
};

// Show create rule form
const showCreateRuleForm = async (req, res) => {
  try {
    const categories = await getAllCategories();
    
    res.render('rules/create', {
      title: 'Create Rule',
      categories
    });
  } catch (error) {
    console.error('Error showing create rule form:', error);
    req.flash('error_msg', `Error: ${error.message}`);
    res.redirect('/rules');
  }
};

// Create a new rule
const createNewRule = async (req, res) => {
  try {
    const { name, enabled, conditions, actions } = req.body;
    
    // Create the rule
    const rule = await createRule(name, enabled === 'on');
    
    // Add conditions
    if (conditions) {
      const conditionsArray = Array.isArray(conditions) ? conditions : [conditions];
      
      for (const condition of conditionsArray) {
        const { field, operator, value } = condition;
        await addRuleCondition(rule.id, field, operator, value);
      }
    }
    
    // Add actions
    if (actions) {
      const actionsArray = Array.isArray(actions) ? actions : [actions];
      
      for (const action of actionsArray) {
        const { type, value } = action;
        await addRuleAction(rule.id, type, value);
      }
    }
    
    req.flash('success_msg', 'Rule created successfully');
    res.redirect('/rules');
  } catch (error) {
    console.error('Error creating rule:', error);
    req.flash('error_msg', `Error creating rule: ${error.message}`);
    res.redirect('/rules/create');
  }
};

// Show edit rule form
const showEditRuleForm = async (req, res) => {
  try {
    const { id } = req.params;
    const rule = await getRuleById(id);
    const categories = await getAllCategories();
    
    if (!rule) {
      req.flash('error_msg', 'Rule not found');
      return res.redirect('/rules');
    }
    
    res.render('rules/edit', {
      title: 'Edit Rule',
      rule,
      categories
    });
  } catch (error) {
    console.error(`Error showing edit rule form for ${req.params.id}:`, error);
    req.flash('error_msg', `Error: ${error.message}`);
    res.redirect('/rules');
  }
};

// Update a rule
const updateExistingRule = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, enabled, conditions, actions, deletedConditionIds, deletedActionIds } = req.body;
    
    // Update the rule
    await updateRule(id, name, enabled === 'on');
    
    // Handle deleted conditions
    if (deletedConditionIds) {
      const conditionIdsToDelete = Array.isArray(deletedConditionIds) ? deletedConditionIds : [deletedConditionIds];
      for (const conditionId of conditionIdsToDelete) {
        if (conditionId && conditionId.trim() !== '') {
          await deleteRuleCondition(conditionId);
        }
      }
    }
    
    // Handle deleted actions
    if (deletedActionIds) {
      const actionIdsToDelete = Array.isArray(deletedActionIds) ? deletedActionIds : [deletedActionIds];
      for (const actionId of actionIdsToDelete) {
        if (actionId && actionId.trim() !== '') {
          await deleteRuleAction(actionId);
        }
      }
    }
    
    // Process conditions
    if (conditions) {
      const conditionsArray = Array.isArray(conditions) ? conditions : [conditions];
      
      for (const condition of conditionsArray) {
        const { id: conditionId, field, operator, value } = condition;
        
        if (!field || !operator) {
          console.log('Skipping condition with missing required fields:', condition);
          continue;
        }
        
        if (conditionId) {
          // Update existing condition
          await pool.query(
            `UPDATE rule_conditions 
             SET field = $1, operator = $2, value = $3, updated_at = NOW()
             WHERE id = $4`,
            [field, operator, value || '', conditionId]
          );
        } else {
          await addRuleCondition(id, field, operator, value || '');
        }
      }
    }
    
    // Process actions
    if (actions) {
      const actionsArray = Array.isArray(actions) ? actions : [actions];
      
      for (const action of actionsArray) {
        const { id: actionId, type, value } = action;
        
        if (!type) {
          console.log('Skipping action with missing required fields:', action);
          continue;
        }
        
        if (actionId) {
          // Update existing action
          await pool.query(
            `UPDATE rule_actions
             SET action_type = $1, action_value = $2, updated_at = NOW()
             WHERE id = $3`,
            [type, value || '', actionId]
          );
        } else {
          await addRuleAction(id, type, value || '');
        }
      }
    }
    
    req.flash('success_msg', 'Rule updated successfully');
    res.redirect('/rules');
  } catch (error) {
    console.error(`Error updating rule ${req.params.id}:`, error);
    req.flash('error_msg', `Error updating rule: ${error.message}`);
    res.redirect(`/rules/${req.params.id}/edit`);
  }
};

// Delete a rule condition
const removeRuleCondition = async (req, res) => {
  try {
    const { id, conditionId } = req.params;
    
    await deleteRuleCondition(conditionId);
    
    req.flash('success_msg', 'Rule condition deleted successfully');
    res.redirect(`/rules/${id}/edit`);
  } catch (error) {
    console.error(`Error deleting rule condition ${req.params.conditionId}:`, error);
    req.flash('error_msg', `Error deleting rule condition: ${error.message}`);
    res.redirect(`/rules/${req.params.id}/edit`);
  }
};

// Delete a rule action
const removeRuleAction = async (req, res) => {
  try {
    const { id, actionId } = req.params;
    
    await deleteRuleAction(actionId);
    
    req.flash('success_msg', 'Rule action deleted successfully');
    res.redirect(`/rules/${id}/edit`);
  } catch (error) {
    console.error(`Error deleting rule action ${req.params.actionId}:`, error);
    req.flash('error_msg', `Error deleting rule action: ${error.message}`);
    res.redirect(`/rules/${req.params.id}/edit`);
  }
};

// Delete a rule
const removeRule = async (req, res) => {
  try {
    const { id } = req.params;
    
    await deleteRule(id);
    
    req.flash('success_msg', 'Rule deleted successfully');
    res.redirect('/rules');
  } catch (error) {
    console.error(`Error deleting rule ${req.params.id}:`, error);
    req.flash('error_msg', `Error deleting rule: ${error.message}`);
    res.redirect('/rules');
  }
};

// Toggle rule status (enabled/disabled)
const toggleRuleStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;
    
    // Convert string "true"/"false" to boolean
    const enabledBool = enabled === 'true';
    
    await updateRule(id, null, enabledBool);
    
    req.flash('success_msg', `Rule ${enabledBool ? 'enabled' : 'disabled'} successfully`);
    res.redirect('/rules');
  } catch (error) {
    console.error(`Error toggling rule status ${req.params.id}:`, error);
    req.flash('error_msg', `Error updating rule status: ${error.message}`);
    res.redirect('/rules');
  }
};

module.exports = {
  getRules,
  showCreateRuleForm,
  createNewRule,
  showEditRuleForm,
  updateExistingRule,
  removeRuleCondition,
  removeRuleAction,
  removeRule,
  toggleRuleStatus
};