const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const axios = require('axios');
const crypto = require('crypto');

// Get notification settings
const getNotificationSettings = async (method) => {
  try {
    const result = await pool.query(
      `SELECT * FROM notification_settings WHERE method = $1`,
      [method]
    );
    
    if (result.rows.length === 0) {
      // Return default settings
      return getDefaultSettings(method);
    }
    
    // Parse settings
    const settings = result.rows[0];
    if (settings.settings && typeof settings.settings === 'string') {
      settings.settings = JSON.parse(settings.settings);
    }
    
    return {
      enabled: settings.enabled,
      ...settings.settings
    };
  } catch (error) {
    console.error(`Error getting ${method} notification settings:`, error);
    throw error;
  }
};

// Get default settings for a notification method
const getDefaultSettings = (method) => {
  switch (method) {
    case 'email':
      return {
        enabled: false,
        host: '',
        port: '587',
        username: '',
        password: '',
        from: '',
        to: '',
        secure: false
      };
    case 'webhook':
      return {
        enabled: false,
        url: '',
        secret: '',
        headers: {}
      };
    case 'http':
      return {
        enabled: false,
        url: '',
        method: 'POST',
        headers: {},
        bodyTemplate: '{\n  "event": "{{event}}",\n  "status": "{{status}}",\n  "message": "{{message}}",\n  "timestamp": "{{timestamp}}"\n}'
      };
    default:
      return { enabled: false };
  }
};

