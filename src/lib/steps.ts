/**
 * Runs the steps in order. A step that fails (a full disk, a file Android has taken away) is
 * skipped, so one problem never stops the steps after it: a failed feed check mustn't also
 * mean no downloads and no backup.
 */
export async function runSteps(steps: (() => Promise<unknown>)[]) {
  for (const step of steps) {
    try {
      await step();
    } catch {
      // Whatever runs these again (the next catch-up) tries this step again.
    }
  }
}
