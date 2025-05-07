const { 
  createLinkage, 
  getAllLinkages, 
  getLinkageById, 
  updateLinkageStatus,
  deleteLinkage,
  getEnabledLinkages
} = require('../models/linkage');
const { getAccountsByType, getUnlinkedAccountsByType } = require('../models/account');
const { syncLinkage } = require('../services/syncService');

// Track active sync operations
const activeSyncs = new Set();

// Get all linkages
const getLinkages = async (req, res) => {
  try {
    const linkages = await getAllLinkages();
    const simplefinAccounts = await getUnlinkedAccountsByType('simplefin', 'simplefin_account_id');
    const maybeAccounts = await getUnlinkedAccountsByType('maybe', 'maybe_account_id');
    
    res.render('linkages/index', {
      title: 'Account Linkages',
      linkages,
      simplefinAccounts,
      maybeAccounts
    });
  } catch (error) {
    console.error('Error getting linkages:', error);
    req.flash('error_msg', `Error getting linkages: ${error.message}`);
    res.redirect('/');
  }
};

// Create a new linkage
const createNewLinkage = async (req, res) => {
  try {
    const { simplefin_account_id, maybe_account_id } = req.body;
    
    if (!simplefin_account_id || !maybe_account_id) {
      req.flash('error_msg', 'Both SimpleFIN and Maybe accounts must be selected');
      return res.redirect('/linkages');
    }
    
    const linkage = await createLinkage(simplefin_account_id, maybe_account_id);
    
    req.flash('success_msg', 'Linkage created successfully');
    res.redirect('/linkages');
  } catch (error) {
    console.error('Error creating linkage:', error);
    req.flash('error_msg', `Error creating linkage: ${error.message}`);
    res.redirect('/linkages');
  }
};

// Update linkage status
const updateLinkage = async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;
    
    // Convert string "on"/"off" to boolean
    const enabledBool = enabled === 'on';
    
    await updateLinkageStatus(id, enabledBool);
    
    req.flash('success_msg', 'Linkage updated successfully');
    res.redirect('/linkages');
  } catch (error) {
    console.error(`Error updating linkage ${req.params.id}:`, error);
    req.flash('error_msg', `Error updating linkage: ${error.message}`);
    res.redirect('/linkages');
  }
};

// Delete a linkage
const removeLinkage = async (req, res) => {
  try {
    const { id } = req.params;
    
    await deleteLinkage(id);
    
    req.flash('success_msg', 'Linkage deleted successfully');
    res.redirect('/linkages');
  } catch (error) {
    console.error(`Error deleting linkage ${req.params.id}:`, error);
    req.flash('error_msg', `Error deleting linkage: ${error.message}`);
    res.redirect('/linkages');
  }
};

// Sync a linkage
const syncLinkageHandler = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if sync is already in progress for this linkage
    if (activeSyncs.has(id)) {
      console.log(`Sync already in progress for linkage ${id}, skipping duplicate request`);
      req.flash('info_msg', 'Sync already in progress');
      return res.status(200).json({ 
        message: 'Sync already in progress'
      });
    }
    
    // Add to active syncs
    activeSyncs.add(id);
    
    // Start sync in background
    syncLinkage(id)
      .then(result => {
        console.log(`Sync completed for linkage ${id}:`, result);
        // Remove from active syncs when done
        activeSyncs.delete(id);
      })
      .catch(error => {
        console.error(`Error in background sync for linkage ${id}:`, error);
        // Remove from active syncs on error too
        activeSyncs.delete(id);
      });
    
    req.flash('info_msg', 'Sync started in background');
    res.status(200).json({ 
      message: 'Sync started successfully' 
    });
  } catch (error) {
    // Remove from active syncs in case of error
    activeSyncs.delete(req.params.id);
    
    console.error(`Error starting sync for linkage ${req.params.id}:`, error);
    req.flash('error_msg', `Error starting sync: ${error.message}`);
    res.status(500).json({ 
      error: 'Error starting sync',
      message: error.message 
    });
  }
};

// Get the sync status of a linkage
const getSyncStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const linkage = await getLinkageById(id);
    
    if (!linkage) {
      return res.status(404).json({ error: 'Linkage not found' });
    }
    
    // Check if sync is actively running
    const isRunning = activeSyncs.has(id);
    
    // If sync is still running, override the database status
    const syncStatus = isRunning ? 'running' : linkage.sync_status;
    
    res.json({
      sync_status: syncStatus,
      last_sync: linkage.last_sync
    });
  } catch (error) {
    console.error(`Error getting sync status for linkage ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
};

// Run all syncs
const runAllSyncs = async (req, res) => {
  try {
    const enabledLinkages = await getEnabledLinkages();
    let syncStarted = false;
    
    for (const linkage of enabledLinkages) {
      // Skip if already syncing
      if (activeSyncs.has(linkage.id)) {
        continue;
      }
      
      // Add to active syncs
      activeSyncs.add(linkage.id);
      syncStarted = true;
      
      // Start sync in background
      syncLinkage(linkage.id)
        .then(result => {
          console.log(`Sync completed for linkage ${linkage.id}:`, result);
          // Remove from active syncs when done
          activeSyncs.delete(linkage.id);
        })
        .catch(error => {
          console.error(`Error in background sync for linkage ${linkage.id}:`, error);
          // Remove from active syncs on error too
          activeSyncs.delete(linkage.id);
        });
    }
    
    if (syncStarted) {
      res.status(200).json({ 
        message: 'Syncs started successfully' 
      });
    } else {
      res.status(200).json({ 
        message: 'No new syncs started - all linkages are already syncing or none are enabled' 
      });
    }
  } catch (error) {
    console.error('Error starting all syncs:', error);
    res.status(500).json({ 
      error: 'Error starting syncs',
      message: error.message 
    });
  }
};

module.exports = {
  getLinkages,
  createNewLinkage,
  updateLinkage,
  removeLinkage,
  syncLinkageHandler,
  getSyncStatus,
  runAllSyncs
};