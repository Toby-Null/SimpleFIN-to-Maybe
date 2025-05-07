const { 
  getAllAccounts, 
  getAccountsByType,
  deleteAccount,
  isAccountInUse
} = require('../models/account');
const { pool } = require('../config/database.js');

// Get all accounts
const getAccounts = async (req, res) => {
  try {
    const accounts = await getAllAccounts();
    
    // Group by account type
    const simplefinAccounts = accounts.filter(account => account.account_type === 'simplefin');
    const maybeAccounts = accounts.filter(account => account.account_type === 'maybe');
    
    res.render('accounts/index', {
      title: 'Accounts',
      simplefinAccounts,
      maybeAccounts
    });
  } catch (error) {
    console.error('Error getting accounts:', error);
    req.flash('error_msg', `Error getting accounts: ${error.message}`);
    res.redirect('/');
  }
};

// Delete an account
const removeAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const force = req.body.force === "true";
    
    // Check if account is in use
    const inUse = await isAccountInUse(id);
    
    if (inUse && !force) {
      req.flash('warning_msg', 'Cannot delete account that is in use by linkages');
      return res.redirect('/accounts');
    }
    
    if (inUse) {
      // Get a client from the pool
      const client = await pool.connect();
      try {
        // Use the client to execute the query
        await client.query(`
          DELETE FROM linkages 
          WHERE simplefin_account_id = $1 OR maybe_account_id = $1
        `, [id]);
      } finally {
        client.release();
      }
    }
    
    await deleteAccount(id);
    
    req.flash('success_msg', inUse ? 
      'Account and associated linkages deleted successfully' : 
      'Account deleted successfully');
    res.redirect('/accounts');
  } catch (error) {
    console.error(`Error deleting account ${req.params.id}:`, error);
    req.flash('error_msg', `Error deleting account: ${error.message}`);
    res.redirect('/accounts');
  }
};

module.exports = {
  getAccounts,
  removeAccount
};