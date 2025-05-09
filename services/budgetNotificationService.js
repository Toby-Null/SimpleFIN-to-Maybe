const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { sendNotification } = require('../models/notification');
const { getMaybeDbConnection } = require('../config/database');

/**
 * Checks budget categories and sends notifications for exceeded budgets
 * @param {Date} syncDate Date to check budgets for (defaults to current date)
 * @returns {Promise<Array>} Array of notifications sent
 */
const checkBudgets = async (syncDate = new Date()) => {
  let maybeDB = null;
  
  try {
    // Calculate month date range
    const currentMonth = new Date(syncDate.getFullYear(), syncDate.getMonth(), 1);
    const currentMonthStr = currentMonth.toISOString().split('T')[0];
    
    const monthEnd = new Date(currentMonth);
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    monthEnd.setDate(0); // Last day of the month
    const monthEndStr = monthEnd.toISOString().split('T')[0];
    
    console.log(`Checking budgets for month: ${currentMonthStr} to ${monthEndStr}`);
    
    // Connect to the Maybe database
    maybeDB = await getMaybeDbConnection();
    
    const entriesQuery = `
      SELECT entryable_id as transaction_id, amount, date
      FROM entries
      WHERE entryable_type = 'Transaction'
      AND date >= $1 AND date <= $2
    `;
    
    const entriesResult = await maybeDB.query(entriesQuery, [currentMonthStr, monthEndStr]);
    
    if (entriesResult.rows.length === 0) {
      console.log(`No entries found in the date range ${currentMonthStr} to ${monthEndStr}`);
      return [];
    }
    
    const transactionIds = entriesResult.rows.map(row => row.transaction_id);
    
    const transactionAmounts = new Map();
    entriesResult.rows.forEach(row => {
      transactionAmounts.set(row.transaction_id, Math.abs(parseFloat(row.amount)));
    });
    
    const transactionCategoriesQuery = `
      SELECT id as transaction_id, category_id
      FROM transactions
      WHERE id = ANY($1)
      AND category_id IS NOT NULL
    `;
    
    const transactionCategoriesResult = await maybeDB.query(transactionCategoriesQuery, [transactionIds]);
    
    const spendingByCategory = new Map();
    
    transactionCategoriesResult.rows.forEach(row => {
      const categoryId = row.category_id;
      const amount = transactionAmounts.get(row.transaction_id) || 0;
      
      if (categoryId) {
        const currentTotal = spendingByCategory.get(categoryId) || 0;
        spendingByCategory.set(categoryId, currentTotal + amount);
      }
    });
    
    const notificationsQuery = `
      SELECT id, budget_id, category_id, notification_sent, budget_amount
      FROM budget_notifications
      WHERE month = $1
    `;
    
    const notificationsResult = await pool.query(notificationsQuery, [currentMonthStr]);
    
    if (notificationsResult.rows.length === 0) {
      console.log(`No budget notifications found for current month ${currentMonthStr}`);
      return [];
    }
    
    const notificationPromises = [];
    
    for (const notification of notificationsResult.rows) {
      const budgetAmount = parseFloat(notification.budget_amount);
      
      const spentAmount = spendingByCategory.get(notification.category_id) || 0;
      
      await pool.query(`
        UPDATE budget_notifications
        SET spent_amount = $1, updated_at = NOW()
        WHERE id = $2
      `, [spentAmount, notification.id]);
      
      const isBudgetExceeded = spentAmount > budgetAmount;
      
      if (isBudgetExceeded && !notification.notification_sent) {
        notificationPromises.push(
          (async () => {
            const categoryQuery = `
              SELECT name as category_name
              FROM categories
              WHERE id = $1
            `;
            
            const categoryResult = await maybeDB.query(categoryQuery, [notification.category_id]);
            const categoryName = categoryResult.rows.length > 0 ? 
              categoryResult.rows[0].category_name : 'Unknown Category';
            
            await pool.query(`
              UPDATE budget_notifications
              SET notification_sent = true, sent_at = NOW()
              WHERE id = $1
            `, [notification.id]);
            
            await sendBudgetNotification(notification.budget_id, {
              category_id: notification.category_id,
              category_name: categoryName
            }, currentMonth, budgetAmount, spentAmount);
            
            return {
              id: notification.id,
              category: categoryName,
              budget: budgetAmount,
              spent: spentAmount,
              percent: Math.round((spentAmount / budgetAmount) * 100)
            };
          })()
        );
      }
    }
    
    const notificationsSent = await Promise.all(notificationPromises);
    
    return notificationsSent.filter(Boolean);
    
  } catch (error) {
    console.error('Error checking budgets:', error);
    throw error;
  } finally {
    if (maybeDB) {
      try {
        await maybeDB.end();
      } catch (err) {
        console.error('Error closing Maybe DB connection:', err);
      }
    }
  }
};

