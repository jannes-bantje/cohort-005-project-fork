import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  archiveOpenRefundRequestNotifications,
  fireAndForget,
  notifyDiscussionQuestion,
  notifyDiscussionReply,
  notifyNewEnrollment,
  notifyOpenRefundRequest,
  notifySeatClaimed,
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

type TestDb = ReturnType<typeof createTestDb>;
type User = typeof schema.users.$inferSelect;

// A fresh database per test, so ids are predictable: Test User is 1, Test
// Instructor is 2, Emma Wilson is 3, James Park is 4, Test Course is 1 and the
// "Generics" lesson is 1.
let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let emma: User;
let james: User;
let lessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  emma = addStudent("Emma Wilson", "emma@example.com");
  james = addStudent("James Park", "james@example.com");

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Generics", position: 1 })
    .returning()
    .get().id;
});

function addStudent(name: string, email: string) {
  return db
    .insert(schema.users)
    .values({ name, email, role: UserRole.Student })
    .returning()
    .get();
}

function postComment(
  author: User,
  body: string,
  parentId: number | null = null
) {
  return db
    .insert(schema.comments)
    .values({ userId: author.id, lessonId, parentId, body })
    .returning()
    .get();
}

describe("notifyDiscussionReply", () => {
  it("tells the Discussion Question's author about a Discussion Reply", async () => {
    const question = postComment(emma, "How do generics work with arrays?");
    const reply = postComment(
      base.instructor,
      "Use  Array<T>,\n\nor   T[] for short.",
      question.id
    );
    const gateway = recordingNotificationGateway();

    await notifyDiscussionReply(gateway, db, reply.id);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        input: {
          workflow: "discussion-reply",
          recipients: [
            { id: "3", name: "Emma Wilson", email: "emma@example.com" },
          ],
          actor: {
            id: "2",
            name: "Test Instructor",
            email: "instructor@example.com",
          },
          data: {
            comment_id: 2,
            discussion_question_id: 1,
            lesson_id: 1,
            course_id: 1,
            course_title: "Test Course",
            lesson_title: "Generics",
            excerpt: "Use Array<T>, or T[] for short.",
            url: "/courses/test-course/lessons/1",
          },
          idempotencyKey: "discussion-reply:2",
        },
      },
    ]);
  });

  it("tells nobody when the author replies to their own Discussion Question", async () => {
    const question = postComment(emma, "How do generics work with arrays?");
    const reply = postComment(emma, "Never mind, I found it.", question.id);
    const gateway = recordingNotificationGateway();

    await notifyDiscussionReply(gateway, db, reply.id);

    expect(gateway.calls).toEqual([]);
  });

  it("doesn't tell others who replied in the thread, only the question's author", async () => {
    const question = postComment(emma, "How do generics work with arrays?");
    postComment(james, "I'd like to know too.", question.id);
    const reply = postComment(base.instructor, "Use Array<T>.", question.id);
    const gateway = recordingNotificationGateway();

    await notifyDiscussionReply(gateway, db, reply.id);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        input: {
          workflow: "discussion-reply",
          recipients: [
            { id: "3", name: "Emma Wilson", email: "emma@example.com" },
          ],
          actor: {
            id: "2",
            name: "Test Instructor",
            email: "instructor@example.com",
          },
          data: {
            comment_id: 3,
            discussion_question_id: 1,
            lesson_id: 1,
            course_id: 1,
            course_title: "Test Course",
            lesson_title: "Generics",
            excerpt: "Use Array<T>.",
            url: "/courses/test-course/lessons/1",
          },
          idempotencyKey: "discussion-reply:3",
        },
      },
    ]);
  });

  it("cuts a long Discussion Reply to a 140-character excerpt", async () => {
    const question = postComment(emma, "How do generics work with arrays?");
    const reply = postComment(
      james,
      "Generics let one function work over many types. ".repeat(4),
      question.id
    );
    const gateway = recordingNotificationGateway();

    await notifyDiscussionReply(gateway, db, reply.id);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        input: {
          workflow: "discussion-reply",
          recipients: [
            { id: "3", name: "Emma Wilson", email: "emma@example.com" },
          ],
          actor: { id: "4", name: "James Park", email: "james@example.com" },
          data: {
            comment_id: 2,
            discussion_question_id: 1,
            lesson_id: 1,
            course_id: 1,
            course_title: "Test Course",
            lesson_title: "Generics",
            excerpt:
              "Generics let one function work over many types. Generics let one function work over many types. Generics let one function work over many ty…",
            url: "/courses/test-course/lessons/1",
          },
          idempotencyKey: "discussion-reply:2",
        },
      },
    ]);
  });
});

