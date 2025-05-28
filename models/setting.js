const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

// Get a setting by key
const getSetting = async (key) => {
  try {
    const result = await pool.query(
      'SELECT value FROM settings WHERE key = $1',
      [key]
    );
    return result.rows.length > 0 ? result.rows[0].value : null;
  } catch (error) {
    console.error(`Error getting setting ${key}:`, error);
    throw error;
  }
};

// Get all settings
const getAllSettings = async () => {
  try {
    const result = await pool.query(
      'SELECT id, display_name, key, value FROM settings ORDER BY key'
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting all settings:', error);
    throw error;
  }
};

// Create or update a setting
const upsertSetting = async (key, value, displayName) => {
  try {
    const existingResult = await pool.query(
      'SELECT id FROM settings WHERE key = $1',
      [key]
    );
    
    if (existingResult.rows.length > 0) {
      // Update existing setting
      await pool.query(
        'UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2',
        [value, key]
      );
      return existingResult.rows[0].id;
    } else {
      // Create new setting
      const result = await pool.query(
        'INSERT INTO settings (id, display_name, key, value, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id',
        [uuidv4(), displayName || key, key, value]
      );
      return result.rows[0].id;
    }
  } catch (error) {
    console.error(`Error upserting setting ${key}:`, error);
    throw error;
  }
};

const saveAccountCount = async (type, count) => {
  try {
    const key = `${type}_account_count`;
    const displayName = `${type.charAt(0).toUpperCase() + type.slice(1)} Account Count`;
    
    await upsertSetting(key, count.toString(), displayName);
    return true;
  } catch (error) {
    console.error(`Error saving ${type} account count:`, error);
    throw error;
  }
};

// Get cached account count
const getAccountCount = async (type) => {
  try {
    const key = `${type}_account_count`;
    const count = await getSetting(key);
    return count ? parseInt(count, 10) : 0;
  } catch (error) {
    console.error(`Error getting ${type} account count:`, error);
    return 0;
  }
};

// Parse SimpleFIN Setup Token
const parseSimplefinSetupToken = async (setupToken) => {
  try {
    const token = setupToken.trim();
    
    const claimUrl = Buffer.from(token, 'base64').toString('utf8');
    
    console.log('Decoded claim URL:', claimUrl);
    
    const axios = require('axios');
    
    const response = await axios.post(claimUrl, null, {
      headers: {
        'Content-Length': '0'
      }
    });
    
    const accessUrl = response.data.trim();
    
    if (!accessUrl || !accessUrl.startsWith('http')) {
      throw new Error('Invalid access URL received from SimpleFIN');
    }
    
    console.log('Received access URL (credentials hidden)');
    
    const url = new URL(accessUrl);
    const username = url.username;
    const password = url.password;
    
    if (!username || !password) {
      throw new Error('No credentials found in access URL');
    }
    
    await upsertSetting('simplefin_username', username, 'SimpleFIN Username');
    await upsertSetting('simplefin_password', password, 'SimpleFIN Password');
    
    console.log('Successfully extracted and saved SimpleFIN credentials');
    
    return { username, password };
  } catch (error) {
    console.error('Error parsing SimpleFIN Setup Token:', error);
    
    if (error.response) {
      throw new Error(`SimpleFIN API error: ${error.response.status} - ${error.response.statusText}`);
    } else if (error.code === 'ENOTFOUND') {
      throw new Error('Network error: Could not connect to SimpleFIN');
    } else {
      throw new Error(`Setup token processing failed: ${error.message}`);
    }
  }
};

module.exports = {
  getSetting,
  getAllSettings,
  upsertSetting,
  parseSimplefinSetupToken,
  saveAccountCount,
  getAccountCount
};