/**
 * Send notification for budget exceeded
 */
const sendBudgetNotification = async (budgetId, category, currentMonth, budgetAmount, spentAmount) => {
  try {
    const percentOver = Math.round((spentAmount - budgetAmount) / budgetAmount * 100);
    
    await sendNotification('budget_exceeded', {
      budget_id: budgetId,
      category_id: category.category_id,
      category_name: category.category_name,
      month: currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' }),
      budget_amount: budgetAmount.toFixed(2),
      spent_amount: spentAmount.toFixed(2),
      amount_over: (spentAmount - budgetAmount).toFixed(2),
      percent_over: percentOver,
      message: `Budget Alert: You've exceeded your ${category.category_name} budget for ${currentMonth.toLocaleString('default', { month: 'long' })} by ${percentOver}%`,
      timestamp: new Date().toISOString()
    });
    
    return true;
  } catch (error) {
    console.error('Error sending budget notification:', error);
    return false;
  }
};

/**
 * Get budget status summary for all categories
 * @param {Date} date
 * @param {boolean} saveNotifications Whether to save notifications (default: false)
 * @returns {Promise<Object>}
 */
const getBudgetStatus = async (date = new Date(), saveNotifications = false) => {
  let maybeDB = null;
  
  try {
    // Setup date range for current month
    const currentMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const currentMonthStr = currentMonth.toISOString().split('T')[0];
    
    const monthStart = new Date(currentMonth);
    const monthEnd = new Date(currentMonth);
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    monthEnd.setDate(0); // Last day of the month
    
    const monthStartStr = monthStart.toISOString().split('T')[0];
    const monthEndStr = monthEnd.toISOString().split('T')[0];
    
    console.log(`Getting budget status for period: ${monthStartStr} to ${monthEndStr}`);
    
    maybeDB = await getMaybeDbConnection();
    
    console.log('Connected to Maybe database');
    
    const budgetQuery = `
      SELECT id, start_date, end_date 
      FROM budgets 
      WHERE start_date <= $1 AND end_date >= $1
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    
    const budgetResult = await maybeDB.query(budgetQuery, [currentMonthStr]);
    
    if (budgetResult.rows.length === 0) {
      console.log('No active budget found in Maybe for this month');
      return { 
        status: 'no_budget',
        message: 'No active budget found for current month' 
      };
    }
    
    const budget = budgetResult.rows[0];
    console.log(`Found active budget ID: ${budget.id}`);
    
    const schemaResult = await maybeDB.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'categories' 
      AND column_name = 'classification'
    `);
    
    let categoriesQuery;
    
    if (schemaResult.rows.length > 0) {
      console.log('Using classification-aware query');
      categoriesQuery = `
        SELECT 
          bc.id, bc.category_id, c.name as category_name, 
          bc.budgeted_spending, c.classification, bc.updated_at
        FROM budget_categories bc
        JOIN categories c ON bc.category_id = c.id
        WHERE bc.budget_id = $1
        AND c.classification = 'expense'
      `;
    } else {
      console.log('Using classification-agnostic query');
      categoriesQuery = `
        SELECT 
          bc.id, bc.category_id, c.name as category_name, 
          bc.budgeted_spending, bc.updated_at
        FROM budget_categories bc
        JOIN categories c ON bc.category_id = c.id
        WHERE bc.budget_id = $1
      `;
    }
    
    const categoriesResult = await maybeDB.query(categoriesQuery, [budget.id]);
    console.log(`Found ${categoriesResult.rows.length} budget categories`);
    
    if (categoriesResult.rows.length > 0) {
      console.log('First 3 categories with budget amounts:');
      categoriesResult.rows.slice(0, 3).forEach(cat => {
        console.log(`- ${cat.category_name}: $${parseFloat(cat.budgeted_spending || 0).toFixed(2)}, Updated: ${cat.updated_at}`);
      });
    }
    
    const entriesTable = 'public.entries';
    const transactionsTable = 'public.transactions';
    
    const spendingByCategory = new Map();
    
    const spendingQuery = `
      SELECT t.category_id, SUM(ABS(e.amount)) as total_spent
      FROM ${entriesTable} e
      JOIN ${transactionsTable} t ON e.entryable_id = t.id
      WHERE e.date >= $1 AND e.date <= $2
      AND e.amount < 0
      AND t.category_id IS NOT NULL
      GROUP BY t.category_id
    `;
    
    const spendingResult = await maybeDB.query(spendingQuery, [monthStartStr, monthEndStr]);
    
    spendingResult.rows.forEach(row => {
      spendingByCategory.set(row.category_id, parseFloat(row.total_spent || 0));
    });
    
    let totalBudget = 0;
    let totalSpent = 0;
    
    const categories = categoriesResult.rows.map(category => {
      const budgetAmount = parseFloat(category.budgeted_spending || 0);
      totalBudget += budgetAmount;
      
      const spentAmount = spendingByCategory.get(category.category_id) || 0;
      totalSpent += spentAmount;
      
      const percentUsed = budgetAmount > 0 ? Math.round((spentAmount / budgetAmount) * 100) : 0;
      
      if (saveNotifications) {
        updateBudgetNotificationRecord(
          budget.id, 
          category.category_id, 
          currentMonthStr, 
          budgetAmount, 
          spentAmount
        );
      }
      
      return {
        category_id: category.category_id,
        category_name: category.category_name,
        budget_amount: budgetAmount.toFixed(2),
        spent_amount: spentAmount.toFixed(2),
        percent_used: percentUsed,
        is_exceeded: budgetAmount > 0 && spentAmount > budgetAmount,
        notification_sent: false
      };
    });
    
    console.log(`Processed ${categories.length} categories with total budget: $${totalBudget.toFixed(2)}`);
    
    console.log(`Budget status: Success. Found ${categories.length} categories`);
    console.log(`Total budget: $${totalBudget.toFixed(2)}`);
    console.log(`Sample categories:`);
    categories.slice(0, 3).forEach(cat => {
      console.log(`${cat.category_name}: Budget $${cat.budget_amount}, Spent $${cat.spent_amount}`);
    });
    
    return {
      status: 'success',
      month: currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' }),
      budget_id: budget.id,
      total_budget: totalBudget.toFixed(2),
      total_spent: totalSpent.toFixed(2),
      categories: categories
    };
    
  } catch (error) {
    console.error('Error getting budget status:', error);
    throw error;
  } finally {
    if (maybeDB) {
      try {
        await maybeDB.end();
      } catch (error) {
        console.error('Error closing Maybe DB connection:', error);
      }
    }
  }
};

/**
 * Helper function to update or create budget notification records
 */
const updateBudgetNotificationRecord = async (budgetId, categoryId, month, budgetAmount, spentAmount) => {
  try {
    // Check if a notification record already exists
    const existingResult = await pool.query(`
      SELECT id, notification_sent
      FROM budget_notifications
      WHERE budget_id = $1 AND category_id = $2 AND month = $3
    `, [budgetId, categoryId, month]);
    
    if (existingResult.rows.length > 0) {
      // Update existing record
      await pool.query(`
        UPDATE budget_notifications
        SET budget_amount = $1, spent_amount = $2, updated_at = NOW()
        WHERE id = $3
      `, [budgetAmount, spentAmount, existingResult.rows[0].id]);
    } else {
      // Create new record
      await pool.query(`
        INSERT INTO budget_notifications 
        (id, budget_id, category_id, month, notification_sent, budget_amount, spent_amount, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      `, [
        uuidv4(), 
        budgetId, 
        categoryId, 
        month,
        false, // not sent yet
        budgetAmount,
        spentAmount
      ]);
    }
    
    return true;
  } catch (error) {
    console.error('Error updating budget notification record:', error);
    return false;
  }
};

module.exports = {
  checkBudgets,
  getBudgetStatus
};