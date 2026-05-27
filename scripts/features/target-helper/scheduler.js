// Schedules a callback without blocking Foundry hook execution.
export function schedule(callback, delay = 0) {
  window.setTimeout(() => {
    void callback();
  }, delay);
}

// Schedules the same callback across retry/settle windows.
export function scheduleMany(callback, delays) {
  for (const delay of delays) {
    schedule(callback, delay);
  }
}

// Waits between automated clicks so chat card DOM can re-render.
export function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