describe("notifyDiscussionQuestion", () => {
  it("tells the course's Instructor about a Student's Discussion Question", async () => {
    const question = postComment(emma, "How do  generics work\n\nwith arrays?");
    const gateway = recordingNotificationGateway();

    await notifyDiscussionQuestion(gateway, db, question.id);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        input: {
          workflow: "discussion-question",
          recipients: [
            {
              id: "2",
              name: "Test Instructor",
              email: "instructor@example.com",
            },
          ],
          actor: { id: "3", name: "Emma Wilson", email: "emma@example.com" },
          data: {
            comment_id: 1,
            lesson_id: 1,
            course_id: 1,
            course_title: "Test Course",
            lesson_title: "Generics",
            excerpt: "How do generics work with arrays?",
            url: "/courses/test-course/lessons/1",
          },
          idempotencyKey: "discussion-question:1",
        },
      },
    ]);
  });

  it("tells the Instructor about a Platform Admin's Discussion Question too", async () => {
    const admin = db
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: UserRole.Admin,
      })
      .returning()
      .get();
    const question = postComment(admin, "Is this lesson up to date?");
    const gateway = recordingNotificationGateway();

    await notifyDiscussionQuestion(gateway, db, question.id);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        input: {
          workflow: "discussion-question",
          recipients: [
            {
              id: "2",
              name: "Test Instructor",
              email: "instructor@example.com",
            },
          ],
          actor: { id: "5", name: "Pat Admin", email: "pat@example.com" },
          data: {
            comment_id: 1,
            lesson_id: 1,
            course_id: 1,
            course_title: "Test Course",
            lesson_title: "Generics",
            excerpt: "Is this lesson up to date?",
            url: "/courses/test-course/lessons/1",
          },
          idempotencyKey: "discussion-question:1",
        },
      },
    ]);
  });

  it("tells nobody about the Instructor's own top-level comment on their lesson", async () => {
    const comment = postComment(base.instructor, "Welcome to the lesson!");
    const gateway = recordingNotificationGateway();

    await notifyDiscussionQuestion(gateway, db, comment.id);

    expect(gateway.calls).toEqual([]);
  });
});

// ─── Open Refund Request ───

