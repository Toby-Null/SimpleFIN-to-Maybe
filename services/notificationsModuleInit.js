const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Initialize default notification events in the database
 */
const initializeNotificationEvents = async () => {
  try {
    console.log('Initializing notification events...');
    
    // List of all notification methods and events
    const methods = ['email', 'webhook', 'http'];
    const events = [
      'sync_success',
      'sync_error',
      'sync_started',
      'server_start',
      'server_error'
    ];
    
    // First check which events are already in the database
    const existingEvents = await pool.query(
      'SELECT method, event_type FROM notification_events'
    );
    
    const existingEventMap = new Map();
    existingEvents.rows.forEach(row => {
      existingEventMap.set(`${row.method}:${row.event_type}`, true);
    });
    
    // Insert missing events
    for (const method of methods) {
      for (const event of events) {
        const key = `${method}:${event}`;
        
        if (!existingEventMap.has(key)) {
          console.log(`Adding missing notification event: ${method} - ${event}`);
          
          await pool.query(
            `INSERT INTO notification_events 
             (id, method, event_type, enabled, created_at, updated_at)
             VALUES ($1, $2, $3, $4, NOW(), NOW())`,
            [uuidv4(), method, event, false]
          );
        }
      }
    }
    
    // Initialize notification methods if they don't exist
    for (const method of methods) {
      const existingMethod = await pool.query(
        'SELECT id FROM notification_settings WHERE method = $1',
        [method]
      );
      
      if (existingMethod.rows.length === 0) {
        console.log(`Adding missing notification method: ${method}`);
        
        let defaultSettings = {};
        
        switch (method) {
          case 'email':
            defaultSettings = {
              host: '',
              port: '587',
              username: '',
              password: '',
              from: '',
              to: '',
              secure: false
            };
            break;
          case 'webhook':
            defaultSettings = {
              url: '',
              secret: '',
              headers: {}
            };
            break;
          case 'http':
            defaultSettings = {
              url: '',
              method: 'POST',
              headers: {},
              bodyTemplate: '{\n  "event": "{{event}}",\n  "status": "{{status}}",\n  "message": "{{message}}",\n  "timestamp": "{{timestamp}}"\n}'
            };
            break;
        }
        
        await pool.query(
          `INSERT INTO notification_settings
           (id, method, enabled, settings, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          [uuidv4(), method, false, JSON.stringify(defaultSettings)]
        );
      }
    }
    
    console.log('Notification events initialized successfully');
  } catch (error) {
    console.error('Error initializing notification events:', error);
  }
};

// This will run when the service is imported
initializeNotificationEvents().catch(error => {
  console.error('Failed to initialize notification events:', error);
});

module.exports = {
  initializeNotificationEvents
};