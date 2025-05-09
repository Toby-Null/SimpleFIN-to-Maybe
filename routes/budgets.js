const express = require('express');
const router = express.Router();
const {
  getBudgetStatusPage,
  runBudgetCheck,
  createCurrentMonthBudget,
  syncBudgetsFromMaybe,
  deleteAllBudgetData
} = require('../controllers/budgetNotificationsController');

// Get budget status page
router.get('/status', getBudgetStatusPage);

// Run budget check manually
router.post('/check', runBudgetCheck);

// Create a new budget for the current month
router.post('/create', createCurrentMonthBudget);

// Sync budgets from Maybe
router.post('/sync', syncBudgetsFromMaybe);

// Delete all budget data for testing
router.post('/delete-all', deleteAllBudgetData);

module.exports = router;