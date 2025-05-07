// Helper function to format dates
function formatDate(date) {
  if (!date) return 'Never';
  
  const d = new Date(date);
  
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${ampm}`;
}

// Initialize Bootstrap tooltips
document.addEventListener('DOMContentLoaded', function() {
  // Initialize tooltips
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[title]'));
  const tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
    return new bootstrap.Tooltip(tooltipTriggerEl);
  });

  // Auto-dismiss alerts after 5 seconds (but not persistent alerts)
  setTimeout(function() {
    const alerts = document.querySelectorAll('.alert:not(.persistent-alert)');
    alerts.forEach(alert => {
      const bsAlert = new bootstrap.Alert(alert);
      bsAlert.close();
    });
  }, 5000);
  
  // Handle sync now buttons on linkages page
  if (document.querySelector('.sync-now-btn')) {
    setupSyncButtons();
  }
  
  // Handle settings page functionality
  if (document.querySelector('.openModalBtn')) {
    setupSettingsPage();
  }
  
  // Handle rule form functionality
  if (document.querySelector('#add-condition')) {
    setupRuleForm();
  }
});

// Function to set up sync buttons on linkages page
function setupSyncButtons() {
  const syncButtons = document.querySelectorAll('.sync-now-btn');
  let pollingInterval = null;
  let syncingLinkages = new Set(); // Track ongoing syncs
  
  // Enable/disable Save button based on selections
  const simplefinSelect = document.getElementById('simplefin_account_id');
  const maybeSelect = document.getElementById('maybe_account_id');
  const saveButton = document.getElementById('save-button');
  
  if (simplefinSelect && maybeSelect && saveButton) {
    function toggleSaveButton() {
      saveButton.disabled = simplefinSelect.value === '' || maybeSelect.value === '';
    }
    
    simplefinSelect.addEventListener('change', toggleSaveButton);
    maybeSelect.addEventListener('change', toggleSaveButton);
  }
  
  // Function to check sync status
  function checkSyncStatus() {
    if (syncingLinkages.size === 0) {
      clearInterval(pollingInterval);
      pollingInterval = null;
      return;
    }
    
    syncingLinkages.forEach(linkageId => {
      fetch(`/linkages/${linkageId}/sync_status`)
        .then(response => response.json())
        .then(data => {
          const spinner = document.getElementById(`sync-spinner-${linkageId}`);
          const lastSyncElement = document.getElementById(`last-sync-${linkageId}`);
          
          if (["complete", "error"].includes(data.sync_status)) {
            // Change spinner to checkmark or X image
            spinner.src = data.sync_status === "complete" ? 
              spinner.dataset.checkmarkUrl : 
              spinner.dataset.errorUrl;
            
            if (data.last_sync) {
              lastSyncElement.innerHTML = formatDate(data.last_sync);
            }
            
            syncingLinkages.delete(linkageId);
            
            setTimeout(() => {
              spinner.style.display = "none";
              spinner.src = spinner.dataset.spinnerUrl;
              
              // Re-enable the sync button
              const syncButton = document.querySelector(`.sync-now-btn[data-linkage-id="${linkageId}"]`);
              if (syncButton) {
                syncButton.disabled = false;
              }
            }, 3000);
          } else {
            spinner.style.display = "inline-block";
          }
          
          // If all syncs are complete, stop polling
          if (syncingLinkages.size === 0 && pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
          }
        })
        .catch(error => console.error("Error fetching sync status:", error));
    });
  }
  
  // Add event listeners to sync buttons
  syncButtons.forEach(button => {
    button.addEventListener('click', function(e) {
      // Prevent the default action
      e.preventDefault();
      
      // Get the linkage ID
      const linkageId = button.getAttribute('data-linkage-id');
      
      // Disable the button to prevent double clicks
      button.disabled = true;
      
      // Show the spinner
      const spinner = document.getElementById(`sync-spinner-${linkageId}`);
      spinner.style.display = 'inline-block';
      
      // Add this linkage to the tracking set
      syncingLinkages.add(linkageId);
      
      // Make the fetch request
      fetch(`/linkages/${linkageId}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })
      .catch(error => {
        console.error('Error syncing:', error);
        // Re-enable the button in case of error
        button.disabled = false;
      });
      
      // Start polling if not already running
      if (!pollingInterval) {
        pollingInterval = setInterval(checkSyncStatus, 2000);
      }
    });
  });
}

