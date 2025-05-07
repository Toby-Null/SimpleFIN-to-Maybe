const express = require('express');
const router = express.Router();
const { getAccounts, removeAccount } = require('../controllers/accountsController');

// Get all accounts
router.get('/', getAccounts);

// Delete an account
router.post('/:id/delete', removeAccount);

module.exports = router;