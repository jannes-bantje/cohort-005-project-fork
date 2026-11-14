/**
 * Swaps console.error for a hand-written recorder while `run` executes, and
 * returns the arguments of every call.
 */
export async function captureConsoleErrors(
  run: () => Promise<void>
): Promise<unknown[][]> {
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    await run();
  } finally {
    console.error = original;
  }
  return errors;
}