describe("notifyOpenRefundRequest", () => {
  // Pat Admin is 5 and Alex Rivera is 6.
  let pat: User;
  let alex: User;

  beforeEach(() => {
    pat = addPlatformAdmin("Pat Admin", "pat@example.com");
    alex = addPlatformAdmin("Alex Rivera", "alex@example.com");
  });

  function addPlatformAdmin(name: string, email: string) {
    return db
      .insert(schema.users)
      .values({ name, email, role: UserRole.Admin })
      .returning()
      .get();
  }

  function buy(buyer: User, amountPaid: number, seats = 0) {
    const purchase = db
      .insert(schema.purchases)
      .values({ userId: buyer.id, courseId: base.course.id, amountPaid })
      .returning()
      .get();
    if (seats > 0) {
      const team = db.insert(schema.teams).values({}).returning().get();
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
    return purchase;
  }

  function raise(buyer: User, purchaseId: number, reason: string) {
    const result = raiseRefundRequest(
      db,
      purchaseId,
      buyer.id,
      reason,
      new Date()
    );
    if (!result.ok) throw new Error(result.error);
    return result.refundRequestId;
  }

  it("tells every Platform Admin that a buyer raised a Refund Request", async () => {
    const purchase = buy(emma, 7900);
    const refundRequestId = raise(
      emma,
      purchase.id,
      "The course  isn't what\n\nI expected."
    );
    const gateway = recordingNotificationGateway();

    await notifyOpenRefundRequest(gateway, db, refundRequestId);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        input: {
          workflow: "open-refund-request",
          recipients: [
            { id: "5", name: "Pat Admin", email: "pat@example.com" },
            { id: "6", name: "Alex Rivera", email: "alex@example.com" },
          ],
          actor: { id: "3", name: "Emma Wilson", email: "emma@example.com" },
          data: {
            refund_request_id: 1,
            purchase_id: 1,
            course_id: 1,
            course_title: "Test Course",
            purchase_kind: "individual_purchase",
            amount_cents: 7900,
            reason: "The course isn't what I expected.",
            url: "/admin/refunds",
          },
          idempotencyKey: "open-refund-request:1",
        },
      },
    ]);
  });

  it("says a Refund Request on a Team Licence is for a Team Licence, and cuts a long reason", async () => {
    const purchase = buy(james, 39500, 5);
    const refundRequestId = raise(
      james,
      purchase.id,
      "We bought Seats for the whole team, but the project was cancelled before anyone started, so none of the Seats will ever be claimed by anyone."
    );
    const gateway = recordingNotificationGateway();

    await notifyOpenRefundRequest(gateway, db, refundRequestId);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        input: {
          workflow: "open-refund-request",
          recipients: [
            { id: "5", name: "Pat Admin", email: "pat@example.com" },
            { id: "6", name: "Alex Rivera", email: "alex@example.com" },
          ],
          actor: { id: "4", name: "James Park", email: "james@example.com" },
          data: {
            refund_request_id: 1,
            purchase_id: 1,
            course_id: 1,
            course_title: "Test Course",
            purchase_kind: "team_licence",
            amount_cents: 39500,
            reason:
              "We bought Seats for the whole team, but the project was cancelled before anyone started, so none of the Seats will ever be claimed by anyon…",
            url: "/admin/refunds",
          },
          idempotencyKey: "open-refund-request:1",
        },
      },
    ]);
  });

  it("doesn't tell a Platform Admin about a Refund Request they raised themselves", async () => {
    const purchase = buy(pat, 7900);
    const refundRequestId = raise(pat, purchase.id, "Bought it by mistake.");
    const gateway = recordingNotificationGateway();

    await notifyOpenRefundRequest(gateway, db, refundRequestId);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        input: {
          workflow: "open-refund-request",
          recipients: [
            { id: "6", name: "Alex Rivera", email: "alex@example.com" },
          ],
          actor: { id: "5", name: "Pat Admin", email: "pat@example.com" },
          data: {
            refund_request_id: 1,
            purchase_id: 1,
            course_id: 1,
            course_title: "Test Course",
            purchase_kind: "individual_purchase",
            amount_cents: 7900,
            reason: "Bought it by mistake.",
            url: "/admin/refunds",
          },
          idempotencyKey: "open-refund-request:1",
        },
      },
    ]);
  });

  it("tells nobody when the only Platform Admin raised the Refund Request", async () => {
    db.update(schema.users)
      .set({ role: UserRole.Student })
      .where(eq(schema.users.id, alex.id))
      .run();
    const purchase = buy(pat, 7900);
    const refundRequestId = raise(pat, purchase.id, "Bought it by mistake.");
    const gateway = recordingNotificationGateway();

    await notifyOpenRefundRequest(gateway, db, refundRequestId);

    expect(gateway.calls).toEqual([]);
  });
});

describe("archiveOpenRefundRequestNotifications", () => {
  it.each([
    ["approved", approveRefundRequest],
    ["declined", declineRefundRequest],
  ] as const)(
    "archives every Platform Admin's copy once a Refund Request is %s",
    async (_decision, decide) => {
      const platformAdmin = db
        .insert(schema.users)
        .values({
          name: "Pat Admin",
          email: "pat@example.com",
          role: UserRole.Admin,
        })
        .returning()
        .get();
      const purchase = db
        .insert(schema.purchases)
        .values({ userId: emma.id, courseId: base.course.id, amountPaid: 7900 })
        .returning()
        .get();
      const raised = raiseRefundRequest(
        db,
        purchase.id,
        emma.id,
        "Bought it by mistake.",
        new Date()
      );
      if (!raised.ok) throw new Error(raised.error);
      const decided = decide(
        db,
        raised.refundRequestId,
        platformAdmin.id,
        "Thanks for letting us know.",
        new Date()
      );
      if (!decided.ok) throw new Error(decided.error);
      const gateway = recordingNotificationGateway();

      await archiveOpenRefundRequestNotifications(
        gateway,
        raised.refundRequestId
      );

      expect(gateway.calls).toEqual([
        {
          method: "archiveFeedMessages",
          input: {
            workflow: "open-refund-request",
            triggerData: { refund_request_id: 1 },
          },
        },
      ]);
    }
  );
});

