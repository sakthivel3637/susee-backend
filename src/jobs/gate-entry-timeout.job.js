async function runJobWorkflow() {
  console.info('[Gate Entry Timeout Job] Disabled. Process stage delays are handled by process-stage-delay-monitor.job.js.');
  return {
    disabled: true
  };
}

function startGateEntryTimeoutJob() {
  console.info('[Gate Entry Timeout Job] Not registered. Use Process Stage Delay Monitor instead.');
}

module.exports = {
  startGateEntryTimeoutJob,
  runJobWorkflow
};
