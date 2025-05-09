const SimplefinClient = require('./simplefinClient');
const MaybeClient = require('./maybeClient');
const { getLinkageById, getEnabledLinkages, updateSyncStatus, updateLastSync, setLinkageError } = require('../models/linkage');
const { getAccountById } = require('../models/account');
const { getSetting } = require('../models/setting');
const { applyRulesToTransaction } = require('../models/rule');
const { syncCategoriesFromMaybe } = require('../models/category');
const { notifySyncStarted, notifySyncSuccess, notifySyncError } = require('./notificationService');
const { checkBudgets } = require('./budgetNotificationService');

// Sync a single linkage
const syncLinkage = async (linkageId) => {
  let simplefinClient = null;
  let maybeClient = null;
  
  try {
    // Get linkage details
    const linkage = await getLinkageById(linkageId);
    
    if (!linkage) {
      throw new Error(`Linkage with ID ${linkageId} not found`);
    }
    
    if (!linkage.enabled) {
      console.log(`Linkage ${linkageId} is not enabled. Skipping sync.`);
      return { success: false, message: 'Linkage is not enabled' };
    }
    
    await updateSyncStatus(linkageId, 'running');
    
    // Send notification that sync is starting
    await notifySyncStarted(linkageId);
    
    // Get accounts
    const maybeAccount = await getAccountById(linkage.maybe_account_id);
    const simplefinAccount = await getAccountById(linkage.simplefin_account_id);
    
    if (!maybeAccount || !simplefinAccount) {
      throw new Error('Missing account(s)');
    }
    
    console.log(`Maybe Account: '${maybeAccount.display_name}' [${maybeAccount.identifier}]; Type: ${maybeAccount.accountable_type}`);
    console.log(`SimpleFIN Account: '${simplefinAccount.display_name}' [${simplefinAccount.identifier}]`);
    
    // Create clients
    maybeClient = await MaybeClient.createFromSettings();
    simplefinClient = await SimplefinClient.createFromSettings();
    
    await syncCategoriesFromMaybe(maybeClient.connection);
    
    // Determine lookback days
    const lookbackDays = parseInt(await getSetting('lookback_days') || '7');
    const lookbackDate = Math.floor(Date.now() / 1000) - (lookbackDays * 24 * 60 * 60);
    
    console.log(`Searching for Maybe transactions since ${new Date(lookbackDate * 1000).toLocaleDateString()}`);
    
    // Get existing transactions in Maybe - now includes entryable_id and category_id
    const transactionsInMaybe = await maybeClient.getSimplefinTransactions(
      maybeAccount.identifier,
      lookbackDate
    );
    
    console.log(`Retrieved ${transactionsInMaybe.length} Maybe transactions`);
    
    // Get SimpleFIN transactions
    console.log(`Searching for SimpleFIN transactions since ${new Date(lookbackDate * 1000).toLocaleDateString()}`);
    
    const simplefinResponse = await simplefinClient.getTransactions(
      simplefinAccount.identifier, 
      lookbackDate
    );
    
    if (!simplefinResponse.success) {
      throw new Error(`Failed to retrieve data from SimpleFIN: ${simplefinResponse.error_message}`);
    }
    
    const simplefinAccountWithBalance = simplefinResponse.response?.accounts?.[0];
    
    if (!simplefinAccountWithBalance) {
      throw new Error('No SimpleFIN account found in response');
    }
    
    const simplefinTransactions = simplefinAccountWithBalance?.transactions || [];
    
    console.log(`Retrieved ${simplefinTransactions.length} SimpleFIN transactions`);
    
    // Track processed transactions for notification details
    let processedTransactions = 0;
    
    // Process transactions
    for (const simplefinTransaction of simplefinTransactions) {
      if (!simplefinTransaction) continue;
      
      const transactionId = simplefinTransaction.id;
      
      // Create a map for quick lookup of transactions by plaid_id
      const existingTransactionMap = new Map();
      transactionsInMaybe.forEach(t => {
        if (t.plaid_id) {
          existingTransactionMap.set(t.plaid_id, t);
        }
      });
      
      const existingTransaction = existingTransactionMap.get(transactionId);
      
      // Apply rules to determine category, regardless of whether transaction is new or existing
      const transactionWithMeta = {
        ...simplefinTransaction,
        name: simplefinTransaction.description,
        amount: simplefinTransaction.amount
      };
      
      const appliedRules = await applyRulesToTransaction(transactionWithMeta);
      const categoryId = transactionWithMeta.category_id || null;
      
      if (existingTransaction) {
        // If transaction exists and category is different or missing, update it
        if (categoryId && categoryId !== existingTransaction.category_id) {
          console.log(`Updating category for transaction with plaid_id='${transactionId}' to ${categoryId}`);
          await maybeClient.updateTransactionCategory(existingTransaction.entryable_id, categoryId);
          processedTransactions++;
        }
      } else {
        // If this transaction hasn't been synced yet, create a new transaction in Maybe
        if (shouldSyncTransaction(maybeAccount.accountable_type, simplefinTransaction)) {
          console.log(`Adding transaction with plaid_id='${transactionId}'`);
          
          if (categoryId) {
            console.log(`Applied category ID ${categoryId} from rules`);
          }
          
          const currency = simplefinAccount.currency || maybeAccount.currency || 'USD';
          await maybeClient.newTransaction(maybeAccount.identifier, simplefinTransaction, currency, categoryId);
          processedTransactions++;
        }
      }
    }
    
    // Update balance for investment accounts
    if (maybeAccount.accountable_type === 'Investment') {
      console.log(`Updating Balance for '${new Date(simplefinAccountWithBalance['balance-date'] * 1000).toLocaleDateString()}'`);
      await maybeClient.upsertAccountValuation(maybeAccount.identifier, simplefinAccountWithBalance);
    }
    
    // Update sync status and last sync time
    await updateLastSync(linkageId);
    
    console.log(`Sync completed successfully for linkage ${linkageId}`);
    
    // Check budget status and send notifications if needed
    try {
      console.log('Checking budget status...');
      const budgetNotifications = await checkBudgets();
      
      if (budgetNotifications.length > 0) {
        console.log(`Sent ${budgetNotifications.length} budget exceeded notifications`);
      } else {
        console.log('No budget thresholds exceeded.');
      }
    } catch (budgetError) {
      console.error('Error checking budget status:', budgetError);
      // Don't fail the sync if budget check fails
    }
    
    // Send success notification with details
    await notifySyncSuccess(linkageId, {
      simplefin_account: simplefinAccount.display_name,
      maybe_account: maybeAccount.display_name,
      transactions_processed: processedTransactions
    });
    
    return { 
      success: true,
      details: {
        simplefin_account: simplefinAccount.display_name,
        maybe_account: maybeAccount.display_name,
        transactions_processed: processedTransactions
      }
    };
  } catch (error) {
    console.error(`Error syncing linkage ${linkageId}:`, error);
    await setLinkageError(linkageId, error.message);
    
    // Send error notification
    await notifySyncError(linkageId, error);
    
    return { success: false, error: error.message };
  } finally {
    // Close connections
    if (maybeClient) {
      await maybeClient.close();
    }
  }
};

