import { beforeEach, describe, expect, it } from "vitest";
import {
  loadNotificationPreferences,
  saveNotificationPreference,
} from "./notification-preferences.server";
import * as schema from "~/db/schema";
import { captureConsoleErrors } from "~/test/capture-console-errors";
import { createTestDb, seedBaseData } from "~/test/setup";
import { recordingNotificationGateway } from "~/test/recording-notification-gateway";

let db: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

describe("loadNotificationPreferences", () => {
  it("identifies the user, then shows an Instructor's switches with Enrollments off by default", async () => {
    const gateway = recordingNotificationGateway();

    const result = await loadNotificationPreferences(
      gateway,
      db,
      base.instructor
    );

    expect(gateway.calls).toEqual([
      {
        method: "identifyUser",
        input: {
          id: "2",
          name: "Test Instructor",
          email: "instructor@example.com",
        },
      },
      { method: "getPreferences", input: "2" },
    ]);
    expect(result).toEqual({
      available: true,
      preferences: [
        {
          category: "refund-request-decisions",
          label: "Refund Request decisions",
          enabled: true,
        },
        {
          category: "discussion-replies",
          label: "Discussion Replies",
          enabled: true,
        },
        { category: "enrollments", label: "Enrollments", enabled: false },
        {
          category: "discussion-questions",
          label: "Discussion Questions",
          enabled: true,
        },
      ],
    });
  });

  it("shows Claimed Seats to a Student who owns a Team Licence", async () => {
    buyTeamLicence(base.user.id, 3);

    const result = await loadNotificationPreferences(
      recordingNotificationGateway(),
      db,
      base.user
    );

    expect(result).toEqual({
      available: true,
      preferences: [
        {
          category: "refund-request-decisions",
          label: "Refund Request decisions",
          enabled: true,
        },
        {
          category: "discussion-replies",
          label: "Discussion Replies",
          enabled: true,
        },
        { category: "claimed-seats", label: "Claimed Seats", enabled: true },
      ],
    });
  });

  it("shows no switches when Knock can't be reached", async () => {
    const gateway = recordingNotificationGateway({ reject: true });
    let result: unknown;

    const errors = await captureConsoleErrors(async () => {
      result = await loadNotificationPreferences(gateway, db, base.user);
    });

    expect(result).toEqual({ available: false });
    expect(errors).toHaveLength(1);
    expect(errors[0][0]).toBe(
      "Notification Preferences for user 1 could not be read"
    );
  });
});

describe("saveNotificationPreference", () => {
  it("writes the switch to Knock for the session's user", async () => {
    const gateway = recordingNotificationGateway();

    const result = await saveNotificationPreference(gateway, {
      userId: base.instructor.id,
      category: "enrollments",
      enabled: true,
    });

    expect(result).toEqual({ ok: true });
    expect(gateway.calls).toEqual([
      {
        method: "setPreference",
        input: { userId: "2", category: "enrollments", enabled: true },
      },
    ]);
  });

  it("says it didn't save when Knock can't be reached", async () => {
    const gateway = recordingNotificationGateway({ reject: true });
    let result: unknown;

    const errors = await captureConsoleErrors(async () => {
      result = await saveNotificationPreference(gateway, {
        userId: base.user.id,
        category: "discussion-replies",
        enabled: false,
      });
    });

    expect(result).toEqual({
      ok: false,
      error: "Your Notification Preference didn't save. Try again.",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0][0]).toBe(
      "Notification Preference discussion-replies for user 1 could not be saved"
    );
  });
});

function buyTeamLicence(userId: number, seats: number) {
  const team = db.insert(schema.teams).values({}).returning().get();
  const purchase = db
    .insert(schema.purchases)
    .values({ userId, courseId: base.course.id, amountPaid: 7900 * seats })
    .returning()
    .get();
  for (let i = 0; i < seats; i++) {
    db.insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `SEAT-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .run();
  }
}
