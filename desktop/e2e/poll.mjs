import { HarnessError, errorMessage } from "./errors.mjs";

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll `attempt` until it returns a truthy value.
 *
 * `attempt` may throw (for example a WebDriver "no such element" response
 * while the webview is still booting); throwing counts as "not yet", and the
 * last error is reported if the budget runs out. Time is fully injectable so
 * the retry contract can be tested without waiting in real time.
 *
 * @param {(attempt: number) => Promise<unknown>} attempt
 * @param {{timeoutMs: number, intervalMs: number, label: string,
 *          sleep?: (ms: number) => Promise<unknown>, now?: () => number}} options
 * @returns {Promise<any>}
 */
export async function pollUntil(attempt, options) {
  const {
    timeoutMs,
    intervalMs,
    label,
    sleep = defaultSleep,
    now = () => Date.now(),
  } = options;
  const deadline = now() + timeoutMs;
  let attempts = 0;
  let lastError = null;

  for (;;) {
    attempts += 1;
    let value;
    let failed = false;
    try {
      value = await attempt(attempts);
    } catch (error) {
      failed = true;
      lastError = error;
    }
    if (!failed && value) return value;

    if (now() >= deadline) {
      const detail = lastError ? `; last error: ${errorMessage(lastError)}` : "";
      throw new HarnessError(
        `${label} did not appear within ${timeoutMs}ms (${attempts} attempt(s))${detail}`,
      );
    }
    await sleep(intervalMs);
  }
}
