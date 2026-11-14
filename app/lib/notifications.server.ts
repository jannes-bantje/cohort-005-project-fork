import type { WorkflowKey } from "~/lib/notification-keys";

// ─── Notifications ───
// Telling people that something which concerns them has happened, through
// their Notification Feed in Knock. Every function here takes the
// NotificationGateway as a required parameter and never imports knock.server.ts,
// so tests hand in the recording fake. See docs/adr/0013.

/**
 * Runs one Notification's work without ever failing the caller. Route actions
 * call notify functions without awaiting them, after the domain write commits,
 * so the returned promise always resolves. A failure is logged with
 * `<workflow-key>:<domain id>` (the trigger's idempotency key) and is not
 * retried: lost Notifications stay lost.
 */
export async function fireAndForget(
  notification: { workflow: WorkflowKey; domainId: number },
  send: () => Promise<unknown>
): Promise<void> {
  try {
    await send();
  } catch (error) {
    console.error(
      `Notification ${notification.workflow}:${notification.domainId} was not sent`,
      error
    );
  }
}
