const express = require('express');
const router = express.Router();
const {
  getSettings,
  updateSetting,
  testSimplefin,
  testMaybe,
  resetDatabase,
  getScheduleDisplay
} = require('../controllers/settingsController');

// Get all settings
router.get('/', getSettings);

// Update a setting
router.post('/:id', updateSetting);

// Test SimpleFIN connection
router.get('/test_simplefin', testSimplefin);

// Test Maybe connection
router.get('/test_maybe', testMaybe);

// Reset database
router.post('/reset_database', resetDatabase);

// Get schedule display
router.get('/schedule_display', getScheduleDisplay);

module.exports = router;