// ─── Claimed Seat and New Enrollment ───

// A Team Licence on Test Course with `seats` Unclaimed Seats.
function buyTeamLicence(buyer: User, seats: number) {
  const team = db.insert(schema.teams).values({}).returning().get();
  const purchase = db
    .insert(schema.purchases)
    .values({ userId: buyer.id, courseId: base.course.id, amountPaid: 7900 })
    .returning()
    .get();
  const seatRows = Array.from({ length: seats }, (_, i) =>
    db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `SEAT-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .returning()
      .get()
  );
  return { purchase, seats: seatRows };
}

// Claims a Seat the way the redeem-code action does, returning the Enrollment.
function claimSeat(seat: { id: number }, student: User) {
  db.update(schema.coupons)
    .set({ redeemedByUserId: student.id, redeemedAt: "2026-11-14T10:00:00Z" })
    .where(eq(schema.coupons.id, seat.id))
    .run();
  return enroll(student);
}

function enroll(student: User) {
  return db
    .insert(schema.enrollments)
    .values({ userId: student.id, courseId: base.course.id })
    .returning()
    .get();
}

describe("notifySeatClaimed", () => {
  it("tells the Team Admin who claimed a Seat and how many Seats are still unclaimed", async () => {
    const ava = addStudent("Ava Nakamura", "ava@example.com");
    const licence = buyTeamLicence(ava, 10);
    claimSeat(licence.seats[0], james);
    claimSeat(licence.seats[2], emma);
    const gateway = recordingNotificationGateway();

    await notifySeatClaimed(gateway, db, licence.seats[2].id);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        input: {
          workflow: "seat-claimed",
          recipients: [
            { id: "5", name: "Ava Nakamura", email: "ava@example.com" },
          ],
          actor: { id: "3", name: "Emma Wilson", email: "emma@example.com" },
          data: {
            seat_id: 3,
            purchase_id: 1,
            course_id: 1,
            course_title: "Test Course",
            unclaimed_seats: 8,
            seats_total: 10,
            url: "/team",
          },
          idempotencyKey: "seat-claimed:3",
        },
      },
    ]);
  });

  it("counts Seats only on the Team Licence the Seat came from", async () => {
    const ava = addStudent("Ava Nakamura", "ava@example.com");
    const first = buyTeamLicence(ava, 3);
    const second = buyTeamLicence(ava, 5);
    claimSeat(first.seats[0], james);
    claimSeat(second.seats[0], emma);
    const gateway = recordingNotificationGateway();

    await notifySeatClaimed(gateway, db, second.seats[0].id);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        input: {
          workflow: "seat-claimed",
          recipients: [
            { id: "5", name: "Ava Nakamura", email: "ava@example.com" },
          ],
          actor: { id: "3", name: "Emma Wilson", email: "emma@example.com" },
          data: {
            seat_id: 4,
            purchase_id: 2,
            course_id: 1,
            course_title: "Test Course",
            unclaimed_seats: 4,
            seats_total: 5,
            url: "/team",
          },
          idempotencyKey: "seat-claimed:4",
        },
      },
    ]);
  });

  it("tells nobody when the Team Admin claims a Seat on their own Team Licence", async () => {
    const ava = addStudent("Ava Nakamura", "ava@example.com");
    const licence = buyTeamLicence(ava, 2);
    claimSeat(licence.seats[0], ava);
    const gateway = recordingNotificationGateway();

    await notifySeatClaimed(gateway, db, licence.seats[0].id);

    expect(gateway.calls).toEqual([]);
  });
});

// An Individual Purchase of Test Course, which gives the buyer an Enrollment.
function buyForSelf(student: User) {
  const purchase = db
    .insert(schema.purchases)
    .values({ userId: student.id, courseId: base.course.id, amountPaid: 7900 })
    .returning()
    .get();
  return { purchase, enrollment: enroll(student) };
}

const newEnrollmentForEmma = (enrollmentId: number) => ({
  method: "trigger",
  input: {
    workflow: "new-enrollment",
    recipients: [
      { id: "2", name: "Test Instructor", email: "instructor@example.com" },
    ],
    actor: { id: "3", name: "Emma Wilson", email: "emma@example.com" },
    data: {
      enrollment_id: enrollmentId,
      course_id: 1,
      course_title: "Test Course",
      url: "/instructor/1/students",
    },
    idempotencyKey: `new-enrollment:${enrollmentId}`,
  },
});

describe("notifyNewEnrollment", () => {
  it("tells the course's Instructor about an Individual Purchase", async () => {
    const { enrollment } = buyForSelf(emma);
    const gateway = recordingNotificationGateway();

    await notifyNewEnrollment(gateway, db, enrollment.id);

    expect(gateway.calls).toEqual([newEnrollmentForEmma(1)]);
  });

  it("tells the Instructor when a Lapsed Student enrolls again", async () => {
    const platformAdmin = db
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: UserRole.Admin,
      })
      .returning()
      .get();
    const { purchase } = buyForSelf(emma);
    const now = new Date();
    const raised = raiseRefundRequest(
      db,
      purchase.id,
      emma.id,
      "I bought the wrong course by mistake.",
      now
    );
    if (!raised.ok) throw new Error(raised.error);
    approveRefundRequest(
      db,
      raised.refundRequestId,
      platformAdmin.id,
      null,
      now
    );
    const { enrollment } = buyForSelf(emma);
    const gateway = recordingNotificationGateway();

    await notifyNewEnrollment(gateway, db, enrollment.id);

    expect(gateway.calls).toEqual([newEnrollmentForEmma(2)]);
  });

  it("tells the Team Admin and the Instructor when a Student claims a Seat", async () => {
    const ava = addStudent("Ava Nakamura", "ava@example.com");
    const licence = buyTeamLicence(ava, 10);
    claimSeat(licence.seats[0], james);
    claimSeat(licence.seats[1], base.user);
    const enrollment = claimSeat(licence.seats[2], emma);
    const gateway = recordingNotificationGateway();

    // What the redeem-code action fires for a Seat claim.
    await Promise.all([
      notifySeatClaimed(gateway, db, licence.seats[2].id),
      notifyNewEnrollment(gateway, db, enrollment.id),
    ]);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        input: {
          workflow: "seat-claimed",
          recipients: [
            { id: "5", name: "Ava Nakamura", email: "ava@example.com" },
          ],
          actor: { id: "3", name: "Emma Wilson", email: "emma@example.com" },
          data: {
            seat_id: 3,
            purchase_id: 1,
            course_id: 1,
            course_title: "Test Course",
            unclaimed_seats: 7,
            seats_total: 10,
            url: "/team",
          },
          idempotencyKey: "seat-claimed:3",
        },
      },
      newEnrollmentForEmma(3),
    ]);
  });

  it("still tells the Instructor when a Team Admin claims a Seat on their own Team Licence", async () => {
    const licence = buyTeamLicence(emma, 2);
    const enrollment = claimSeat(licence.seats[0], emma);
    const gateway = recordingNotificationGateway();

    await Promise.all([
      notifySeatClaimed(gateway, db, licence.seats[0].id),
      notifyNewEnrollment(gateway, db, enrollment.id),
    ]);

    expect(gateway.calls).toEqual([newEnrollmentForEmma(1)]);
  });

  it("tells nobody when the Instructor enrolls in their own course", async () => {
    const enrollment = enroll(base.instructor);
    const gateway = recordingNotificationGateway();

    await notifyNewEnrollment(gateway, db, enrollment.id);

    expect(gateway.calls).toEqual([]);
  });
});

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
