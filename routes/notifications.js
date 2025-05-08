const express = require('express');
const router = express.Router();
const {
  getNotifications,
  toggleNotificationMethod,
  updateNotificationSettingsHandler,
  toggleEventNotification,
  testNotification
} = require('../controllers/notificationsController');

// Get notifications page
router.get('/', getNotifications);

// Toggle notification method
router.post('/:method/toggle', toggleNotificationMethod);

// Update notification settings
router.post('/:method/settings', updateNotificationSettingsHandler);

// Toggle event notification
router.post('/events/:method/:event', toggleEventNotification);

// Test notification
router.post('/:method/test', testNotification);

module.exports = router;