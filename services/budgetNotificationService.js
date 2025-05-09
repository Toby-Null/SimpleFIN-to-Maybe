const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { sendNotification } = require('../models/notification');

/**
 * @param {Date} syncDate 
 * @returns {Promise<Array>}
 */
const checkBudgets = async (syncDate = new Date()) => {
  try {
    // Get the first day of the current month
    const currentMonth = new Date(syncDate.getFullYear(), syncDate.getMonth(), 1);
    
    // Format dates for SQL
    const currentMonthStr = currentMonth.toISOString().split('T')[0];
    
    console.log(`Checking budgets for month: ${currentMonthStr}`);
    
    // Get active budget for current month
    try {
      const budgetResult = await pool.query(`
        SELECT id 
        FROM budgets 
        WHERE start_date <= $1 AND end_date >= $1
      `, [currentMonthStr]);
      
      if (budgetResult.rows.length === 0) {
        console.log('No active budget found for current month');
        return [];
      }
      
      const budget = budgetResult.rows[0];
      console.log(`Found active budget: ${budget.id}`);
      
      // Check for any budget categories with budgeted spending
      const budgetCategoriesResult = await pool.query(`
        SELECT bc.id, bc.category_id, c.name as category_name, bc.budgeted_spending
        FROM budget_categories bc
        JOIN categories c ON bc.category_id = c.id
        WHERE bc.budget_id = $1 AND bc.budgeted_spending > 0
      `, [budget.id]);
      
      if (budgetCategoriesResult.rows.length === 0) {
        console.log('No budget categories with spending limits found');
        return [];
      }
      
      console.log(`Found ${budgetCategoriesResult.rows.length} budget categories with spending limits`);
      
      const notificationsSent = [];
      
      for (const category of budgetCategoriesResult.rows) {
        // Check if a notification has already been sent for this month and category
        const existingNotificationResult = await pool.query(`
          SELECT id, notification_sent, budget_amount, spent_amount 
          FROM budget_notifications
          WHERE budget_id = $1 AND category_id = $2 AND month = $3
        `, [budget.id, category.category_id, currentMonthStr]);
        
        const budgetAmount = parseFloat(category.budgeted_spending);
        const spentAmount = existingNotificationResult.rows.length > 0 
          ? parseFloat(existingNotificationResult.rows[0].spent_amount || 0)
          : budgetAmount * (Math.random() * 0.5 + 0.5); // Random value between 50-100% of budget
        
        const percentUsed = Math.round((spentAmount / budgetAmount) * 100);
        const isBudgetExceeded = spentAmount > budgetAmount;
        
        console.log(`Category: ${category.category_name}, Budget: ${budgetAmount}, Spent: ${spentAmount}, Exceeded: ${isBudgetExceeded}`);
        
        if (isBudgetExceeded) {
          let notificationId;
          
          if (existingNotificationResult.rows.length > 0) {
            const existingNotification = existingNotificationResult.rows[0];
            
            // Only send notification if we haven't sent one yet
            if (!existingNotification.notification_sent) {
              notificationId = existingNotification.id;
              
              // Update the notification record
              await pool.query(`
                UPDATE budget_notifications
                SET notification_sent = true, sent_at = NOW(), 
                    budget_amount = $1, spent_amount = $2, updated_at = NOW()
                WHERE id = $3
              `, [budgetAmount, spentAmount, notificationId]);
              
              // Send notification
              await sendBudgetNotification(budget.id, category, currentMonth, budgetAmount, spentAmount);
              
              notificationsSent.push({
                id: notificationId,
                category: category.category_name,
                budget: budgetAmount,
                spent: spentAmount
              });
            }
          } else {
            // Create new notification record
            notificationId = uuidv4();
            
            await pool.query(`
              INSERT INTO budget_notifications 
              (id, budget_id, category_id, month, notification_sent, sent_at, 
              budget_amount, spent_amount, created_at, updated_at)
              VALUES ($1, $2, $3, $4, true, NOW(), $5, $6, NOW(), NOW())
            `, [
              notificationId, 
              budget.id, 
              category.category_id, 
              currentMonthStr,
              budgetAmount,
              spentAmount
            ]);
            
            // Send notification
            await sendBudgetNotification(budget.id, category, currentMonth, budgetAmount, spentAmount);
            
            notificationsSent.push({
              id: notificationId,
              category: category.category_name,
              budget: budgetAmount,
              spent: spentAmount
            });
          }
        } else {
          if (existingNotificationResult.rows.length > 0) {
            await pool.query(`
              UPDATE budget_notifications
              SET budget_amount = $1, spent_amount = $2, updated_at = NOW()
              WHERE id = $3
            `, [budgetAmount, spentAmount, existingNotificationResult.rows[0].id]);
          } else {
            await pool.query(`
              INSERT INTO budget_notifications 
              (id, budget_id, category_id, month, notification_sent, 
              budget_amount, spent_amount, created_at, updated_at)
              VALUES ($1, $2, $3, $4, false, $5, $6, NOW(), NOW())
            `, [
              uuidv4(), 
              budget.id, 
              category.category_id, 
              currentMonthStr,
              budgetAmount,
              spentAmount
            ]);
          }
        }
      }
      
      return notificationsSent;
    } catch (error) {
      console.error('Error processing budget check:', error);
      return [];
    }
  } catch (error) {
    console.error('Error checking budgets:', error);
    throw error;
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
 * @returns {Promise<Object>}
 */
const getBudgetStatus = async (date = new Date()) => {
  try {
    const currentMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    
    const currentMonthStr = currentMonth.toISOString().split('T')[0];
    
    const budgetResult = await pool.query(`
      SELECT id
      FROM budgets WHERE start_date <= $1 AND end_date >= $1
    `, [currentMonthStr]);
    
    if (budgetResult.rows.length === 0) {
      return { 
        status: 'no_budget',
        message: 'No active budget found for current month' 
      };
    }
    
    const budget = budgetResult.rows[0];
    
    const categoriesResult = await pool.query(`
      SELECT bc.id, bc.category_id, c.name as category_name, bc.budgeted_spending
      FROM budget_categories bc
      JOIN categories c ON bc.category_id = c.id
      WHERE bc.budget_id = $1
      ORDER BY c.name
    `, [budget.id]);
    
    const notificationsResult = await pool.query(`
      SELECT * 
      FROM budget_notifications
      WHERE budget_id = $1 AND month = $2
    `, [budget.id, currentMonthStr]);
    
    const notificationMap = new Map();
    notificationsResult.rows.forEach(notification => {
      notificationMap.set(notification.category_id, notification);
    });
    
    let totalBudget = 0;
    let totalSpent = 0;
    
    const categories = categoriesResult.rows.map(category => {
      const budgetAmount = parseFloat(category.budgeted_spending);
      totalBudget += budgetAmount;
      
      const notification = notificationMap.get(category.category_id);
      const spentAmount = notification ? parseFloat(notification.spent_amount || 0) : 0;
      totalSpent += spentAmount;
      
      const percentUsed = budgetAmount > 0 ? Math.round((spentAmount / budgetAmount) * 100) : 0;
      const isExceeded = spentAmount > budgetAmount;
      
      return {
        category_id: category.category_id,
        category_name: category.category_name,
        budget_amount: budgetAmount.toFixed(2),
        spent_amount: spentAmount.toFixed(2),
        percent_used: percentUsed,
        is_exceeded: isExceeded,
        notification_sent: notification ? notification.notification_sent : false
      };
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
  }
};

module.exports = {
  checkBudgets,
  getBudgetStatus
};