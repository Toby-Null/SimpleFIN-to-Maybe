const express = require('express');
const router = express.Router();
const {
  getLinkages,
  createNewLinkage,
  updateLinkage,
  removeLinkage,
  syncLinkageHandler,
  getSyncStatus
} = require('../controllers/linkagesController');
const { runAllSyncs } = require('../services/syncService');

// Get all linkages
router.get('/', getLinkages);

// Create a new linkage
router.post('/', createNewLinkage);

// Update a linkage
router.post('/:id/update', updateLinkage);

// Delete a linkage
router.post('/:id/delete', removeLinkage);

// Sync a linkage
router.post('/:id/sync', syncLinkageHandler);

// Get sync status
router.get('/:id/sync_status', getSyncStatus);

// Run all syncs
router.post('/run_all_syncs', async (req, res) => {
  try {
    runAllSyncs()
      .then(result => {
        console.log('All syncs completed:', result);
      })
      .catch(error => {
        console.error('Error in background sync for all linkages:', error);
      });
    
    res.status(200).json({ 
      message: 'Syncs started successfully' 
    });
  } catch (error) {
    console.error('Error starting all syncs:', error);
    res.status(500).json({ 
      error: 'Error starting syncs',
      message: error.message 
    });
  }
});

module.exports = router;