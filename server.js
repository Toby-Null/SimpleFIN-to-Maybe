require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const morgan = require('morgan');
const methodOverride = require('method-override');
const flash = require('express-flash');
const path = require('path');
const bodyParser = require('body-parser');
const { pool } = require('./config/database');
const cron = require('node-cron');
const syncService = require('./services/syncService');
const { notifyServerStart, notifyServerError } = require('./services/notificationService');
const { checkBudgets } = require('./services/budgetNotificationService');
require('./services/notificationsModuleInit');

// Import routes
const accountsRoutes = require('./routes/accounts');
const linkagesRoutes = require('./routes/linkages');
const settingsRoutes = require('./routes/settings');
const rulesRoutes = require('./routes/rules');
const notificationsRoutes = require('./routes/notifications');
const budgetsRoutes = require('./routes/budgets');


const app = express();

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(methodOverride('_method'));

// Session setup
app.use(session({
  store: new PgSession({
    pool,
    tableName: 'user_sessions'
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
}));

app.use(flash());

// Global variables middleware
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.info_msg = req.flash('info_msg');
  next();
});

// Routes
app.use('/accounts', accountsRoutes);
app.use('/linkages', linkagesRoutes);
app.use('/settings', settingsRoutes);
app.use('/rules', rulesRoutes);
app.use('/notifications', notificationsRoutes);
app.use('/budgets', budgetsRoutes);

// Home route (redirects to linkages)
app.get('/', (req, res) => {
  res.redirect('/linkages');
});

// Health check endpoint
app.get('/up', (req, res) => {
  res.status(200).send('OK');
});

app.use((req, res, next) => {
  const err = new Error(`Page Not Found: ${req.originalUrl}`);
  err.status = 404;
  next(err);
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500);
  res.locals.title = `Error ${err.status || 500}`;
  res.render('error', {
    error: err,
    message: err.message || 'An unexpected error occurred',
    status: err.status || 500,
    title: res.locals.title
  });
});

// Set up cron job for scheduled syncs
const setupCronJobs = async () => {
  try {
    const { getSetting } = require('./models/setting');
    const cronSchedule = await getSetting('synchronization_schedule') || process.env.SYNC_SCHEDULE;
    
    if (cronSchedule && cron.validate(cronSchedule)) {
      // Set up sync job (which includes budget checking)
      cron.schedule(cronSchedule, async () => {
        console.log(`Running scheduled sync at ${new Date().toISOString()}`);
        try {
          // This will run budget checks as part of the sync process
          await syncService.runAllSyncs();
        } catch (error) {
          console.error('Error during scheduled sync:', error);
        }
      });
      console.log(`Scheduled sync set up with cron pattern: ${cronSchedule}`);
    } else {
      console.log('No valid cron schedule found. Scheduled syncs are disabled.');
    }
  } catch (error) {
    console.error('Error setting up cron job:', error);
  }
};


// Start server
const PORT = process.env.PORT || 9501;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  try {
    // Run existing setup operations
    await setupCronJobs();
    
    // Send server start notification
    await notifyServerStart();
  } catch (error) {
    console.error('Error during server startup:', error);
  }
});

process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  
  try {
    // Send server error notification
    await notifyServerError(error);
  } catch (notifyError) {
    console.error('Error sending error notification:', notifyError);
  }
  
  // Exit with error code after a delay to allow notification to be sent
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});