// Function to set up settings page
function setupSettingsPage() {
  // Modal functionality
  const settingModal = document.getElementById('settingModal');
  
  if (!settingModal) return;
  
  const modal = new bootstrap.Modal(settingModal);
  const modalTitle = document.getElementById('modalTitle');
  const settingKey = document.getElementById('settingKey');
  const settingValue = document.getElementById('settingValue');
  const saveBtn = document.getElementById('saveSettingBtn');
  
  document.querySelectorAll('.openModalBtn').forEach(btn => {
    btn.addEventListener('click', function() {
      const key = this.getAttribute('data-key');
      const value = this.getAttribute('data-value');
      const displayName = this.getAttribute('data-display-name');
      
      modalTitle.textContent = `Edit ${displayName}`;
      settingKey.value = key;
      settingValue.value = value;
      
      modal.show();
    });
  });
  
  saveBtn.addEventListener('click', function() {
    const key = settingKey.value;
    const value = settingValue.value;
    
    fetch(`/settings/${key}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ value })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        modal.hide();
        window.location.reload();
      } else {
        alert('Error updating setting');
      }
    })
    .catch(error => {
      console.error('Error:', error);
      alert('An error occurred');
    });
  });
  
  // SimpleFIN and Maybe test functionality
  setupTestButton('test_simplefin_button', 'simplefin_loading_spinner', 'simplefin_test_result', '/settings/test_simplefin', 'simplefin-count-display');
  setupTestButton('test_maybe_button', 'maybe_loading_spinner', 'maybe_test_result', '/settings/test_maybe', 'maybe-count-display');
  
  // Update account counts on page load
  updateAccountCounts();
}

// Function to set up rule form
function setupRuleForm() {
  console.log("Setting up rule form...");
  
  // Check if already initialized to prevent duplicate handlers
  const addConditionBtn = document.getElementById('add-condition');
  const addActionBtn = document.getElementById('add-action');
  const ruleForm = document.getElementById('ruleForm');
  
  // If any of these elements has initialization flag, don't initialize again
  if ((addConditionBtn && addConditionBtn.dataset.initialized === 'true') || 
      (ruleForm && ruleForm.dataset.initialized === 'true')) {
    console.log("Rule form already initialized, skipping setup");
    return;
  }
  
  // Mark elements as initialized
  if (addConditionBtn) addConditionBtn.dataset.initialized = 'true';
  if (addActionBtn) addActionBtn.dataset.initialized = 'true';
  if (ruleForm) ruleForm.dataset.initialized = 'true';
  
  // Handle field type changes
  function updateOperatorOptions() {
    document.querySelectorAll('.condition-row').forEach((row, index) => {
      const fieldSelect = row.querySelector(`select[name^="conditions"][name$="[field]"]`);
      const operatorSelect = row.querySelector(`select[name^="conditions"][name$="[operator]"]`);
      
      if (fieldSelect && operatorSelect) {
        const fieldType = fieldSelect.value === 'transaction_name' ? 'string' : 'number';
        
        // Hide all options first
        Array.from(operatorSelect.options).forEach(option => {
          option.style.display = 'none';
        });
        
        // Show only relevant options
        Array.from(operatorSelect.options).forEach(option => {
          if (option.getAttribute('data-field-type') === fieldType) {
            option.style.display = '';
          }
        });
        
        // Select first visible option if current is hidden
        if (operatorSelect.selectedOptions[0].style.display === 'none') {
          Array.from(operatorSelect.options).forEach(option => {
            if (option.style.display === '') {
              option.selected = true;
              return;
            }
          });
        }
      }
    });
  }
  
  // Add condition - with debounce to prevent double-clicks
  let isAddingCondition = false;
  if (addConditionBtn) {
    // Remove old listeners by cloning and replacing
    const newAddConditionBtn = addConditionBtn.cloneNode(true);
    addConditionBtn.parentNode.replaceChild(newAddConditionBtn, addConditionBtn);
    
    // Add listener to new button
    newAddConditionBtn.addEventListener('click', function() {
      console.log("Add condition clicked");
      
      // Prevent duplicate additions from double-clicks
      if (isAddingCondition) {
        console.log("Already adding condition, ignoring click");
        return;
      }
      
      isAddingCondition = true;
      console.log("Adding new condition...");
      
      const container = document.getElementById('conditions-container');
      const conditionRows = container.querySelectorAll('.condition-row');
      const newIndex = conditionRows.length;
      
      const newRow = document.createElement('div');
      newRow.className = 'condition-row mb-3 p-3 bg-light rounded';
      newRow.innerHTML = `
        <div class="row g-2">
          <div class="col-md-3">
            <label class="form-label small text-muted">Field</label>
            <select class="form-select" name="conditions[${newIndex}][field]" required>
              <option value="transaction_name">Transaction Name</option>
              <option value="transaction_amount">Transaction Amount</option>
            </select>
          </div>
          
          <div class="col-md-3">
            <label class="form-label small text-muted">Operator</label>
            <select class="form-select operator-select" name="conditions[${newIndex}][operator]" required>
              <option value="contains" data-field-type="string">Contains</option>
              <option value="equals" data-field-type="string">Equals</option>
              <option value="equals" data-field-type="number">Equals</option>
              <option value="greater_than" data-field-type="number">Greater Than</option>
              <option value="greater_than_or_equal" data-field-type="number">Greater Than Or Equal</option>
              <option value="less_than" data-field-type="number">Less Than</option>
              <option value="less_than_or_equal" data-field-type="number">Less Than Or Equal</option>
            </select>
          </div>
          
          <div class="col-md-5">
            <label class="form-label small text-muted">Value</label>
            <input type="text" class="form-control" name="conditions[${newIndex}][value]" required>
          </div>
          
          <div class="col-md-1 d-flex align-items-end">
            <button type="button" class="btn btn-outline-danger rounded-circle remove-condition">
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>
      `;
      
      container.appendChild(newRow);
      
      // Enable all remove buttons if more than one condition
      if (conditionRows.length >= 1) {
        document.querySelectorAll('.remove-condition').forEach(btn => {
          btn.removeAttribute('disabled');
        });
      }
      
      updateOperatorOptions();
      
      // Add event listener to new field select
      const newFieldSelect = newRow.querySelector(`select[name="conditions[${newIndex}][field]"]`);
      newFieldSelect.addEventListener('change', updateOperatorOptions);
      
      // Reset the flag after a short delay
      setTimeout(() => {
        isAddingCondition = false;
      }, 500);
    });
  }
  
  // Add action - with debounce to prevent double-clicks
  let isAddingAction = false;
  if (addActionBtn) {
    // Remove old listeners by cloning and replacing
    const newAddActionBtn = addActionBtn.cloneNode(true);
    addActionBtn.parentNode.replaceChild(newAddActionBtn, addActionBtn);
    
    // Add listener to new button
    newAddActionBtn.addEventListener('click', function() {
      console.log("Add action clicked");
      
      // Prevent duplicate additions from double-clicks
      if (isAddingAction) {
        console.log("Already adding action, ignoring click");
        return;
      }
      
      isAddingAction = true;
      console.log("Adding new action...");
      
      const container = document.getElementById('actions-container');
      const actionRows = container.querySelectorAll('.action-row');
      const newIndex = actionRows.length;
      
      // Get categories HTML from existing select
      const categoriesOptions = document.querySelector('select[name^="actions"][name$="[value]"]').innerHTML;
      
      const newRow = document.createElement('div');
      newRow.className = 'action-row mb-3 p-3 bg-light rounded';
      newRow.innerHTML = `
        <div class="row g-2">
          <div class="col-md-3">
            <label class="form-label small text-muted">Action Type</label>
            <select class="form-select" name="actions[${newIndex}][type]" required>
              <option value="set_transaction_category">Assign Category</option>
            </select>
          </div>
          
          <div class="col-md-8">
            <label class="form-label small text-muted">Category</label>
            <select class="form-select" name="actions[${newIndex}][value]" required>
              ${categoriesOptions}
            </select>
          </div>
          
          <div class="col-md-1 d-flex align-items-end">
            <button type="button" class="btn btn-outline-danger rounded-circle remove-action">
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>
      `;
      
      container.appendChild(newRow);
      
      // Enable all remove buttons if more than one action
      if (actionRows.length >= 1) {
        document.querySelectorAll('.remove-action').forEach(btn => {
          btn.removeAttribute('disabled');
        });
      }
      
      // Reset the flag after a short delay
      setTimeout(() => {
        isAddingAction = false;
      }, 500);
    });
  }
  
  // Remove condition - use delegation to avoid binding multiple times
  document.removeEventListener('click', handleRemoveCondition);
  document.addEventListener('click', handleRemoveCondition);
  
  function handleRemoveCondition(e) {
    if (e.target.closest('.remove-condition')) {
      const container = document.getElementById('conditions-container');
      const conditionRows = container.querySelectorAll('.condition-row');
      
      if (conditionRows.length > 1) {
        e.target.closest('.condition-row').remove();
        
        // If only one condition left, disable its remove button
        if (container.querySelectorAll('.condition-row').length === 1) {
          container.querySelector('.remove-condition').setAttribute('disabled', '');
        }
        
        // Update indices in names
        renumberInputs(container, 'conditions');
      }
    }
  }
  
  // Remove action - use delegation to avoid binding multiple times
  document.removeEventListener('click', handleRemoveAction);
  document.addEventListener('click', handleRemoveAction);
  
  function handleRemoveAction(e) {
    if (e.target.closest('.remove-action')) {
      const container = document.getElementById('actions-container');
      const actionRows = container.querySelectorAll('.action-row');
      
      if (actionRows.length > 1) {
        e.target.closest('.action-row').remove();
        
        // If only one action left, disable its remove button
        if (container.querySelectorAll('.action-row').length === 1) {
          container.querySelector('.remove-action').setAttribute('disabled', '');
        }
        
        // Update indices in names
        renumberInputs(container, 'actions');
      }
    }
  }
  
  // Function to renumber inputs after removal
  function renumberInputs(container, prefix) {
    const rows = container.querySelectorAll(prefix === 'conditions' ? '.condition-row' : '.action-row');
    
    rows.forEach((row, index) => {
      // Update field names with new indices
      row.querySelectorAll(`[name^="${prefix}["]`).forEach(input => {
        const nameParts = input.name.split('[');
        const endPart = nameParts[1].indexOf(']') !== -1 ? 
          nameParts[1].substring(nameParts[1].indexOf(']')) : 
          nameParts[1];
        
        input.name = `${prefix}[${index}]${endPart}`;
      });
    });
  }
  
  // Initialize operator options on page load
  updateOperatorOptions();
  
  // Add event listeners to initial field selects
  document.querySelectorAll('select[name^="conditions"][name$="[field]"]').forEach(select => {
    select.addEventListener('change', updateOperatorOptions);
  });
}

// Function to set up test buttons on settings page
function setupTestButton(buttonId, spinnerId, resultId, url, countDisplayId) {
  const button = document.getElementById(buttonId);
  const spinner = document.getElementById(spinnerId);
  const resultContainer = document.getElementById(resultId);
  const countDisplay = document.getElementById(countDisplayId);
  
  if (!button || !spinner || !resultContainer) return;
  
  button.addEventListener('click', function() {
    spinner.style.display = 'inline-block';
    resultContainer.innerHTML = '';
    
    fetch(url)
      .then(response => response.json())
      .then(data => {
        resultContainer.innerHTML = `<pre class="mt-2 bg-light p-3 rounded">${data.output}</pre>`;
        if (countDisplay) {
          countDisplay.textContent = data.account_count;
        }
      })
      .catch(error => {
        console.error('Error:', error);
        resultContainer.innerHTML = `<div class="alert alert-danger mt-2">Error: ${error.message}</div>`;
      })
      .finally(() => {
        spinner.style.display = 'none';
      });
  });
}

// Function to update account counts on settings page
function updateAccountCounts() {
  const simplefinCount = document.getElementById('simplefin-count-display');
  const maybeCount = document.getElementById('maybe-count-display');
  
  if (!simplefinCount || !maybeCount) return;
  
  fetch('/settings/test_simplefin?countOnly=true')
    .then(response => response.json())
    .then(data => {
      simplefinCount.textContent = data.account_count;
    })
    .catch(error => console.error('Error:', error));
  
  fetch('/settings/test_maybe?countOnly=true')
    .then(response => response.json())
    .then(data => {
      maybeCount.textContent = data.account_count;
    })
    .catch(error => console.error('Error:', error));
}

// Function to get the next execution time for a cron expression
function getNextCronExecution(cronExpression) {
  // Simplified implementation - in production you'd use a library
  const now = new Date();
  
  // Parse very basic cron expressions like "0 0 * * *" (midnight every day)
  const parts = cronExpression.split(' ');
  
  if (parts.length !== 5) {
    return 'Invalid cron expression';
  }
  
  // For simplicity, just return a general indication based on the expression
  if (parts[0] === '0' && parts[1] === '0') {
    return 'Next: Midnight tonight';
  } else if (parts[0] === '0' && parts[1].includes(',')) {
    return 'Next: Today at specified hours';
  } else if (parts[0] === '0' && parts[1] !== '*') {
    return `Next: Today at ${parts[1]}:00`;
  } else if (parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
    return 'Daily at specified time';
  } else {
    return 'Based on cron schedule';
  }
}

function confirmAccountDeletion(accountId, accountName, hasLinkages) {
  let message = `Are you sure you want to delete the account "${accountName}"?`;

  if (hasLinkages) {
    message = `WARNING: The account "${accountName}" is used in linkages. Deleting it will also delete all associated linkages. Are you sure?`;
  }

  if (confirm(message)) {
    // Set force to true for linked accounts
    if (hasLinkages) {
      document.getElementById(`force-${accountId}`).value = "true";
    }
    document.getElementById(`delete-form-${accountId}`).submit();
  }
}