// Run all enabled syncs
const runAllSyncs = async () => {
  try {
    const enabledLinkages = await getEnabledLinkages();
    
    console.log(`Found ${enabledLinkages.length} enabled linkages to sync`);
    
    for (const linkage of enabledLinkages) {
      console.log(`Starting sync for linkage ${linkage.id}`);
      await syncLinkage(linkage.id);
    }
    
    return { success: true, message: `Synced ${enabledLinkages.length} linkages` };
  } catch (error) {
    console.error('Error running all syncs:', error);
    return { success: false, error: error.message };
  }
};

// Helper function to determine if we should sync a transaction
const shouldSyncTransaction = (accountType, transaction) => {
  const description = transaction.description || '';
  const amount = parseFloat(transaction.amount || '0');
  
  if (!description) {
    return false;
  }
  
  if (accountType === 'Investment') {
    // Only sync certain types of investment transactions
    return (
      (description.match(/(CONTRIBUTIONS|INTEREST PAYMENT|AUTO CLEARING HOUSE FUND)/i) && amount > 0) ||
      (description.match(/(RECORDKEEPING|MANAGEMENT|WRAP) FEE/i) && amount < 0)
    );
  }
  
  // Sync all other transactions
  return true;
};

module.exports = {
  syncLinkage,
  runAllSyncs
};