const { getBudgetStatus, checkBudgets } = require('../services/budgetNotificationService');
const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

// Get budget status page
const getBudgetStatusPage = async (req, res) => {
  try {
    // Use local database only - don't call Maybe API
    const today = new Date();
    const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const currentMonthStr = currentMonth.toISOString().split('T')[0];
    
    // Get unique budget_ids from notifications for current month
    const budgetResult = await pool.query(`
      SELECT DISTINCT budget_id 
      FROM budget_notifications 
      WHERE month = $1
      LIMIT 1
    `, [currentMonthStr]);
    
    if (budgetResult.rows.length === 0) {
      // No budget found in local database
      return res.render('budgets/status', {
        budgetStatus: {
          status: 'no_budget',
          message: 'No active budget found for current month'
        },
        title: 'Budget Status',
        activeLink: 'budget-status'
      });
    }
    
    const budgetId = budgetResult.rows[0].budget_id;
    
    // Get category information from budget_notifications and categories tables
    const categoriesResult = await pool.query(`
      SELECT bn.category_id, c.name AS category_name, 
             bn.budget_amount, bn.spent_amount, bn.notification_sent
      FROM budget_notifications bn
      JOIN categories c ON bn.category_id = c.id
      WHERE bn.budget_id = $1 AND bn.month = $2
    `, [budgetId, currentMonthStr]);
    
    // Calculate totals
    let totalBudget = 0;
    let totalSpent = 0;
    
    // Transform data
    const categories = categoriesResult.rows.map(category => {
      const budgetAmount = parseFloat(category.budget_amount || 0);
      const spentAmount = parseFloat(category.spent_amount || 0);
      
      totalBudget += budgetAmount;
      totalSpent += spentAmount;
      
      const percentUsed = budgetAmount > 0 
        ? Math.round((spentAmount / budgetAmount) * 100) 
        : 0;
      
      const isExceeded = spentAmount > budgetAmount;
      
      return {
        category_id: category.category_id,
        category_name: category.category_name,
        budget_amount: budgetAmount.toFixed(2),
        budget_amount_numeric: budgetAmount, // For sorting
        spent_amount: spentAmount.toFixed(2),
        spent_amount_numeric: spentAmount, // For sorting
        percent_used: percentUsed,
        is_exceeded: isExceeded,
        notification_sent: category.notification_sent || false
      };
    });
    
    // Default to 'name_asc' if no sort parameter is provided
    // Change this to 'budget_desc' if you want budget to be the default sort
    const sortBy = req.query.sort || 'budget_desc';
    
    // Apply sorting
    if (sortBy === 'budget_desc') {
      // Sort by budget amount (descending), then by name
      categories.sort((a, b) => {
        // First sort by budget amount (descending)
        if (b.budget_amount_numeric !== a.budget_amount_numeric) {
          return b.budget_amount_numeric - a.budget_amount_numeric;
        }
        // If budget amounts are the same, sort by name
        return a.category_name.localeCompare(b.category_name);
      });
    } else if (sortBy === 'budget_asc') {
      // Sort by budget amount (ascending), then by name
      categories.sort((a, b) => {
        // First sort by budget amount (ascending)
        if (a.budget_amount_numeric !== b.budget_amount_numeric) {
          return a.budget_amount_numeric - b.budget_amount_numeric;
        }
        // If budget amounts are the same, sort by name
        return a.category_name.localeCompare(b.category_name);
      });
    } else {
      // Default to sorting by name (alphabetical)
      categories.sort((a, b) => a.category_name.localeCompare(b.category_name));
    }
    
    // Format month name
    const monthName = currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });
    
    // Construct the same response structure as getBudgetStatus
    const budgetStatus = {
      status: 'success',
      month: monthName,
      budget_id: budgetId,
      total_budget: totalBudget.toFixed(2),
      total_spent: totalSpent.toFixed(2),
      categories: categories,
      currentSort: sortBy
    };
    
    // Add logging to see what's being sent to the view
    console.log(`Total categories after sorting: ${categories.length}`);
    if (categories.length > 0) {
      categories.slice(0, 3).forEach(cat => {
      });
    }
    
    res.render('budgets/status', {
      budgetStatus,
      title: 'Budget Status',
      activeLink: 'budget-status'
    });
  } catch (error) {
    console.error('Error getting budget status page:', error);
    req.flash('error_msg', `Error retrieving budget status: ${error.message}`);
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
        const budgetStatus = await getBudgetStatus(new Date(), true);
        
        // Make sure categories are properly sorted
        if (budgetStatus.categories) {
          // Sort by name for better readability
          budgetStatus.categories.sort((a, b) => a.category_name.localeCompare(b.category_name));
        }
        
        // Use redirect instead of directly rendering the view
        req.flash('success_msg', `Successfully created budget for ${budgetStatus.month}`);
        res.redirect('/budgets/status');
    } catch (error) {
        console.error('Error creating budget for current month:', error);
        req.flash('error_msg', `Error retrieving budget status: ${error.message}`);
        res.redirect('/');
    }
};

// Sync budgets from Maybe
const syncBudgetsFromMaybe = async (req, res) => {
  try {
    console.log('Starting budget sync from Maybe...');
    
    // Run getBudgetStatus with saveNotifications=true to save the data
    const budgetStatus = await getBudgetStatus(new Date(), true);
    
    if (budgetStatus.status !== 'success') {
      req.flash('error_msg', 'No budget found in Maybe for the current month.');
      return res.redirect('/budgets/status');
    }
    
    console.log(`Successfully synced budget and ${budgetStatus.categories.length} categories.`);
    req.flash('success_msg', `Successfully synced budget for ${budgetStatus.month} with ${budgetStatus.categories.length} categories.`);
    
    return res.redirect('/budgets/status');
  } catch (error) {
    console.error('Error syncing budgets from Maybe:', error);
    req.flash('error_msg', `Error syncing budgets: ${error.message}`);
    return res.redirect('/budgets/status');
  }
};

// Delete all budget data for testing
const deleteAllBudgetData = async (req, res) => {
  try {
    // Delete all budget notifications
    await pool.query(`DELETE FROM budget_notifications`);
    
    console.log('Successfully deleted all budget data for testing');
    req.flash('success_msg', 'Successfully deleted all budget data. You can now start fresh.');
    res.redirect('/budgets/status');
  } catch (error) {
    console.error('Error deleting budget data:', error);
    req.flash('error_msg', `Error deleting budget data: ${error.message}`);
    res.redirect('/budgets/status');
  }
};

module.exports = {
  getBudgetStatusPage,
  runBudgetCheck,
  createCurrentMonthBudget,
  syncBudgetsFromMaybe,
  deleteAllBudgetData
};