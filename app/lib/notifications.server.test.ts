import { describe, expect, it } from "vitest";
import { fireAndForget } from "./notifications.server";
import { recordingNotificationGateway } from "~/test/recording-notification-gateway";

// Swaps console.error for a hand-written recorder while `run` executes.
async function captureConsoleErrors(run: () => Promise<void>) {
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

describe("fireAndForget", () => {
  it("resolves and logs the workflow key and domain id when Knock rejects", async () => {
    const gateway = recordingNotificationGateway({ reject: true });

    const errors = await captureConsoleErrors(async () => {
      await expect(
        fireAndForget({ workflow: "discussion-reply", domainId: 42 }, () =>
          gateway.trigger({
            workflow: "discussion-reply",
            recipients: [
              { id: "5", name: "Emma Wilson", email: "emma@example.com" },
            ],
            actor: { id: "6", name: "James Park", email: "james@example.com" },
            data: { comment_id: 42 },
            idempotencyKey: "discussion-reply:42",
          })
        )
      ).resolves.toBeUndefined();
    });

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        input: {
          workflow: "discussion-reply",
          recipients: [
            { id: "5", name: "Emma Wilson", email: "emma@example.com" },
          ],
          actor: { id: "6", name: "James Park", email: "james@example.com" },
          data: { comment_id: 42 },
          idempotencyKey: "discussion-reply:42",
        },
      },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0][0]).toBe("Notification discussion-reply:42 was not sent");
  });
});
