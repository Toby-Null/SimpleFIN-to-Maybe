const { getAllSettings, getSetting, upsertSetting, parseSimplefinSetupToken, saveAccountCount, getAccountCount } = require('../models/setting');
const SimplefinClient = require('../services/simplefinClient');
const MaybeClient = require('../services/maybeClient');
const { createAccount, getAccountByIdentifier } = require('../models/account');
const { syncCategoriesFromMaybe } = require('../models/category');

// Get all settings
const getSettings = async (req, res) => {
  try {
    const settings = await getAllSettings();
    
    // Process cron schedule into user-friendly format if it exists
    const cronSchedule = settings.find(s => s.key === 'synchronization_schedule');
    if (cronSchedule && cronSchedule.value) {
      const scheduleInfo = parseCronToUserFriendly(cronSchedule.value);
      
      // Add the user-friendly scheduling info to pass to the view
      res.locals.scheduleInfo = scheduleInfo;
    }
    
    res.render('settings/index', {
      title: 'Settings',
      settings
    });
  } catch (error) {
    console.error('Error getting settings:', error);
    req.flash('error_msg', `Error getting settings: ${error.message}`);
    res.redirect('/');
  }
};

// Update a setting
const updateSetting = async (req, res) => {
  try {
    const { id: key } = req.params;
    const { value } = req.body;
    
    // If this is a Setup Token, process it immediately
    if (key === 'simplefin_setup_token' && value) {
      await upsertSetting(key, value, 'SimpleFIN Setup Token');
      
      try {
        // Try to parse the token and extract credentials
        await parseSimplefinSetupToken(value);
        return res.json({ success: true, value, message: 'Setup Token processed successfully' });
      } catch (tokenError) {
        console.error('Error processing Setup Token:', tokenError);
        return res.status(400).json({ 
          success: false, 
          error: `Error processing Setup Token: ${tokenError.message}`
        });
      }
    }
    
    if (key === 'sync_schedule_friendly') {
      try {
        // Parse user-friendly schedule and convert to cron
        const { interval, value: intervalValue, timeHour, timeMinute, amPm } = JSON.parse(value);
        const cronExpression = convertToCronExpression(interval, intervalValue, timeHour, timeMinute, amPm);
        
        // Store the actual cron expression
        await upsertSetting('synchronization_schedule', cronExpression, 'Sync Schedule');
        
        return res.json({ 
          success: true, 
          value: cronExpression,
          friendlyValue: value
        });
      } catch (scheduleError) {
        console.error('Error processing schedule:', scheduleError);
        return res.status(400).json({ 
          success: false, 
          error: `Error processing schedule: ${scheduleError.message}`
        });
      }
    }
    
    // Normal setting update
    await upsertSetting(key, value);
    
    return res.json({ success: true, value });
  } catch (error) {
    console.error(`Error updating setting ${req.params.id}:`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Test SimpleFIN connection
const testSimplefin = async (req, res) => {
  try {
    // Check if we have a setup token
    const setupToken = await getSetting('simplefin_setup_token');
    const username = await getSetting('simplefin_username');
    const password = await getSetting('simplefin_password');
    
    // If this is just a count retrieval request and not a full test
    if (req.query.countOnly === 'true') {
      const count = await getAccountCount('simplefin');
      return res.json({
        account_count: count
      });
    }
    
    // If we have a setup token but not credentials, try to exchange it
    if (setupToken && (!username || !password)) {
      try {
        // Use our parseSimplefinSetupToken function
        const credentials = await parseSimplefinSetupToken(setupToken);
        
        // Now try to use these credentials
        const simplefinClient = new SimplefinClient(credentials.username, credentials.password);
        const apiResponse = await simplefinClient.getAccounts();
        
        if (apiResponse.success) {
          const output = ['\nSuccess! Setup token has been processed and credentials saved.'];
          
          if (apiResponse.response.errors && apiResponse.response.errors.length > 0) {
            apiResponse.response.errors.forEach(warning => {
              output.push(`  Warning: ${warning}`);
            });
          }
          
          const foundSimplefinAccounts = apiResponse.response.accounts || [];
          
          // Cache accounts
          await cacheAccounts(foundSimplefinAccounts, 'simplefin');
          
          // Save the account count
          await saveAccountCount('simplefin', foundSimplefinAccounts.length);
          
          return res.json({
            output: output.join('\n'),
            account_count: foundSimplefinAccounts.length
          });
        } else {
          return res.json({
            output: `Successfully saved credentials from Setup Token, but got an error when testing: ${apiResponse.error_message || 'Unknown error'}`,
            account_count: 0
          });
        }
      } catch (error) {
        console.error('Error processing setup token:', error);
        return res.json({
          output: `Error processing Setup Token: ${error.message}`,
          account_count: 0
        });
      }
    } else if (!username || !password) {
      return res.json({
        output: 'SimpleFIN Username or Password not set. Please enter credentials or a Setup Token.',
        account_count: 0
      });
    }
    
    // If we have username and password, try to use them
    const simplefinClient = new SimplefinClient(username, password);
    const response = await simplefinClient.getAccounts();
    
    if (response.success) {
      const output = ['\nSuccess!'];
      
      if (response.response.errors && response.response.errors.length > 0) {
        response.response.errors.forEach(warning => {
          output.push(`  Warning: ${warning}`);
        });
      }
      
      const foundSimplefinAccounts = response.response.accounts || [];
      
      // Cache accounts
      await cacheAccounts(foundSimplefinAccounts, 'simplefin');
      
      // Save the account count
      await saveAccountCount('simplefin', foundSimplefinAccounts.length);
      
      return res.json({
        output: output.join('\n'),
        account_count: foundSimplefinAccounts.length
      });
    } else {
      const output = [`\nError during retrieval: [${response.status_code}]`];
      
      if (response.response && response.response.errors) {
        response.response.errors.forEach(error => {
          output.push(`  ${error}`);
        });
      } else {
        output.push(`  ${response.error_message || 'Unknown error'}`);
      }
      
      return res.json({
        output: output.join(' '),
        account_count: 0
      });
    }
  } catch (error) {
    console.error('Error testing SimpleFIN:', error);
    return res.status(500).json({
      output: `Error: ${error.message}`,
      account_count: 0
    });
  }
};

// Test Maybe connection
const testMaybe = async (req, res) => {
  let maybeClient = null;
  
  try {
    if (req.query.countOnly === 'true') {
      const count = await getAccountCount('maybe');
      return res.json({
        account_count: count
      });
    }
    
    const host = await getSetting('maybe_postgres_host');
    const port = await getSetting('maybe_postgres_port');
    const dbname = await getSetting('maybe_postgres_db');
    const user = await getSetting('maybe_postgres_user');
    const password = await getSetting('maybe_postgres_password');
    
    maybeClient = new MaybeClient(host, port, dbname, user, password);
    
    if (maybeClient.connected) {
      const output = ['\nSuccess!'];
      const foundMaybeAccounts = await maybeClient.getAccounts() || [];
      
      // Cache accounts
      await cacheAccounts(foundMaybeAccounts, 'maybe');
      
      // Save the account count
      await saveAccountCount('maybe', foundMaybeAccounts.length);
      
      // Sync categories
      await syncCategoriesFromMaybe(maybeClient.connection);
      
      return res.json({
        output: output.join('\n'),
        account_count: foundMaybeAccounts.length
      });
    } else {
      return res.json({
        output: `Error: ${maybeClient.error_message}`,
        account_count: 0
      });
    }
  } catch (error) {
    console.error('Error testing Maybe:', error);
    return res.status(500).json({
      output: `Error: ${error.message}`,
      account_count: 0
    });
  } finally {
    if (maybeClient) {
      await maybeClient.close();
    }
  }
};

// Cache accounts in the local database
const cacheAccounts = async (accounts, accountType) => {
  const allowedMaybeTypes = ['Depository', 'CreditCard', 'Loan', 'Investment'];
  
  for (const accountData of accounts) {
    let identifier, displayName, accountableType, familyId, currency;
    
    if (accountType === 'simplefin') {
      identifier = accountData.id;
      displayName = `${accountData.org?.name} - ${accountData.name}`;
      accountableType = null;
      familyId = null;
      currency = accountData.currency;
    } else if (accountType === 'maybe') {
      accountableType = accountData.accountable_type;
      
      // Skip accounts with unsupported types
      if (!allowedMaybeTypes.includes(accountableType)) {
        continue;
      }
      
      identifier = accountData.id;
      displayName = accountData.name;
      familyId = accountData.family_id;
      currency = accountData.currency;
    } else {
      throw new Error(`Invalid account_type: ${accountType}`);
    }
    
    // Check if account already exists
    const existingAccount = await getAccountByIdentifier(identifier, accountType);
    
    if (!existingAccount) {
      await createAccount({
        account_type: accountType,
        identifier,
        display_name: displayName,
        accountable_type: accountableType,
        currency,
        maybe_family_id: familyId
      });
    }
  }
};

// Reset database (Danger)
const resetDatabase = async (req, res) => {
  try {
    req.flash('success_msg', 'Database reset functionality would go here');
    res.redirect('/settings');
  } catch (error) {
    console.error('Error resetting database:', error);
    req.flash('error_msg', `Error resetting database: ${error.message}`);
    res.redirect('/settings');
  }
};

// Helper function to convert user-friendly schedule to cron expression
function convertToCronExpression(interval, intervalValue, timeHour, timeMinute, amPm) {
  let hour = parseInt(timeHour, 10);
  if (amPm === 'PM' && hour < 12) {
    hour += 12;
  } else if (amPm === 'AM' && hour === 12) {
    hour = 0;
  }
  
  // Parse minute
  const minute = parseInt(timeMinute, 10);
  
  // Default cron: minute hour * * * (every day at specific hour:minute)
  let cronExpression = `${minute} ${hour} * * *`;
  
  // Adjust based on interval type
  if (interval === 'hourly') {
    // Run every X hours starting at the specified minute
    cronExpression = `${minute} */${intervalValue} * * *`;
  } else if (interval === 'daily') {
    if (intervalValue > 1) {
      cronExpression = `${minute} ${hour} */${intervalValue} * *`;
    }
  } else if (interval === 'weekly') {
    // Run on day 0 (Sunday) of every week
    if (intervalValue === 1) {
      cronExpression = `${minute} ${hour} * * 0`;
    } else {
      cronExpression = `${minute} ${hour} 1-7/${intervalValue * 7} * *`;
    }
  } else if (interval === 'monthly') {
    if (intervalValue === 1) {
      cronExpression = `${minute} ${hour} 1 * *`;
    } else {
      // Every X months
      cronExpression = `${minute} ${hour} 1 */${intervalValue} *`;
    }
  }
  
  return cronExpression;
}

// Helper function to parse cron expression to user-friendly format
function parseCronToUserFriendly(cronExpression) {
  let interval = 'daily';
  let intervalValue = 1;
  let timeHour = 0;
  let timeMinute = 0;
  let amPm = 'AM';
  
  try {
    const parts = cronExpression.split(' ');
    
    if (parts.length !== 5) {
      throw new Error('Invalid cron expression');
    }
    
    // Extract minute and hour
    timeMinute = parseInt(parts[0], 10);
    
    // Check for hourly schedule
    if (parts[1].includes('*/')) {
      interval = 'hourly';
      intervalValue = parseInt(parts[1].replace('*/', ''), 10);
      timeHour = 0; // Not relevant for hourly
    } else {
      timeHour = parseInt(parts[1], 10);
      
      // Convert to 12-hour format for display
      if (timeHour >= 12) {
        amPm = 'PM';
        if (timeHour > 12) {
          timeHour -= 12;
        }
      } else if (timeHour === 0) {
        timeHour = 12;
        amPm = 'AM';
      }
      
      // Check for daily/weekly/monthly
      if (parts[2].includes('*/')) {
        // Every X days
        interval = 'daily';
        intervalValue = parseInt(parts[2].replace('*/', ''), 10);
      } else if (parts[4] !== '*') {
        // Weekly
        interval = 'weekly';
        intervalValue = 1;
      } else if (parts[2] === '1' && parts[3].includes('*/')) {
        // Monthly with interval
        interval = 'monthly';
        intervalValue = parseInt(parts[3].replace('*/', ''), 10);
      } else if (parts[2] === '1') {
        // Monthly
        interval = 'monthly';
        intervalValue = 1;
      }
    }
    
    return {
      interval,
      intervalValue,
      timeHour,
      timeMinute,
      amPm
    };
  } catch (error) {
    console.error('Error parsing cron expression:', error);
    
    return {
      interval: 'daily',
      intervalValue: 1,
      timeHour: 12,
      timeMinute: 0,
      amPm: 'AM'
    };
  }
}

const getScheduleDisplay = async (req, res) => {
  try {
    const cronSchedule = await getSetting('synchronization_schedule');
    
    if (!cronSchedule) {
      return res.json({
        success: true,
        display: 'Not scheduled',
        schedule: null
      });
    }
    
    const scheduleInfo = parseCronToUserFriendly(cronSchedule);
    let displayText = '';
    
    if (scheduleInfo.interval === 'hourly') {
      displayText = `Every ${scheduleInfo.intervalValue} hour(s)`;
    } else {
      const time = `${scheduleInfo.timeHour}:${String(scheduleInfo.timeMinute).padStart(2, '0')} ${scheduleInfo.amPm}`;
      
      if (scheduleInfo.interval === 'daily') {
        if (scheduleInfo.intervalValue === 1) {
          displayText = `Daily at ${time}`;
        } else {
          displayText = `Every ${scheduleInfo.intervalValue} days at ${time}`;
        }
      } else if (scheduleInfo.interval === 'weekly') {
        if (scheduleInfo.intervalValue === 1) {
          displayText = `Weekly on Sunday at ${time}`;
        } else {
          displayText = `Every ${scheduleInfo.intervalValue} weeks at ${time}`;
        }
      } else if (scheduleInfo.interval === 'monthly') {
        if (scheduleInfo.intervalValue === 1) {
          displayText = `Monthly on the 1st at ${time}`;
        } else {
          displayText = `Every ${scheduleInfo.intervalValue} months at ${time}`;
        }
      }
    }
    
    return res.json({
      success: true,
      display: displayText,
      schedule: scheduleInfo
    });
  } catch (error) {
    console.error('Error getting schedule display:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  getSettings,
  updateSetting,
  testSimplefin,
  testMaybe,
  resetDatabase,
  getScheduleDisplay
};