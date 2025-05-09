const { 
  getNotificationSettings, 
  updateNotificationMethod, 
  updateNotificationSettings,
  updateEventSettings,
  getEventSettings
} = require('../models/notification');
const nodemailer = require('nodemailer');
const axios = require('axios');
const crypto = require('crypto');

// Get notifications page
const getNotifications = async (req, res) => {
  try {
    // Get notification settings
    const emailSettings = await getNotificationSettings('email');
    const webhookSettings = await getNotificationSettings('webhook');
    const httpSettings = await getNotificationSettings('http');
    
    // Get event settings
    const eventSettings = await getEventSettings();
    
    res.render('notifications/index', {
      title: 'Notifications',
      emailSettings,
      webhookSettings,
      httpSettings,
      eventSettings
    });
  } catch (error) {
    console.error('Error getting notifications:', error);
    req.flash('error_msg', `Error getting notifications: ${error.message}`);
    res.redirect('/');
  }
};

// Toggle notification method
const toggleNotificationMethod = async (req, res) => {
  try {
    const { method } = req.params;
    const { enabled } = req.body;
    
    // Validate method
    if (!['email', 'webhook', 'http'].includes(method)) {
      return res.status(400).json({ success: false, error: 'Invalid notification method' });
    }
    
    // Update method enabled status
    await updateNotificationMethod(method, enabled);
    
    return res.json({ success: true });
  } catch (error) {
    console.error(`Error toggling ${req.params.method} notifications:`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Update notification settings
const updateNotificationSettingsHandler = async (req, res) => {
  try {
    const { method } = req.params;
    
    // Validate method
    if (!['email', 'webhook', 'http'].includes(method)) {
      return res.status(400).json({ success: false, error: 'Invalid notification method' });
    }
    
    // Update settings
    await updateNotificationSettings(method, req.body);
    
    return res.json({ success: true });
  } catch (error) {
    console.error(`Error updating ${req.params.method} settings:`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Toggle event notification
const toggleEventNotification = async (req, res) => {
  try {
    const { method, event } = req.params;
    const { enabled } = req.body;
    
    // Validate method and event
    if (!['email', 'webhook', 'http'].includes(method)) {
      return res.status(400).json({ success: false, error: 'Invalid notification method' });
    }
    
    const validEvents = ['sync_success', 'sync_error', 'sync_started', 'server_start', 'server_error', 'budget_exceeded'];
    if (!validEvents.includes(event)) {
      return res.status(400).json({ success: false, error: 'Invalid event type' });
    }
    
    // Update event settings
    await updateEventSettings(method, event, enabled);
    
    return res.json({ success: true });
  } catch (error) {
    console.error(`Error toggling event notification:`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Test notification
const testNotification = async (req, res) => {
  try {
    const { method } = req.params;
    
    // Get notification settings
    const settings = await getNotificationSettings(method);
    
    if (!settings || !settings.enabled) {
      return res.status(400).json({ 
        success: false, 
        error: `${method.charAt(0).toUpperCase() + method.slice(1)} notifications are not enabled` 
      });
    }
    
    let result;
    
    // Send test notification based on method
    try {
      switch (method) {
        case 'email':
          result = await testEmailNotification(settings);
          break;
        case 'webhook':
          result = await testWebhookNotification(settings);
          break;
        case 'http':
          result = await testHttpNotification(settings);
          break;
        default:
          return res.status(400).json({ success: false, error: 'Invalid notification method' });
      }
      
      // For webhook and HTTP tests, check if there was an error in the result
      if ((method === 'webhook' || method === 'http') && result.error) {
        return res.json({
          success: false,
          error: result.error,
          details: {
            status: result.status,
            statusText: result.statusText,
            data: result.data,
            url: result.url,
            payload: result.payload
          }
        });
      }
      
      // Success case
      return res.json({ success: true, details: result });
      
    } catch (methodError) {
      console.error(`Error testing ${method} notification:`, methodError);
      return res.status(500).json({ 
        success: false, 
        error: methodError.message,
        details: {
          method: method,
          settings: {
            ...settings,
            // Mask sensitive values for security
            password: settings.password ? '********' : undefined,
            secret: settings.secret ? '********' : undefined
          }
        }
      });
    }
  } catch (error) {
    console.error(`Error testing ${req.params.method} notification:`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Helper function to test email notification
const testEmailNotification = async (settings) => {
  // Create transporter
  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure === 'on',
    auth: {
      user: settings.username,
      pass: settings.password
    }
  });
  
  // Send mail
  const info = await transporter.sendMail({
    from: settings.from,
    to: settings.to,
    subject: 'SimpleFIN to Maybe - Test Notification',
    text: 'This is a test notification from SimpleFIN to Maybe.',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #0066cc;">SimpleFIN to Maybe - Test Notification</h2>
        <p>This is a test notification from your SimpleFIN to Maybe application.</p>
        <p>If you received this email, your email notification settings are working correctly.</p>
        <p>Time: ${new Date().toISOString()}</p>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
        <p style="color: #666; font-size: 12px;">This is an automated message, please do not reply.</p>
      </div>
    `
  });
  
  return {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    time: new Date().toISOString()
  };
};

// Helper function to test webhook notification
const testWebhookNotification = async (settings) => {
  try {
    const basePayload = {
      event: 'test_notification',
      status: 'success',
      message: 'This is a test notification',
      timestamp: new Date().toISOString()
    };
    
    // Determine webhook type based on URL
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
      // Format for Google Chat API
      payload = {
        text: `*SimpleFIN to Maybe - Test Notification*\n\n${basePayload.message}\n\nEvent: ${basePayload.event}\nStatus: ${basePayload.status}\nTime: ${basePayload.timestamp}`
      };
      
      console.log('Using Google Chat format for webhook test');
    } 
    else if (isDiscord) {
      // Format for Discord Webhook API
      payload = {
        embeds: [{
          title: 'SimpleFIN to Maybe - Test Notification',
          description: basePayload.message,
          color: 0x0099ff, // Blue color
          fields: [
            {
              name: 'Event',
              value: basePayload.event,
              inline: true
            },
            {
              name: 'Status',
              value: basePayload.status,
              inline: true
            }
          ],
          timestamp: basePayload.timestamp,
          footer: {
            text: 'SimpleFIN to Maybe'
          }
        }],
        username: 'SimpleFIN to Maybe' // Optional custom username
      };
      
      console.log('Using Discord format for webhook test');
    }
    else {
      // Standard webhook format
      payload = basePayload;
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
    
    // Add error handling with proper response
    try {
      // Send webhook
      const response = await axios.post(settings.url, payload, { headers });
      
      return {
        status: response.status,
        data: response.data,
        headers: headers,
        payload: payload,
        webhookType: isGoogleChat ? 'Google Chat' : (isDiscord ? 'Discord' : 'Standard'),
        time: new Date().toISOString()
      };
    } catch (error) {
      // Provide more detailed error information
      console.error(`Webhook request failed: ${error.message}`);
      
      // Return both error and partial response info
      return {
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        payload: payload, // What we tried to send
        headers: headers,
        url: settings.url,
        webhookType: isGoogleChat ? 'Google Chat' : (isDiscord ? 'Discord' : 'Standard'),
        time: new Date().toISOString()
      };
    }
  } catch (error) {
    console.error(`Error preparing webhook notification:`, error);
    throw error;
  }
};

// Helper function to test HTTP notification
const testHttpNotification = async (settings) => {
  const placeholders = {
    event: 'test_notification',
    status: 'success',
    message: 'This is a test notification',
    timestamp: new Date().toISOString(),
    linkage_id: 'test-linkage-id'
  };
  
  // Replace placeholders in body template
  let body = settings.bodyTemplate || '';
  
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
  
  const response = await axios({
    url: settings.url,
    ...options
  });
  
  return {
    status: response.status,
    data: response.data,
    headers: headers,
    method: settings.method,
    url: settings.url,
    body: options.data,
    time: new Date().toISOString()
  };
};

module.exports = {
  getNotifications,
  toggleNotificationMethod,
  updateNotificationSettingsHandler,
  toggleEventNotification,
  testNotification
};