const { sendNotification } = require('../models/notification');

/**
 * Send notification for sync success
 * @param {string} linkageId - ID of the linkage
 * @param {Object} details - Additional details about the sync
 * @returns {Promise<void>}
 */
const notifySyncSuccess = async (linkageId, details) => {
  try {
    await sendNotification('sync_success', {
      linkage_id: linkageId,
      status: 'success',
      message: `Synchronization completed successfully for linkage ${linkageId}`,
      details,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error sending sync success notification:', error);
  }
};

/**
 * Send notification for sync error
 * @param {string} linkageId - ID of the linkage
 * @param {Error} error - Error object
 * @returns {Promise<void>}
 */
const notifySyncError = async (linkageId, error) => {
  try {
    await sendNotification('sync_error', {
      linkage_id: linkageId,
      status: 'error',
      message: `Error during synchronization for linkage ${linkageId}: ${error.message}`,
      error: error.stack || error.message,
      timestamp: new Date().toISOString()
    });
  } catch (notifyError) {
    console.error('Error sending sync error notification:', notifyError);
  }
};

/**
 * Send notification for sync started
 * @param {string} linkageId - ID of the linkage
 * @returns {Promise<void>}
 */
const notifySyncStarted = async (linkageId) => {
  try {
    await sendNotification('sync_started', {
      linkage_id: linkageId,
      status: 'started',
      message: `Synchronization started for linkage ${linkageId}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error sending sync started notification:', error);
  }
};

/**
 * Send notification for server start
 * @returns {Promise<void>}
 */
const notifyServerStart = async () => {
  try {
    await sendNotification('server_start', {
      status: 'started',
      message: `SimpleFIN to Maybe server started`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error sending server start notification:', error);
  }
};

/**
 * Send notification for server error
 * @param {Error} error - Error object
 * @returns {Promise<void>}
 */
const notifyServerError = async (error) => {
  try {
    await sendNotification('server_error', {
      status: 'error',
      message: `Critical server error: ${error.message}`,
      error: error.stack || error.message,
      timestamp: new Date().toISOString()
    });
  } catch (notifyError) {
    console.error('Error sending server error notification:', notifyError);
  }
};

/**
 * Apply notification service to sync operations
 * This function integrates the notification service with the sync service
 * @param {Function} syncFunction - The original sync function
 * @returns {Function} - The enhanced sync function with notifications
 */
const withSyncNotifications = (syncFunction) => {
  return async (...args) => {
    const linkageId = args[0]; // First arg is usually linkageId
    
    try {
      // Notify that sync is starting
      await notifySyncStarted(linkageId);
      
      // Call the original sync function
      const result = await syncFunction(...args);
      
      // If sync was successful, send success notification
      if (result.success) {
        await notifySyncSuccess(linkageId, result.details || {});
      } else if (result.error) {
        // If sync failed with an error, send error notification
        await notifySyncError(linkageId, new Error(result.error));
      }
      
      return result;
    } catch (error) {
      // In case of uncaught error, send error notification
      await notifySyncError(linkageId, error);
      throw error; // re-throw the error to maintain original behavior
    }
  };
};

module.exports = {
  notifySyncSuccess,
  notifySyncError,
  notifySyncStarted,
  notifyServerStart,
  notifyServerError,
  withSyncNotifications
};