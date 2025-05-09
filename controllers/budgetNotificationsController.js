const { getBudgetStatus, checkBudgets } = require('../services/budgetNotificationService');
const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

// Get budget status and notifications
const getBudgetStatusPage = async (req, res) => {
  try {
    const date = req.query.date ? new Date(req.query.date) : new Date();
    const budgetStatus = await getBudgetStatus(date);
    
    res.render('budgets/status', {
      title: 'Budget Status',
      budgetStatus,
      date
    });
  } catch (error) {
    console.error('Error getting budget status:', error);
    req.flash('error_msg', `Error getting budget status: ${error.message}`);
    res.redirect('/');
  }
};

// Run budget check manually
const runBudgetCheck = async (req, res) => {
  try {
    const budgetNotifications = await checkBudgets();
    
    if (budgetNotifications.length > 0) {
      req.flash('success_msg', `Sent ${budgetNotifications.length} budget exceeded notifications`);
    } else {
      req.flash('info_msg', 'No budget thresholds exceeded.');
    }
    
    res.redirect('/budgets/status');
  } catch (error) {
    console.error('Error running budget check:', error);
    req.flash('error_msg', `Error running budget check: ${error.message}`);
    res.redirect('/budgets/status');
  }
};

// Create a new budget for the current month
const createCurrentMonthBudget = async (req, res) => {
  try {
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    const existingBudgetResult = await pool.query(`
      SELECT id FROM budgets 
      WHERE start_date <= $1 AND end_date >= $1
    `, [startDateStr]);
    
    if (existingBudgetResult.rows.length > 0) {
      req.flash('info_msg', 'A budget already exists for the current month.');
      return res.redirect('/budgets/status');
    }
    
    const budgetId = uuidv4();
    
    try {
      const columnInfoResult = await pool.query(`
        SELECT is_nullable 
        FROM information_schema.columns 
        WHERE table_name = 'budgets' AND column_name = 'family_id'
      `);
      
      const isNullable = columnInfoResult.rows.length > 0 ? 
                          columnInfoResult.rows[0].is_nullable === 'YES' : 
                          false;
      
      if (!isNullable) {
        await pool.query(`
          ALTER TABLE budgets ALTER COLUMN family_id DROP NOT NULL
        `);
      }
    } catch (alterError) {
      console.error('Error checking/altering table structure:', alterError);
    }
    
    await pool.query(`
      INSERT INTO budgets 
      (id, family_id, start_date, end_date, currency, created_at, updated_at)
      VALUES ($1, NULL, $2, $3, 'USD', NOW(), NOW())
    `, [budgetId, startDateStr, endDateStr]);
    
    try {
      const categoriesResult = await pool.query(`
        SELECT id FROM categories
      `);
      
      // Create budget categories with zero spending
      for (const category of categoriesResult.rows) {
        await pool.query(`
          INSERT INTO budget_categories
          (id, budget_id, category_id, budgeted_spending, currency, created_at, updated_at)
          VALUES ($1, $2, $3, 0, 'USD', NOW(), NOW())
        `, [uuidv4(), budgetId, category.id]);
      }
    } catch (categoryError) {
      console.error('Error creating budget categories:', categoryError);
      // Continue anyway - at least we created the budget
    }
    
    req.flash('success_msg', `Budget created for ${startDate.toLocaleString('default', { month: 'long', year: 'numeric' })}. Please set category spending limits.`);
    res.redirect('/budgets/status');
  } catch (error) {
    console.error('Error creating budget:', error);
    req.flash('error_msg', `Error creating budget: ${error.message}`);
    res.redirect('/budgets/status');
  }
};

// Update budget category spending amount
const updateBudgetCategory = async (req, res) => {
  try {
    const { budgetCategoryId } = req.params;
    const { budgetedSpending } = req.body;
    
    // Validate budgeted spending
    if (isNaN(budgetedSpending) || parseFloat(budgetedSpending) < 0) {
      req.flash('error_msg', 'Budget amount must be a valid positive number.');
      return res.redirect('/budgets/status');
    }
    
    // Update the budget category
    await pool.query(`
      UPDATE budget_categories
      SET budgeted_spending = $1, updated_at = NOW()
      WHERE id = $2
    `, [budgetedSpending, budgetCategoryId]);
    
    req.flash('success_msg', 'Budget category updated successfully.');
    res.redirect('/budgets/status');
  } catch (error) {
    console.error('Error updating budget category:', error);
    req.flash('error_msg', `Error updating budget category: ${error.message}`);
    res.redirect('/budgets/status');
  }
};

// Get all budget categories for the current budget
const getBudgetCategories = async (req, res) => {
  try {
    const date = req.query.date ? new Date(req.query.date) : new Date();
    const currentDate = date.toISOString().split('T')[0];
    
    // Get active budget for the date
    const budgetResult = await pool.query(`
      SELECT id FROM budgets WHERE start_date <= $1 AND end_date >= $1
    `, [currentDate]);
    
    if (budgetResult.rows.length === 0) {
      return res.json({ 
        success: false,
        message: 'No active budget found for this month.' 
      });
    }
    
    const budgetId = budgetResult.rows[0].id;
    
    // Get all budget categories with category info
    const categoriesResult = await pool.query(`
      SELECT bc.id, bc.category_id, c.name as category_name, bc.budgeted_spending, bc.currency
      FROM budget_categories bc
      JOIN categories c ON bc.category_id = c.id
      WHERE bc.budget_id = $1
      ORDER BY c.name
    `, [budgetId]);
    
    res.json({ 
      success: true,
      budgetId: budgetId,
      categories: categoriesResult.rows
    });
  } catch (error) {
    console.error('Error getting budget categories:', error);
    res.status(500).json({ 
      success: false,
      message: error.message 
    });
  }
};

module.exports = {
  getBudgetStatusPage,
  runBudgetCheck,
  createCurrentMonthBudget,
  updateBudgetCategory,
  getBudgetCategories
};