// Toggle notification method
const updateNotificationMethod = async (method, enabled) => {
  try {
    // Check if settings exist
    const existingResult = await pool.query(
      `SELECT id FROM notification_settings WHERE method = $1`,
      [method]
    );
    
    if (existingResult.rows.length === 0) {
      // Create new settings
      await pool.query(
        `INSERT INTO notification_settings (id, method, enabled, settings, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [uuidv4(), method, enabled, JSON.stringify(getDefaultSettings(method))]
      );
    } else {
      // Update existing settings
      await pool.query(
        `UPDATE notification_settings
         SET enabled = $1, updated_at = NOW()
         WHERE method = $2`,
        [enabled, method]
      );
    }
    
    return true;
  } catch (error) {
    console.error(`Error updating ${method} notification method:`, error);
    throw error;
  }
};

// Update notification settings
const updateNotificationSettings = async (method, settings) => {
  try {
    // Check if settings exist
    const existingResult = await pool.query(
      `SELECT id FROM notification_settings WHERE method = $1`,
      [method]
    );
    
    // Clean up settings to only include relevant fields
    const cleanSettings = {};
    
    switch (method) {
      case 'email':
        cleanSettings.host = settings.host || '';
        cleanSettings.port = settings.port || '587';
        cleanSettings.username = settings.username || '';
        cleanSettings.password = settings.password || '';
        cleanSettings.from = settings.from || '';
        cleanSettings.to = settings.to || '';
        cleanSettings.secure = settings.secure === 'on';
        break;
      case 'webhook':
        cleanSettings.url = settings.url || '';
        cleanSettings.secret = settings.secret || '';
        cleanSettings.headers = settings.headers || {};
        break;
      case 'http':
        cleanSettings.url = settings.url || '';
        cleanSettings.method = settings.method || 'POST';
        cleanSettings.headers = settings.headers || {};
        cleanSettings.bodyTemplate = settings.bodyTemplate || '';
        break;
    }
    
    if (existingResult.rows.length === 0) {
      // Create new settings
      await pool.query(
        `INSERT INTO notification_settings (id, method, enabled, settings, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [uuidv4(), method, true, JSON.stringify(cleanSettings)]
      );
    } else {
      // Update existing settings
      await pool.query(
        `UPDATE notification_settings
         SET settings = $1, updated_at = NOW()
         WHERE method = $2`,
        [JSON.stringify(cleanSettings), method]
      );
    }
    
    return true;
  } catch (error) {
    console.error(`Error updating ${method} notification settings:`, error);
    throw error;
  }
};

// Get event settings
const getEventSettings = async () => {
  try {
    const result = await pool.query(
      `SELECT * FROM notification_events`
    );
    
    // Format event settings
    const eventSettings = {
      email: [],
      webhook: [],
      http: []
    };
    
    // Add enabled events to respective arrays
    result.rows.forEach(row => {
      if (row.enabled) {
        eventSettings[row.method].push(row.event_type);
      }
    });
    
    return eventSettings;
  } catch (error) {
    console.error('Error getting notification event settings:', error);
    throw error;
  }
};

// Update event settings
const updateEventSettings = async (method, event, enabled) => {
  try {
    // Check if event settings exist
    const existingResult = await pool.query(
      `SELECT id FROM notification_events 
       WHERE method = $1 AND event_type = $2`,
      [method, event]
    );
    
    if (existingResult.rows.length === 0) {
      // Create new event settings
      await pool.query(
        `INSERT INTO notification_events (id, method, event_type, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [uuidv4(), method, event, enabled]
      );
    } else {
      // Update existing event settings
      await pool.query(
        `UPDATE notification_events
         SET enabled = $1, updated_at = NOW()
         WHERE method = $2 AND event_type = $3`,
        [enabled, method, event]
      );
    }
    
    return true;
  } catch (error) {
    console.error(`Error updating ${method} ${event} event settings:`, error);
    throw error;
  }
};

// Send notification
const sendNotification = async (event, data) => {
  try {
    // Get all enabled notification methods for this event
    const result = await pool.query(
      `SELECT ne.method, ns.enabled as method_enabled, ns.settings
       FROM notification_events ne
       JOIN notification_settings ns ON ne.method = ns.method
       WHERE ne.event_type = $1 AND ne.enabled = true AND ns.enabled = true`,
      [event]
    );
    
    // If no enabled notifications, return
    if (result.rows.length === 0) {
      return;
    }
    
    // Send notification for each enabled method
    for (const row of result.rows) {
      try {
        if (!row.method_enabled) {
          continue;
        }
        
        const settings = typeof row.settings === 'string' 
          ? JSON.parse(row.settings) 
          : row.settings;
        
        switch (row.method) {
          case 'email':
            await sendEmailNotification(settings, event, data);
            break;
          case 'webhook':
            await sendWebhookNotification(settings, event, data);
            break;
          case 'http':
            await sendHttpNotification(settings, event, data);
            break;
        }
      } catch (methodError) {
        console.error(`Error sending ${row.method} notification for event ${event}:`, methodError);
        // Continue with other methods even if one fails
      }
    }
    
    return true;
  } catch (error) {
    console.error(`Error sending notification for event ${event}:`, error);
    // Don't throw error to prevent critical processes from failing
    return false;
  }
};

// Helper function to send email notification
const sendEmailNotification = async (settings, event, data) => {
  try {
    // Create transporter
    const transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: {
        user: settings.username,
        pass: settings.password
      }
    });
    
    // Prepare email content
    const subject = `SimpleFIN to Maybe - ${formatEventName(event)}`;
    const text = `${data.message}\n\nTime: ${data.timestamp}`;
    const html = getEmailHtml(event, data);
    
    // Send mail
    await transporter.sendMail({
      from: settings.from,
      to: settings.to,
      subject,
      text,
      html
    });
    
    return true;
  } catch (error) {
    console.error(`Error sending email notification for event ${event}:`, error);
    throw error;
  }
};

// Helper function to send webhook notification
const sendWebhookNotification = async (settings, event, data) => {
  try {
    // Determine the webhook type based on URL
    const isGoogleChat = settings.url && (
      settings.url.includes('chat.googleapis.com') || 
      settings.url.includes('chat.google.com')
    );
    
    const isDiscord = settings.url && (
      settings.url.includes('discord.com/api/webhooks') || 
      settings.url.includes('discordapp.com/api/webhooks')
    );
    
    let payload;
    let headers = {
      'Content-Type': 'application/json'
    };
    
    if (isGoogleChat) {
      // Format message for Google Chat
      let message = `*SimpleFIN to Maybe - ${formatEventName(event)}*\n\n${data.message}\n\n`;
      
      // Add event-specific details for Google Chat
      switch (event) {
        case 'sync_success':
          if (data.details) {
            message += `📊 *Details:*\n`;
            if (data.details.simplefin_account) message += `• SimpleFIN Account: ${data.details.simplefin_account}\n`;
            if (data.details.maybe_account) message += `• Maybe Account: ${data.details.maybe_account}\n`;
            if (data.details.transactions_processed) message += `• Transactions Processed: ${data.details.transactions_processed}\n`;
          }
          break;
        case 'sync_error':
          if (data.error) {
            message += `❌ *Error:*\n\`\`\`\n${data.error}\n\`\`\`\n`;
          }
          break;
        case 'server_error':
          if (data.error) {
            message += `❌ *Error:*\n\`\`\`\n${data.error}\n\`\`\`\n`;
          }
          break;
      }
      
      // Add timestamp
      message += `\n⏱️ *Time:* ${data.timestamp}`;
      
      // Google Chat payload format
      payload = {
        text: message
      };
    }
    else if (isDiscord) {
      // Discord uses embeds for rich formatting
      // Set color based on event type
      let color = 0x0099ff; // Default blue
      switch (event) {
        case 'sync_success':
          color = 0x00ff00; // Green
          break;
        case 'sync_error':
        case 'server_error':
          color = 0xff0000; // Red
          break;
        case 'sync_started':
          color = 0xffaa00; // Orange
          break;
        case 'server_start':
          color = 0x00ffff; // Cyan
          break;
      }
      
      // Create embed object
      const embed = {
        title: `SimpleFIN to Maybe - ${formatEventName(event)}`,
        description: data.message,
        color: color,
        timestamp: data.timestamp,
        footer: {
          text: 'SimpleFIN to Maybe'
        },
        fields: []
      };
      
      // Add event-specific fields
      switch (event) {
        case 'sync_success':
          if (data.details) {
            if (data.details.simplefin_account) {
              embed.fields.push({
                name: 'SimpleFIN Account',
                value: data.details.simplefin_account,
                inline: true
              });
            }
            if (data.details.maybe_account) {
              embed.fields.push({
                name: 'Maybe Account',
                value: data.details.maybe_account,
                inline: true
              });
            }
            if (data.details.transactions_processed) {
              embed.fields.push({
                name: 'Transactions Processed',
                value: data.details.transactions_processed.toString(),
                inline: true
              });
            }
          }
          break;
        case 'sync_error':
        case 'server_error':
          if (data.error) {
            embed.fields.push({
              name: 'Error',
              value: `\`\`\`\n${data.error.substring(0, 1000)}\n\`\`\``, // Discord has a 1024 char limit per field
            });
          }
          break;
        case 'sync_started':
          if (data.linkage_id) {
            embed.fields.push({
              name: 'Linkage ID',
              value: data.linkage_id,
              inline: true
            });
          }
          break;
      }
      
      // Discord webhook format
      payload = {
        content: null, // No plain text content
        embeds: [embed],
        username: 'SimpleFIN to Maybe', // Optional custom username
        avatar_url: null // Optional custom avatar
      };
    }
    else {
      // Standard webhook format - include all data
      payload = {
        event,
        ...data
      };
    }
    
    // Add custom headers
    if (settings.headers) {
      Object.assign(headers, settings.headers);
    }
    
    // Add signature header if secret is provided and not Google Chat/Discord
    if (settings.secret && !isGoogleChat && !isDiscord) {
      const signature = crypto
        .createHmac('sha256', settings.secret)
        .update(JSON.stringify(payload))
        .digest('hex');
      
      headers['X-Signature'] = signature;
    }
    
    // Send webhook with better error handling
    try {
      const response = await axios.post(settings.url, payload, { headers });
      return true;
    } catch (error) {
      console.error(`Webhook request failed for event ${event}:`, 
        error.message, 
        error.response?.status, 
        error.response?.statusText,
        error.response?.data
      );
      // Re-throw to be handled by the caller
      throw error;
    }
  } catch (error) {
    console.error(`Error sending webhook notification for event ${event}:`, error);
    throw error;
  }
};

