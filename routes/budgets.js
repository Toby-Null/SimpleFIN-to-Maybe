const express = require('express');
const router = express.Router();
const {
  getBudgetStatusPage,
  runBudgetCheck,
  createCurrentMonthBudget,
  updateBudgetCategory,
  getBudgetCategories
} = require('../controllers/budgetNotificationsController');

// Get budget status page
router.get('/status', getBudgetStatusPage);

// Run budget check manually
router.post('/check', runBudgetCheck);

// Create a new budget for the current month
router.post('/create-current', createCurrentMonthBudget);

// Update budget category spending amount
router.post('/categories/:budgetCategoryId', updateBudgetCategory);

// Get all budget categories for the current budget (AJAX endpoint)
router.get('/categories', getBudgetCategories);

module.exports = router;