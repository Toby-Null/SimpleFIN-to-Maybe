const { Pool } = require('pg');
const { getSetting } = require('../models/setting');
const { v4: uuidv4 } = require('uuid');

class MaybeClient {
  constructor(host, port, dbname, user, password) {
    this.connected = false;
    this.error_message = null;
    
    try {
      this.connection = new Pool({
        host,
        port: parseInt(port),
        database: dbname,
        user,
        password
      });
      
      this.connected = true;
    } catch (error) {
      console.error('Connection error:', error.message);
      this.connected = false;
      this.error_message = error.message;
    }
  }
  
  // Test connection
  async testConnection() {
    try {
      const result = await this.execute('SELECT NOW()');
      return {
        success: true,
        message: 'Connection successful'
      };
    } catch (error) {
      console.error('Connection test failed:', error.message);
      return {
        success: false,
        message: error.message
      };
    }
  }
  
  // Get schema migration version to determine table structures
  async getLatestSchemaMigration() {
    try {
      const result = await this.execute(
        'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1'
      );
      return result[0]?.version;
    } catch (error) {
      console.error('Error getting schema migration version:', error);
      throw error;
    }
  }
  
  // Determine table names based on schema version
  async determineTables() {
    try {
      const version = await this.getLatestSchemaMigration();
      if (version >= 20250413141446) {
        // Using new simplified schema
        this.entriesTable = 'public.entries';
        this.valuationsTable = 'public.valuations';
        this.valuationKey = 'Valuation';
        this.transactionsTable = 'public.transactions';
        this.transactionKey = 'Transaction';
      } else {
        // Using old Account:: schema
        this.entriesTable = 'public.account_entries';
        this.valuationsTable = 'public.account_valuations';
        this.valuationKey = 'Account::Valuation';
        this.transactionsTable = 'public.account_transactions';
        this.transactionKey = 'Account::Transaction';
      }
    } catch (error) {
      console.error('Error determining tables:', error);
      throw error;
    }
  }
  
  // Get families
  async getFamilies() {
    try {
      return await this.execute('SELECT id, name FROM public.families');
    } catch (error) {
      console.error('Error getting families:', error);
      throw error;
    }
  }
  
  // Get accounts
  async getAccounts(familyId = null) {
    try {
      let query = `
        SELECT
          id,
          name,
          family_id,
          currency,
          accountable_type,
          subtype
        FROM public.accounts
      `;
      
      if (familyId) {
        return await this.execute(query + ' WHERE family_id = $1', [familyId]);
      } else {
        return await this.execute(query);
      }
    } catch (error) {
      console.error('Error getting accounts:', error);
      throw error;
    }
  }
  
  // Get transactions that came from SimpleFIN
  async getSimplefinTransactions(accountId, startDate) {
    try {
      await this.determineTables();
      
      const query = `
        SELECT e.plaid_id, e.entryable_id, t.category_id 
        FROM ${this.entriesTable} e
        LEFT JOIN ${this.transactionsTable} t ON e.entryable_id = t.id
        WHERE e.account_id = $1
        AND e.plaid_id IS NOT NULL
        AND e.date >= (TO_TIMESTAMP($2)::DATE)
      `;
      
      return await this.execute(query, [accountId, startDate]);
    } catch (error) {
      console.error('Error getting SimpleFIN transactions:', error);
      throw error;
    }
  }
  
  // Check if an entry exists
  async entryExists(accountId, date, type) {
    try {
      await this.determineTables();
      
      const query = `
        SELECT id FROM ${this.entriesTable}
        WHERE account_id = $1 AND date = (TO_TIMESTAMP($2)::DATE) AND entryable_type = $3 LIMIT 1
      `;
      
      const result = await this.execute(query, [accountId, date, type]);
      return result[0];
    } catch (error) {
      console.error('Error checking if entry exists:', error);
      throw error;
    }
  }
  
  // Check if a transaction exists by plaid_id
  async transactionExistsByPlaidId(accountId, plaidId) {
    try {
      await this.determineTables();
      
      const query = `
        SELECT e.entryable_id, t.category_id 
        FROM ${this.entriesTable} e
        LEFT JOIN ${this.transactionsTable} t ON e.entryable_id = t.id
        WHERE e.account_id = $1
        AND e.plaid_id = $2
        LIMIT 1
      `;
      
      const result = await this.execute(query, [accountId, plaidId]);
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error(`Error checking if transaction exists by plaid_id ${plaidId}:`, error);
      return null;
    }
  }
  