// Helper function to send HTTP notification
const sendHttpNotification = async (settings, event, data) => {
  try {
    // Replace placeholders in body template
    let body = settings.bodyTemplate || '';
    
    // Add event to data
    const placeholders = {
      event,
      ...data
    };
    
    // Replace all placeholders
    Object.keys(placeholders).forEach(key => {
      body = body.replace(new RegExp(`{{${key}}}`, 'g'), placeholders[key]);
    });
    
    let headers = {
      'Content-Type': 'application/json'
    };
    
    // Add custom headers
    if (settings.headers) {
      Object.assign(headers, settings.headers);
    }
    
    // Make HTTP request
    const options = {
      method: settings.method || 'POST',
      headers: headers
    };
    
    if (['POST', 'PUT', 'PATCH'].includes(settings.method)) {
      options.data = JSON.parse(body);
    }
    
    await axios({
      url: settings.url,
      ...options
    });
    
    return true;
  } catch (error) {
    console.error(`Error sending HTTP notification for event ${event}:`, error);
    throw error;
  }
};

// Helper function to format event name
const formatEventName = (event) => {
  return event
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// Helper function to generate HTML email content
const getEmailHtml = (event, data) => {
  let details = '';
  
  // Add event-specific details
  switch (event) {
    case 'sync_success':
      if (data.details) {
        details = `
          <p><strong>SimpleFIN Account:</strong> ${data.details.simplefin_account || 'N/A'}</p>
          <p><strong>Maybe Account:</strong> ${data.details.maybe_account || 'N/A'}</p>
          <p><strong>Transactions Processed:</strong> ${data.details.transactions_processed || 0}</p>
        `;
      }
      break;
    case 'sync_error':
      if (data.error) {
        details = `
          <p><strong>Error:</strong></p>
          <pre style="background-color: #f8f8f8; padding: 10px; border-radius: 4px; overflow: auto;">${data.error}</pre>
        `;
      }
      break;
    case 'server_error':
      if (data.error) {
        details = `
          <p><strong>Error:</strong></p>
          <pre style="background-color: #f8f8f8; padding: 10px; border-radius: 4px; overflow: auto;">${data.error}</pre>
        `;
      }
      break;
  }
  
  // Generate full HTML email
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #0066cc;">SimpleFIN to Maybe - ${formatEventName(event)}</h2>
      <p>${data.message}</p>
      ${details}
      <p><strong>Time:</strong> ${data.timestamp}</p>
      <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
      <p style="color: #666; font-size: 12px;">This is an automated message, please do not reply.</p>
    </div>
  `;
};

module.exports = {
  getNotificationSettings,
  updateNotificationMethod,
  updateNotificationSettings,
  getEventSettings,
  updateEventSettings,
  sendNotification
};