const http = require('http');

const app = require('./app');
const env = require('./config/env');
const prisma = require('./config/db');
const { initializeSocket } = require('./config/socket');
const { initializeFirebase } = require('./config/firebase');
const { initializeTwilio } = require('./config/twilio');
const { startFcmSenderJob } = require('./jobs/fcm-sender.job');
const { startApprovalFollowupJob } = require('./jobs/approval-followup.job');
const { startProcessStageDelayMonitorJob } = require('./jobs/process-stage-delay-monitor.job');

const server = http.createServer(app);

initializeSocket(server);
initializeFirebase();
initializeTwilio();

const startServer = async () => {
  try {
    await prisma.$connect();
    console.info('Database connection established through Prisma.');

    // Start background jobs
    startApprovalFollowupJob();
    startProcessStageDelayMonitorJob();
    
    try {
      startFcmSenderJob();
    } catch (jobErr) {
      console.error('Failed to start FCM Sender Job:', jobErr.message);
    }

    server.listen(env.port, () => {
      console.info(`${env.appName} running on port ${env.port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

const shutdown = async (signal) => {
  console.info(`${signal} received. Shutting down server.`);

  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startServer();