  // Create a new transaction
  async newTransaction(accountId, simplefinTransaction, currency, categoryId = null) {
    try {
      await this.determineTables();
      
      const amount = simplefinTransaction.amount;
      const shortDate = simplefinTransaction.posted;
      const displayName = simplefinTransaction.description;
      const simplefinTxnId = simplefinTransaction.id;
      
      const transactionUuid = uuidv4();
      const adjustedAmount = parseFloat(amount) * -1;
      
      // Insert the entries entry - without category_id
      const query = `
        INSERT INTO ${this.entriesTable} (
          account_id, entryable_type, entryable_id, amount, currency, date, name, created_at, updated_at, plaid_id
        ) VALUES (
          $1, $2, $3, $4, $5, (TO_TIMESTAMP($6)::DATE), $7, NOW(), NOW(), $8
        )
      `;
      
      const params = [
        accountId,
        this.transactionKey,
        transactionUuid,
        adjustedAmount,
        currency,
        shortDate,
        displayName,
        simplefinTxnId
      ];
      
      await this.execute(query, params);
      
      const transactionQuery = `
        INSERT INTO ${this.transactionsTable} (
          id, created_at, updated_at
        ) VALUES (
          $1, NOW(), NOW()
        )
      `;
      await this.execute(transactionQuery, [transactionUuid]);
      
      if (categoryId) {
        try {
          const updateCategoryQuery = `
            UPDATE ${this.transactionsTable}
            SET category_id = $1, updated_at = NOW()
            WHERE id = $2
          `;
          await this.execute(updateCategoryQuery, [categoryId, transactionUuid]);
        } catch (categoryError) {
          console.log('Note: Could not apply category directly - this may be normal for some Maybe versions', categoryError.message);
        }
      }
      
      return transactionUuid;
    } catch (error) {
      console.error('Error creating new transaction:', error);
      throw error;
    }
  }
  
  // Update an existing transaction's category
  async updateTransactionCategory(transactionId, categoryId) {
    try {
      if (!transactionId || !categoryId) return false;
      
      await this.determineTables();
      
      const updateQuery = `
        UPDATE ${this.transactionsTable}
        SET category_id = $1, updated_at = NOW()
        WHERE id = $2
      `;
      
      await this.execute(updateQuery, [categoryId, transactionId]);
      return true;
    } catch (error) {
      console.error(`Error updating category for transaction ${transactionId}:`, error);
      return false;
    }
  }
  
  // Upsert account valuation for investment accounts
  async upsertAccountValuation(accountId, simplefinAccountData) {
    try {
      await this.determineTables();
      
      const balanceDate = simplefinAccountData['balance-date'];
      const balance = simplefinAccountData.balance;
      
      if (!balanceDate || balance === undefined) {
        console.log('No balance date or balance found in SimpleFIN data');
        return null;
      }
      
      const valuationUuid = uuidv4();
      const balanceDateObj = new Date(balanceDate * 1000);
      const shortDate = balanceDateObj.toISOString().split('T')[0];
      
      // Check if a valuation already exists for this date
      const existingValuation = await this.entryExists(accountId, balanceDate, this.valuationKey);
      
      if (existingValuation) {
        console.log(`Valuation already exists for ${shortDate}, skipping`);
        return existingValuation;
      }
      
      // Insert the entries entry for the valuation
      const entriesQuery = `
        INSERT INTO ${this.entriesTable} (
          account_id, entryable_type, entryable_id, amount, currency, date, name, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, (TO_TIMESTAMP($6)::DATE), $7, NOW(), NOW()
        )
      `;
      
      const entriesParams = [
        accountId,
        this.valuationKey,
        valuationUuid,
        balance,
        'USD',
        balanceDate,
        'Balance Update'
      ];
      
      await this.execute(entriesQuery, entriesParams);
      
      // Insert the valuation record
      const valuationQuery = `
        INSERT INTO ${this.valuationsTable} (
          id, created_at, updated_at
        ) VALUES (
          $1, NOW(), NOW()
        )
      `;
      
      await this.execute(valuationQuery, [valuationUuid]);
      
      console.log(`Created valuation for ${shortDate} with amount ${balance}`);
      return valuationUuid;
    } catch (error) {
      console.error('Error upserting account valuation:', error);
      throw error;
    }
  }
  
  async execute(query, params = []) {
    try {
      console.log('Executing Query:', query);
      console.log('With Parameters:', params);
      
      const result = await this.connection.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Query execution error:', error.message);
      throw error;
    }
  }
  
  // Close the connection
  async close() {
    try {
      await this.connection.end();
    } catch (error) {
      console.error('Error closing connection:', error);
    }
  }
  
  // Static method to create a client using settings
  static async createFromSettings() {
    try {
      const host = await getSetting('maybe_postgres_host');
      const port = await getSetting('maybe_postgres_port');
      const dbname = await getSetting('maybe_postgres_db');
      const user = await getSetting('maybe_postgres_user');
      const password = await getSetting('maybe_postgres_password');
      
      if (!host || !port || !dbname || !user || !password) {
        throw new Error('Maybe database configuration not complete. Please check settings.');
      }
      
      const client = new MaybeClient(host, port, dbname, user, password);
      
      if (!client.connected) {
        throw new Error(`Could not connect to Maybe database: ${client.error_message}`);
      }
      
      // Determine table names based on schema version
      await client.determineTables();
      
      return client;
    } catch (error) {
      console.error('Error creating Maybe client:', error);
      throw error;
    }
  }
}

module.exports = MaybeClient;