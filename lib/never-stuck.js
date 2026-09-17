/**
 * The never-stuck rules (ADR 0004) as a module, for extension pages that can
 * import one: at 5 s the caller is told to offer Cancel, at 20 s the run
 * hard-stops, and a reply that lands after either is dropped. The content
 * script carries its own copy of the same rules because it cannot import
 * modules; the options page's Test button uses this one.
 */

export const CANCEL_AFTER_MS = 5000;
export const HARD_STOP_MS = 20000;

/**
 * Run `task` under the never-stuck rules. The task gets an AbortSignal that
 * fires on Cancel or the hard stop, so it can skip UI updates for a run that
 * is already over; the run itself cannot be cancelled on the wire (a runtime
 * message has no abort), so a late reply is simply ignored.
 *
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} task
 * @param {object} [hooks]
 * @param {(cancel: () => void) => void} [hooks.onStillWorking]  called once at
 *   5 s if the task is still running; `cancel` ends the run as 'cancelled'
 * @returns {Promise<{ status: 'done', value: T } | { status: 'failed', error: unknown }
 *   | { status: 'cancelled' } | { status: 'timed-out' }>}  never rejects
 */
export function runNeverStuck(task, { onStillWorking } = {}) {
  return new Promise((resolve) => {
    const control = new AbortController();
    let live = true;
    const cancelTimer = setTimeout(() => {
      if (live && onStillWorking) onStillWorking(() => settle({ status: 'cancelled' }));
    }, CANCEL_AFTER_MS);
    const stopTimer = setTimeout(() => settle({ status: 'timed-out' }), HARD_STOP_MS);

    function settle(outcome) {
      if (!live) return; // a late reply, a second Cancel, or the stop after a Cancel
      live = false;
      clearTimeout(cancelTimer);
      clearTimeout(stopTimer);
      if (outcome.status === 'cancelled' || outcome.status === 'timed-out') control.abort();
      resolve(outcome);
    }

    Promise.resolve()
      .then(() => task(control.signal))
      .then(
        (value) => settle({ status: 'done', value }),
        (error) => settle({ status: 'failed', error })
      );
  });
}
