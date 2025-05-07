const axios = require('axios');
const { getSetting } = require('../models/setting');

class SimplefinClient {
  constructor(username, password) {
    this.baseUrl = 'https://beta-bridge.simplefin.org/simplefin';
    this.username = username;
    this.password = password;
  }
  
  getAuthHeaders() {
    return {
      auth: {
        username: this.username,
        password: this.password
      }
    };
  }
  
  // Get all accounts
  async getAccounts() {
    try {
      const response = await axios.get(
        `${this.baseUrl}/accounts?balances-only=1&start-date=${this.getFutureDate()}`,
        this.getAuthHeaders()
      );
      
      return {
        success: true,
        response: response.data,
        status_code: response.status
      };
    } catch (error) {
      console.error('SimpleFIN API Error:', error.message);
      return {
        success: false,
        response: error.response?.data || {},
        status_code: error.response?.status,
        error_message: error.message
      };
    }
  }
  
  // Get a specific account
  async getAccount(accountId) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/accounts?balances-only=1&account=${accountId}&start-date=${this.getFutureDate()}`,
        this.getAuthHeaders()
      );
      
      return {
        success: true,
        response: response.data,
        status_code: response.status
      };
    } catch (error) {
      console.error(`SimpleFIN API Error for account ${accountId}:`, error.message);
      return {
        success: false,
        response: error.response?.data || {},
        status_code: error.response?.status,
        error_message: error.message
      };
    }
  }
  
  // Get transactions for a specific account
  async getTransactions(accountId, startDate) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/accounts?account=${accountId}&start-date=${startDate}`,
        this.getAuthHeaders()
      );
      
      return {
        success: true,
        response: response.data,
        status_code: response.status
      };
    } catch (error) {
      console.error(`SimpleFIN API Error getting transactions for account ${accountId}:`, error.message);
      return {
        success: false,
        response: error.response?.data || {},
        status_code: error.response?.status,
        error_message: error.message
      };
    }
  }
  
  // Helper method to get a future date (to avoid fetching transactions)
  getFutureDate() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return Math.floor(tomorrow.getTime() / 1000);
  }
  
  // Static method to create a client using settings
  static async createFromSettings() {
    try {
      const username = await getSetting('simplefin_username');
      const password = await getSetting('simplefin_password');
      
      if (!username || !password) {
        throw new Error('SimpleFIN credentials not configured. Please check settings.');
      }
      
      return new SimplefinClient(username, password);
    } catch (error) {
      console.error('Error creating SimpleFIN client:', error);
      throw error;
    }
  }
}

module.exports = SimplefinClient;