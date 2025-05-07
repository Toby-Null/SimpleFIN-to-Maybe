const express = require('express');
const router = express.Router();
const {
  getRules,
  showCreateRuleForm,
  createNewRule,
  showEditRuleForm,
  updateExistingRule,
  removeRuleCondition,
  removeRuleAction,
  removeRule,
  toggleRuleStatus
} = require('../controllers/rulesController');

// Get all rules
router.get('/', getRules);

// Show create rule form
router.get('/create', showCreateRuleForm);

// Create a new rule
router.post('/', createNewRule);

// Show edit rule form
router.get('/:id/edit', showEditRuleForm);

// Update a rule
router.post('/:id/update', updateExistingRule);

// Toggle rule enabled/disabled status
router.post('/:id/toggle', toggleRuleStatus);

// Delete a rule condition
router.post('/:id/conditions/:conditionId/delete', removeRuleCondition);

// Delete a rule action
router.post('/:id/actions/:actionId/delete', removeRuleAction);

// Delete a rule
router.post('/:id/delete', removeRule);

module.exports = router;