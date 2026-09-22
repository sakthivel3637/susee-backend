const cron = require('node-cron');
const prisma = require('../config/db');

// Module-level flags
let isRegistered = false;
let isProcessing = false;

async function resolveCrmRecipients(locationId, jobCard) {
  const recipients = new Set();

  const crmUsers = await prisma.user.findMany({
    where: {
      locationId,
      role: { slug: { in: ['crm_team', 'crm-team'] } },
      isActive: true
    },
    select: { id: true }
  });

  for (const user of crmUsers) {
    recipients.add(user.id);
  }

  // Fallback to Location Head
  if (recipients.size === 0) {
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: { locationHeadUserId: true }
    });
    if (location && location.locationHeadUserId) {
      recipients.add(location.locationHeadUserId);
    }
  }

  // Fallback to Job Card creator
  if (recipients.size === 0 && jobCard && jobCard.createdById) {
    recipients.add(jobCard.createdById);
  }

  return Array.from(recipients);
}

/**
 * Main evaluation workflow for pending approvals.
 */
async function runApprovalFollowupWorkflow() {
  const startTime = Date.now();
  console.info('[CRON START] Customer Approval Timeout Job');

  let processedCount = 0;
  let notificationsCreated = 0;

  try {
    // 1. Fetch stage limits configured for approval stages
    const limits = await prisma.stageTimeLimit.findMany({
      where: { isActive: true },
      include: { status: true }
    });

    // Create lookup maps by statusId and stageCode
    const limitsByStatusId = {};
    const limitsByStageCode = {};
    for (const limit of limits) {
      if (limit.statusId) {
        limitsByStatusId[limit.statusId] = limit;
      }
      if (limit.stageCode) {
        limitsByStageCode[limit.stageCode.toUpperCase()] = limit;
      }
    }

    // Default allowed minutes if not explicitly configured in StageTimeLimit
    const DEFAULT_APPROVAL_LIMIT_MINUTES = 60;

    // 2. Fetch pending job card approvals
    // Check both JobCardApproval records and JobCards directly (if current status is APPROVAL_PENDING)
    const pendingApprovals = await prisma.jobCardApproval.findMany({
      where: {
        status: { statusCode: 'PENDING' }
      },
      include: {
        jobCard: {
          include: {
            vehicle: true
          }
        },
        status: true
      }
    });

    for (const approval of pendingApprovals) {
      try {
        const jobCard = approval.jobCard;
        if (!jobCard) continue;

        processedCount++;

        // Determine allowed minutes based on approval type
        let limitMinutes = DEFAULT_APPROVAL_LIMIT_MINUTES;
        const approvalType = String(approval.approvalType || '').toUpperCase();

        // Find limit matching approvalType as stageCode or statusId
        if (approval.statusId && limitsByStatusId[approval.statusId]) {
          limitMinutes = limitsByStatusId[approval.statusId].allowedMinutes;
        } else if (limitsByStageCode[approvalType]) {
          limitMinutes = limitsByStageCode[approvalType].allowedMinutes;
        } else if (limitsByStageCode['APPROVAL_PENDING']) {
          limitMinutes = limitsByStageCode['APPROVAL_PENDING'].allowedMinutes;
        }

        // Calculate elapsed time (use sentAt or fallback to createdAt)
        const referenceTime = approval.sentAt || approval.createdAt;
        const elapsedMs = Date.now() - new Date(referenceTime).getTime();
        const allowedMs = limitMinutes * 60 * 1000;

        if (elapsedMs >= allowedMs) {
          const recipients = await resolveCrmRecipients(jobCard.locationId, jobCard);

          for (const recipientId of recipients) {
            // Check if notification already exists to avoid spamming
            const isAdditional = approvalType.includes('ADDITIONAL') || approvalType.includes('ADD_WORK');
            const notificationType = isAdditional ? 'ADDITIONAL_WORK_TIMEOUT' : 'APPROVAL_TIMEOUT';

            const existingNotification = await prisma.notification.findFirst({
              where: {
                userId: recipientId,
                jobCardId: jobCard.id,
                type: notificationType,
                createdAt: { gte: new Date(referenceTime) }
              }
            });

            if (existingNotification) {
              continue;
            }

            const title = isAdditional ? 'Additional Work Approval Pending' : 'Customer Approval Pending';
            const message = isAdditional
              ? `Additional Work Approval Pending: No response received for the additional repair request on vehicle ${jobCard.vehicle?.registrationNo || jobCard.jobCardNo}. Please contact the customer.`
              : `Customer Approval Pending: No response received from the customer for the service estimate on vehicle ${jobCard.vehicle?.registrationNo || jobCard.jobCardNo}. Please follow up immediately.`;

            await prisma.notification.create({
              data: {
                locationId: jobCard.locationId,
                userId: recipientId,
                jobCardId: jobCard.id,
                title,
                message,
                type: notificationType,
                retryCount: 0
              }
            });

            notificationsCreated++;
          }
        }
      } catch (innerErr) {
        console.error(`[Customer Approval Timeout Job] Error processing approval record ${approval.id}:`, innerErr.message);
      }
    }
  } catch (error) {
    console.error('[Customer Approval Timeout Job] Critical error running workflow:', error.message);
  } finally {
    const duration = Date.now() - startTime;
    console.info('[CRON END] Customer Approval Timeout Job');
    console.info(`- Pending Approvals Processed: ${processedCount}`);
    console.info(`- Notifications Created: ${notificationsCreated}`);
    console.info(`- Execution Time: ${duration} ms`);
  }
}

/**
 * Initialize and register the cron job.
 */
function startApprovalFollowupJob() {
  if (isRegistered) {
    console.info('[Customer Approval Timeout Job] Cron job already registered. Skipping registration.');
    return;
  }

  // Schedule task to run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    if (isProcessing) {
      console.warn('[Customer Approval Timeout Job] Previous execution is still active. Skipping run to prevent overlaps.');
      return;
    }

    try {
      isProcessing = true;
      await runApprovalFollowupWorkflow();
    } finally {
      isProcessing = false;
    }
  });

  isRegistered = true;
  console.info('[Customer Approval Timeout Job] Cron job registered successfully to run every 5 minutes (*/5 * * * *).');
}

module.exports = {
  startApprovalFollowupJob,
  runApprovalFollowupWorkflow
};
