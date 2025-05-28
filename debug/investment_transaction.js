require('dotenv').config();
const SimplefinClient = require('../services/simplefinClient');
const MaybeClient = require('../services/maybeClient');
const { getAllLinkages } = require('../models/linkage');
const { getAccountById } = require('../models/account');
const { getSetting } = require('../models/setting');
const { applyRulesToTransaction } = require('../models/rule');
const { getAllCategories } = require('../models/category');

class ReadOnlyMaybeClient extends MaybeClient {
  async newTransaction(...args) {
    console.log('   BLOCKED: newTransaction() - read-only mode');
    return 'READ_ONLY_BLOCKED';
  }
  
  async updateTransactionCategory(...args) {
    console.log('   BLOCKED: updateTransactionCategory() - read-only mode');
    return false;
  }
  
  async upsertAccountValuation(...args) {
    console.log('   BLOCKED: upsertAccountValuation() - read-only mode');
    return 'READ_ONLY_BLOCKED';
  }
}

const debugInvestmentTransactionSync = async () => {
  let simplefinClient = null;
  let maybeClient = null;
  
  console.log('Investment Transaction Debug (Read-Only)\n');
  
  try {
    const { pool } = require('../config/database');
    await pool.query('SELECT NOW()');
    console.log('Database connected');
  } catch (dbError) {
    console.error('Database connection failed:', dbError.message);
    return;
  }
  
  try {
    const allLinkages = await getAllLinkages();
    console.log(`Total linkages: ${allLinkages.length}`);
    
    const investmentLinkages = [];
    
    for (const linkage of allLinkages) {
      const maybeAccount = await getAccountById(linkage.maybe_account_id);
      if (maybeAccount && maybeAccount.accountable_type === 'Investment') {
        investmentLinkages.push({
          ...linkage,
          maybeAccount
        });
      }
    }
    
    console.log(`Investment linkages: ${investmentLinkages.length}`);
    investmentLinkages.forEach(linkage => {
      console.log(`  ${linkage.maybeAccount.display_name} (${linkage.enabled ? 'Enabled' : 'Disabled'})`);
    });
    
    if (investmentLinkages.length === 0) {
      console.log('No investment account linkages found');
      return;
    }
    
    maybeClient = new ReadOnlyMaybeClient(
      await getSetting('maybe_postgres_host'),
      await getSetting('maybe_postgres_port'),
      await getSetting('maybe_postgres_db'),
      await getSetting('maybe_postgres_user'),
      await getSetting('maybe_postgres_password')
    );
    
    simplefinClient = await SimplefinClient.createFromSettings();
    console.log('Clients created (read-only mode)');
    
    const categories = await getAllCategories();
    console.log(`Categories loaded: ${categories.length}`);
    
    const lookbackDays = 14;
    const lookbackDate = Math.floor(Date.now() / 1000) - (lookbackDays * 24 * 60 * 60);
    console.log(`Lookback: ${lookbackDays} days`);
    
    for (let i = 0; i < investmentLinkages.length; i++) {
      const linkageData = investmentLinkages[i];
      const linkage = linkageData;
      const maybeAccount = linkageData.maybeAccount;
      
      console.log(`\n--- Processing Linkage ${i + 1}/${investmentLinkages.length} ---`);
      console.log(`Maybe Account: ${maybeAccount.display_name}`);
      console.log(`Account Type: ${maybeAccount.accountable_type}`);
      console.log(`Enabled: ${linkage.enabled}`);
      
      if (!linkage.enabled) {
        console.log('Skipping disabled linkage');
        continue;
      }
      
      const simplefinAccount = await getAccountById(linkage.simplefin_account_id);
      console.log(`SimpleFIN Account: ${simplefinAccount.display_name}`);
      
      const transactionsInMaybe = await maybeClient.getSimplefinTransactions(
        maybeAccount.identifier,
        lookbackDate
      );
      console.log(`Existing Maybe transactions: ${transactionsInMaybe.length}`);
      
      if (transactionsInMaybe.length > 0) {
        transactionsInMaybe.forEach((txn, idx) => {
          console.log(`  ${idx + 1}. Plaid ID: ${txn.plaid_id}, Entry ID: ${txn.entryable_id}, Category: ${txn.category_id || 'None'}`);
        });
      }
      
      const simplefinResponse = await simplefinClient.getTransactions(
        simplefinAccount.identifier, 
        lookbackDate
      );
      
      if (!simplefinResponse.success) {
        console.log(`Failed to retrieve SimpleFIN data: ${simplefinResponse.error_message}`);
        continue;
      }
      
      const simplefinAccountWithBalance = simplefinResponse.response?.accounts?.[0];
      
      if (!simplefinAccountWithBalance) {
        console.log('No SimpleFIN account found in response');
        continue;
      }
      
      const simplefinTransactions = simplefinAccountWithBalance?.transactions || [];
      const balance = simplefinAccountWithBalance.balance;
      const balanceDate = simplefinAccountWithBalance['balance-date'];
      
      console.log(`Account Balance: $${balance}`);
      console.log(`Balance Date: ${new Date(balanceDate * 1000).toLocaleDateString()}`);
      console.log(`SimpleFIN transactions: ${simplefinTransactions.length}`);
      
      console.log('\n--- SimpleFIN Account Data ---');
      Object.keys(simplefinAccountWithBalance).forEach(key => {
        if (key !== 'transactions') {
          let value = simplefinAccountWithBalance[key];
          if (key === 'balance-date' && typeof value === 'number') {
            value = `${value} (${new Date(value * 1000).toISOString()})`;
          }
          console.log(`${key}: ${JSON.stringify(value)}`);
        }
      });
      
      console.log('\n--- SimpleFIN API Response ---');
      console.log(`Response Status: ${simplefinResponse.status_code}`);
      console.log(`Success: ${simplefinResponse.success}`);
      if (simplefinResponse.response) {
        console.log(`Response Keys: ${Object.keys(simplefinResponse.response)}`);
        console.log(`Accounts in Response: ${simplefinResponse.response.accounts?.length || 0}`);
        if (simplefinResponse.response.errors && simplefinResponse.response.errors.length > 0) {
          console.log(`API Errors/Warnings: ${JSON.stringify(simplefinResponse.response.errors)}`);
        }
      }
      
      console.log('\n--- ALL Raw Transaction Data ---');
      console.log(`Total transactions: ${simplefinTransactions.length}`);
      
      if (simplefinTransactions.length > 0) {
        simplefinTransactions.forEach((txn, idx) => {
          console.log(`\nRaw Transaction ${idx + 1}:`);
          console.log(`ID: ${txn.id}`);
          console.log(`Description: "${txn.description}"`);
          console.log(`Amount: ${txn.amount}`);
          console.log(`Posted Date: ${new Date(txn.posted * 1000).toISOString()}`);
          console.log(`Posted Timestamp: ${txn.posted}`);
          
          console.log('All Fields:');
          Object.keys(txn).forEach(key => {
            if (key !== 'id' && key !== 'description' && key !== 'amount' && key !== 'posted') {
              let value = txn[key];
              if (key === 'transacted' && typeof value === 'number') {
                value = `${value} (${new Date(value * 1000).toISOString()})`;
              }
              console.log(`  ${key}: ${JSON.stringify(value)}`);
            }
          });
        });
      }
      
      console.log('\n--- Balance Update Simulation ---');
      console.log(`Would update balance for: ${new Date(balanceDate * 1000).toLocaleDateString()}`);
      console.log(`New balance: $${balance}`);
      const balanceResult = await maybeClient.upsertAccountValuation(maybeAccount.identifier, simplefinAccountWithBalance);
      
      console.log('\n--- Transaction Processing ---');
      
      let newTransactionCount = 0;
      let updateCategoryCount = 0;
      let skippedCount = 0;
      
      const existingTransactionMap = new Map();
      transactionsInMaybe.forEach(t => {
        if (t.plaid_id) {
          existingTransactionMap.set(t.plaid_id, t);
        }
      });
      
      for (let txnIdx = 0; txnIdx < simplefinTransactions.length; txnIdx++) {
        const simplefinTransaction = simplefinTransactions[txnIdx];
        const transactionId = simplefinTransaction.id;
        
        console.log(`\nTransaction ${txnIdx + 1}/${simplefinTransactions.length}:`);
        console.log(`ID: ${transactionId}`);
        console.log(`Description: "${simplefinTransaction.description}"`);
        console.log(`Amount: $${simplefinTransaction.amount}`);
        console.log(`Date: ${new Date(simplefinTransaction.posted * 1000).toISOString()}`);
        
        const shouldSync = shouldSyncTransaction(maybeAccount.accountable_type, simplefinTransaction);
        console.log(`Should Sync: ${shouldSync}`);
        
        if (!shouldSync) {
          console.log(`Skip Reason: ${getSyncSkipReason(simplefinTransaction)}`);
          skippedCount++;
          continue;
        }
        
        console.log(`Sync Reason: ${getInvestmentSyncReason(simplefinTransaction)}`);
        
        const transactionWithMeta = {
          ...simplefinTransaction,
          name: simplefinTransaction.description,
          amount: simplefinTransaction.amount
        };
        
        const appliedRules = await applyRulesToTransaction(transactionWithMeta);
        const categoryId = transactionWithMeta.category_id || null;
        
        if (appliedRules.length > 0) {
          console.log(`Applied rules: ${appliedRules.length}`);
          appliedRules.forEach((rule, idx) => {
            console.log(`  Rule: "${rule.rule.name}"`);
            rule.appliedActions.forEach(action => {
              console.log(`    Action: ${action.action_type} = ${action.action_value}`);
            });
          });
        } else {
          console.log('No rules applied');
        }
        
        if (categoryId) {
          console.log(`Category ID from rules: ${categoryId}`);
        }
        
        const existingTransaction = existingTransactionMap.get(transactionId);
        
        if (existingTransaction) {
          console.log(`Transaction exists (Entry ID: ${existingTransaction.entryable_id})`);
          console.log(`Current category: ${existingTransaction.category_id || 'None'}`);
          
          if (categoryId && categoryId !== existingTransaction.category_id) {
            console.log(`Would update category: ${existingTransaction.category_id || 'None'} -> ${categoryId}`);
            const result = await maybeClient.updateTransactionCategory(existingTransaction.entryable_id, categoryId);
            updateCategoryCount++;
          } else {
            console.log('Category already correct or no new category');
          }
        } else {
          console.log('NEW transaction would be created');
          console.log(`Amount (adjusted): $${parseFloat(simplefinTransaction.amount) * -1}`);
          console.log(`Currency: ${simplefinAccount.currency || maybeAccount.currency || 'USD'}`);
          if (categoryId) {
            console.log(`Would be created with category: ${categoryId}`);
          }
          const result = await maybeClient.newTransaction(maybeAccount.identifier, simplefinTransaction, simplefinAccount.currency || maybeAccount.currency || 'USD', categoryId);
          newTransactionCount++;
        }
      }
      
      console.log(`\n--- Summary: ${maybeAccount.display_name} ---`);
      console.log(`Total SimpleFIN transactions: ${simplefinTransactions.length}`);
      console.log(`New transactions to create: ${newTransactionCount}`);
      console.log(`Existing to update category: ${updateCategoryCount}`);
      console.log(`Transactions skipped: ${skippedCount}`);
      console.log(`Balance update: $${balance} (${new Date(balanceDate * 1000).toLocaleDateString()})`);
    }
    
    console.log('\nDebug completed - no database changes made');
    
    const fs = require('fs');
    const path = require('path');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = path.join(__dirname, `investment_raw_data_${timestamp}.json`);
    
    const rawDataExport = {
      timestamp: new Date().toISOString(),
      lookbackDays: lookbackDays,
      lookbackDate: new Date(lookbackDate * 1000).toISOString(),
      totalLinkages: investmentLinkages.length,
      linkagesData: []
    };
    
    for (const linkageData of investmentLinkages) {
      const linkage = linkageData;
      const maybeAccount = linkageData.maybeAccount;
      const simplefinAccount = await getAccountById(linkage.simplefin_account_id);
      
      try {
        const simplefinResponse = await simplefinClient.getTransactions(
          simplefinAccount.identifier, 
          lookbackDate
        );
        
        const transactionsInMaybe = await maybeClient.getSimplefinTransactions(
          maybeAccount.identifier,
          lookbackDate
        );
        
        rawDataExport.linkagesData.push({
          linkage: {
            id: linkage.id,
            enabled: linkage.enabled,
            simplefin_account_id: linkage.simplefin_account_id,
            maybe_account_id: linkage.maybe_account_id
          },
          maybeAccount: {
            id: maybeAccount.id,
            display_name: maybeAccount.display_name,
            identifier: maybeAccount.identifier,
            accountable_type: maybeAccount.accountable_type,
            currency: maybeAccount.currency
          },
          simplefinAccount: {
            id: simplefinAccount.id,
            display_name: simplefinAccount.display_name,
            identifier: simplefinAccount.identifier,
            currency: simplefinAccount.currency
          },
          simplefinResponse: {
            success: simplefinResponse.success,
            status_code: simplefinResponse.status_code,
            error_message: simplefinResponse.error_message,
            response: simplefinResponse.response
          },
          existingMaybeTransactions: transactionsInMaybe,
          transactionAnalysis: simplefinResponse.success && simplefinResponse.response?.accounts?.[0]?.transactions ? 
            simplefinResponse.response.accounts[0].transactions.map(txn => ({
              ...txn,
              posted_date_iso: new Date(txn.posted * 1000).toISOString(),
              should_sync: shouldSyncTransaction(maybeAccount.accountable_type, txn),
              sync_reason: shouldSyncTransaction(maybeAccount.accountable_type, txn) ? 
                getInvestmentSyncReason(txn) : getSyncSkipReason(txn)
            })) : []
        });
      } catch (error) {
        rawDataExport.linkagesData.push({
          linkage: { id: linkage.id, enabled: linkage.enabled },
          error: error.message
        });
      }
    }
    
    fs.writeFileSync(filename, JSON.stringify(rawDataExport, null, 2));
    console.log(`Raw data exported to: ${filename}`);
    console.log(`File size: ${(fs.statSync(filename).size / 1024).toFixed(2)} KB`);
    
  } catch (error) {
    console.error('Debug error:', error.message);
  } finally {
    if (maybeClient) {
      await maybeClient.close();
    }
  }
};

