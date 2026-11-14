import { beforeEach, describe, expect, it } from "vitest";
import {
  notifyRefundRequestApproved,
  notifyRefundRequestDeclined,
} from "./notifications.server";
import {
  approveRefundRequest,
  declineRefundRequest,
  raiseRefundRequest,
} from "./refunds.server";
import { recordingNotificationGateway } from "~/test/recording-notification-gateway";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";

// Refund Request decisions: the buyer hears when a Platform Admin approves or
// declines their Refund Request. Kept in its own file so the other
// Notifications' scenarios don't collide with it.

type TestDb = ReturnType<typeof createTestDb>;
type User = typeof schema.users.$inferSelect;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function daysBefore(days: number) {
  const when = new Date(NOW);
  when.setDate(when.getDate() - days);
  return when.toISOString();
}

// A fresh database per test, so ids are predictable: Test User is 1, Test
// Instructor is 2, Pat Admin is 3, Test Course is 1, and the first Purchase and
// the first Refund Request are 1.
let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let platformAdmin: User;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  platformAdmin = db
    .insert(schema.users)
    .values({ name: "Pat Admin", email: "pat@example.com", role: UserRole.Admin })
    .returning()
    .get();
});

function buyForSelf(buyer: User, amountPaid = 7900) {
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId: buyer.id,
      courseId: base.course.id,
      amountPaid,
      createdAt: daysBefore(3),
    })
    .returning()
    .get();
  db.insert(schema.enrollments)
    .values({ userId: buyer.id, courseId: base.course.id })
    .run();
  return purchase;
}

function buySeats(buyer: User, seats: number) {
  const team = db.insert(schema.teams).values({}).returning().get();
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId: buyer.id,
      courseId: base.course.id,
      amountPaid: 7900 * seats,
      createdAt: daysBefore(3),
    })
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
  return purchase;
}

function raise(purchaseId: number, buyer: User) {
  const raised = raiseRefundRequest(
    db,
    purchaseId,
    buyer.id,
    "It wasn't what I expected.",
    NOW
  );
  if (!raised.ok) throw new Error(raised.error);
  return raised.refundRequestId;
}

function approve(refundRequestId: number, note: string | null) {
  const decided = approveRefundRequest(
    db,
    refundRequestId,
    platformAdmin.id,
    note,
    NOW
  );
  if (!decided.ok) throw new Error(decided.error);
}

function decline(refundRequestId: number, note: string) {
  const decided = declineRefundRequest(
    db,
    refundRequestId,
    platformAdmin.id,
    note,
    NOW
  );
  if (!decided.ok) throw new Error(decided.error);
}

const testUser = { id: "1", name: "Test User", email: "test@example.com" };
const patAdmin = { id: "3", name: "Pat Admin", email: "pat@example.com" };

describe("notifyRefundRequestApproved", () => {
  it("tells the buyer their Refund Request on an Individual Purchase was approved", async () => {
    const purchase = buyForSelf(base.user);
    const refundRequestId = raise(purchase.id, base.user);
    approve(refundRequestId, "Sorry  it didn't\nwork out.");
    const gateway = recordingNotificationGateway();

    await notifyRefundRequestApproved(gateway, db, refundRequestId);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        input: {
          workflow: "refund-request-approved",
          recipients: [testUser],
          actor: patAdmin,
          data: {
            refund_request_id: 1,
            purchase_id: 1,
            course_id: 1,
            course_title: "Test Course",
            purchase_kind: "individual_purchase",
            amount_cents: 7900,
            decision_note: "Sorry it didn't work out.",
            url: "/settings",
          },
          idempotencyKey: "refund-request-approved:1",
        },
      },
    ]);
  });

  it("says the Purchase is a Team Licence and gives the full amount refunded", async () => {
    const purchase = buySeats(base.user, 5);
    const refundRequestId = raise(purchase.id, base.user);
    approve(refundRequestId, null);
    const gateway = recordingNotificationGateway();

    await notifyRefundRequestApproved(gateway, db, refundRequestId);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        input: {
          workflow: "refund-request-approved",
          recipients: [testUser],
          actor: patAdmin,
          data: {
            refund_request_id: 1,
            purchase_id: 1,
            course_id: 1,
            course_title: "Test Course",
            purchase_kind: "team_licence",
            amount_cents: 39500,
            decision_note: null,
            url: "/settings",
          },
          idempotencyKey: "refund-request-approved:1",
        },
      },
    ]);
  });

  it("tells nobody when a Platform Admin approves their own Refund Request", async () => {
    const purchase = buyForSelf(platformAdmin);
    const refundRequestId = raise(purchase.id, platformAdmin);
    approve(refundRequestId, null);
    const gateway = recordingNotificationGateway();

    await notifyRefundRequestApproved(gateway, db, refundRequestId);

    expect(gateway.calls).toEqual([]);
  });
});

describe("notifyRefundRequestDeclined", () => {
  it("tells the buyer their Refund Request on a Team Licence was declined", async () => {
    const purchase = buySeats(base.user, 3);
    const refundRequestId = raise(purchase.id, base.user);
    decline(refundRequestId, "A Seat was used for training last week.");
    const gateway = recordingNotificationGateway();

    await notifyRefundRequestDeclined(gateway, db, refundRequestId);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        input: {
          workflow: "refund-request-declined",
          recipients: [testUser],
          actor: patAdmin,
          data: {
            refund_request_id: 1,
            purchase_id: 1,
            course_id: 1,
            course_title: "Test Course",
            purchase_kind: "team_licence",
            decision_note: "A Seat was used for training last week.",
            url: "/settings",
          },
          idempotencyKey: "refund-request-declined:1",
        },
      },
    ]);
  });

  it("cuts a long decision note to 140 characters", async () => {
    const purchase = buyForSelf(base.user);
    const refundRequestId = raise(purchase.id, base.user);
    decline(
      refundRequestId,
      "You watched most of the course before asking.   ".repeat(4)
    );
    const gateway = recordingNotificationGateway();

    await notifyRefundRequestDeclined(gateway, db, refundRequestId);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        input: {
          workflow: "refund-request-declined",
          recipients: [testUser],
          actor: patAdmin,
          data: {
            refund_request_id: 1,
            purchase_id: 1,
            course_id: 1,
            course_title: "Test Course",
            purchase_kind: "individual_purchase",
            decision_note:
              "You watched most of the course before asking. You watched most of the course before asking. You watched most of the course before asking. Y…",
            url: "/settings",
          },
          idempotencyKey: "refund-request-declined:1",
        },
      },
    ]);
  });

  it("tells nobody when a Platform Admin declines their own Refund Request", async () => {
    const purchase = buyForSelf(platformAdmin);
    const refundRequestId = raise(purchase.id, platformAdmin);
    decline(refundRequestId, "Changed my mind.");
    const gateway = recordingNotificationGateway();

    await notifyRefundRequestDeclined(gateway, db, refundRequestId);

    expect(gateway.calls).toEqual([]);
  });
});
