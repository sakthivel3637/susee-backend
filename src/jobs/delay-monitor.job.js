async function runDelayMonitorWorkflow() {
  console.info('[Workshop Delay Monitor Job] Disabled. Process stage delays are handled by process-stage-delay-monitor.job.js.');
  return {
    disabled: true
  };
}

function startDelayMonitorJob() {
  console.info('[Workshop Delay Monitor Job] Not registered. Use Process Stage Delay Monitor instead.');
}

module.exports = {
  startDelayMonitorJob,
  runDelayMonitorWorkflow
};
