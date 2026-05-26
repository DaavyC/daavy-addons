// Schedules a callback without awaiting it.
export function schedule(callback, delay = 0) {
  window.setTimeout(() => {
    void callback();
  }, delay);
}

// Schedules a callback for each delay.
export function scheduleMany(callback, delays) {
  for (const delay of delays) {
    schedule(callback, delay);
  }
}

// Waits for a short automation delay.
export function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