const shouldSyncTransaction = (accountType, transaction) => {
  const description = transaction.description || '';
  const amount = parseFloat(transaction.amount || '0');
  
  if (!description) {
    return false;
  }
  
  if (accountType === 'Investment') {
    return (
      (description.match(/(CONTRIBUTIONS|INTEREST PAYMENT|AUTO CLEARING HOUSE FUND)/i) && amount > 0) ||
      (description.match(/(RECORDKEEPING|MANAGEMENT|WRAP) FEE/i) && amount < 0)
    );
  }
  
  return true;
};

const getInvestmentSyncReason = (transaction) => {
  const description = transaction.description || '';
  const amount = parseFloat(transaction.amount || '0');
  
  if (description.match(/(CONTRIBUTIONS|INTEREST PAYMENT|AUTO CLEARING HOUSE FUND)/i) && amount > 0) {
    return 'Positive amount with contribution/interest/fund keywords';
  }
  
  if (description.match(/(RECORDKEEPING|MANAGEMENT|WRAP) FEE/i) && amount < 0) {
    return 'Negative amount with fee keywords';
  }
  
  return 'Matches investment sync criteria';
};

const getSyncSkipReason = (transaction) => {
  const description = transaction.description || '';
  const amount = parseFloat(transaction.amount || '0');
  
  if (!description) {
    return 'No description';
  }
  
  if (!description.match(/(CONTRIBUTIONS|INTEREST PAYMENT|AUTO CLEARING HOUSE FUND|RECORDKEEPING|MANAGEMENT|WRAP)/i)) {
    return 'Description does not match investment transaction patterns';
  }
  
  if (description.match(/(CONTRIBUTIONS|INTEREST PAYMENT|AUTO CLEARING HOUSE FUND)/i) && amount <= 0) {
    return 'Contribution/Interest pattern but amount is not positive';
  }
  
  if (description.match(/(RECORDKEEPING|MANAGEMENT|WRAP) FEE/i) && amount >= 0) {
    return 'Fee pattern but amount is not negative';
  }
  
  return 'Does not meet investment sync criteria';
};

const main = async () => {
  try {
    await debugInvestmentTransactionSync();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
  process.exit(0);
};

if (require.main === module) {
  main();
}

module.exports = {
  debugInvestmentTransactionSync
};