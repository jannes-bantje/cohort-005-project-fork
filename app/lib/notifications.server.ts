import { alias } from "drizzle-orm/sqlite-core";
import { and, eq } from "drizzle-orm";
import {
  comments,
  coupons,
  courses,
  enrollments,
  lessons,
  modules,
  purchases,
  RefundStatus,
  refunds,
  UserRole,
  users,
} from "~/db/schema";
import {
  knockUser,
  type NotificationGateway,
  type Person,
} from "~/lib/notification-gateway";
import type { WorkflowKey } from "~/lib/notification-keys";
import {
  snippet,
  type ContractWorkflow,
  type TriggerDataFor,
} from "~/lib/notification-trigger-data";
import { getSeats, kindOf, type Db } from "~/lib/refunds.server";

// ─── Notifications ───
// Telling people that something which concerns them has happened, through
// their Notification Feed in Knock. Every function here takes the
// NotificationGateway as a required parameter and never imports knock.server.ts,
// so tests hand in the recording fake. See docs/adr/0013.
//
// Each notify function looks up its recipients and display data when it runs,
// drops the actor from the recipients, skips the trigger when nobody is left,
// and otherwise triggers through `sendNotification`. Route actions call them
// without awaiting, after the domain write.

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

/**
 * Triggers one workflow for everyone in `recipients` except the actor, with
 * the idempotency key `<workflow>:<domainId>`. Nobody hears about their own
 * action, so when only the actor is left nothing is triggered.
 */
async function sendNotification<W extends ContractWorkflow>(
  gateway: NotificationGateway,
  notification: {
    workflow: W;
    domainId: number;
    recipients: Person[];
    actor: Person;
    data: TriggerDataFor<W>;
  }
): Promise<void> {
  const { workflow, domainId, actor, data } = notification;
  const recipients = notification.recipients.filter((r) => r.id !== actor.id);
  if (recipients.length === 0) return;

  await gateway.trigger({
    workflow,
    recipients: recipients.map(knockUser),
    actor: knockUser(actor),
    data,
    idempotencyKey: `${workflow}:${domainId}`,
  });
}

// ─── Discussions ───

const instructors = alias(users, "instructors");

/** The lesson a Discussion is on, with its course and the course's Instructor. */
function findDiscussionLesson(db: Db, lessonId: number) {
  return db
    .select({ lesson: lessons, course: courses, instructor: instructors })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .innerJoin(instructors, eq(courses.instructorId, instructors.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

/** Where a Discussion Notification points: the lesson and its course. */
function discussionLessonData({
  lesson,
  course,
}: NonNullable<ReturnType<typeof findDiscussionLesson>>) {
  return {
    lesson_id: lesson.id,
    course_id: course.id,
    course_title: course.title,
    lesson_title: lesson.title,
    url: `/courses/${course.slug}/lessons/${lesson.id}`,
  };
}

// ─── Discussion Reply ───

const discussionQuestions = alias(comments, "discussion_questions");
const questionAuthors = alias(users, "question_authors");

/**
 * Tells a Discussion Question's author that someone else posted a Discussion
 * Reply to it. Only the question's author hears about it, not others who
 * replied in the thread.
 */
export function notifyDiscussionReply(
  gateway: NotificationGateway,
  db: Db,
  discussionReplyId: number
): Promise<void> {
  return fireAndForget(
    { workflow: "discussion-reply", domainId: discussionReplyId },
    async () => {
      const reply = db
        .select({
          comment: comments,
          question: discussionQuestions,
          replier: users,
          questionAuthor: questionAuthors,
        })
        .from(comments)
        .innerJoin(
          discussionQuestions,
          eq(comments.parentId, discussionQuestions.id)
        )
        .innerJoin(users, eq(comments.userId, users.id))
        .innerJoin(
          questionAuthors,
          eq(discussionQuestions.userId, questionAuthors.id)
        )
        .where(eq(comments.id, discussionReplyId))
        .get();
      if (!reply) return;
      const discussionLesson = findDiscussionLesson(db, reply.comment.lessonId);
      if (!discussionLesson) return;

      await sendNotification(gateway, {
        workflow: "discussion-reply",
        domainId: reply.comment.id,
        recipients: [reply.questionAuthor],
        actor: reply.replier,
        data: {
          comment_id: reply.comment.id,
          discussion_question_id: reply.question.id,
          excerpt: snippet(reply.comment.body),
          ...discussionLessonData(discussionLesson),
        },
      });
    }
  );
}

// ─── Discussion Question ───

/**
 * Tells the course's Instructor that someone else asked a Discussion Question
 * on one of their lessons. The Instructor's own top-level comment isn't a
 * Discussion Question: they are the actor, so nobody is left to tell.
 */
export function notifyDiscussionQuestion(
  gateway: NotificationGateway,
  db: Db,
  commentId: number
): Promise<void> {
  return fireAndForget(
    { workflow: "discussion-question", domainId: commentId },
    async () => {
      const question = db
        .select({ comment: comments, asker: users })
        .from(comments)
        .innerJoin(users, eq(comments.userId, users.id))
        .where(eq(comments.id, commentId))
        .get();
      if (!question) return;
      const discussionLesson = findDiscussionLesson(
        db,
        question.comment.lessonId
      );
      if (!discussionLesson) return;

      await sendNotification(gateway, {
        workflow: "discussion-question",
        domainId: question.comment.id,
        recipients: [discussionLesson.instructor],
        actor: question.asker,
        data: {
          comment_id: question.comment.id,
          excerpt: snippet(question.comment.body),
          ...discussionLessonData(discussionLesson),
        },
      });
    }
  );
}

// ─── Open Refund Request ───

/**
 * Tells every Platform Admin that a buyer raised a Refund Request, so whoever
 * is around can decide it. A Platform Admin who raised their own request isn't
 * told about it.
 */
export function notifyOpenRefundRequest(
  gateway: NotificationGateway,
  db: Db,
  refundRequestId: number
): Promise<void> {
  return fireAndForget(
    { workflow: "open-refund-request", domainId: refundRequestId },
    async () => {
      const raised = db
        .select({
          refundRequest: refunds,
          purchase: purchases,
          buyer: users,
          course: courses,
        })
        .from(refunds)
        .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
        .innerJoin(users, eq(purchases.userId, users.id))
        .innerJoin(courses, eq(purchases.courseId, courses.id))
        .where(eq(refunds.id, refundRequestId))
        .get();
      if (!raised) return;

      const { refundRequest, purchase, buyer, course } = raised;
      const platformAdmins = db
        .select()
        .from(users)
        .where(eq(users.role, UserRole.Admin))
        .orderBy(users.id)
        .all();

      await sendNotification(gateway, {
        workflow: "open-refund-request",
        domainId: refundRequest.id,
        recipients: platformAdmins,
        actor: buyer,
        data: {
          refund_request_id: refundRequest.id,
          purchase_id: purchase.id,
          course_id: course.id,
          course_title: course.title,
          purchase_kind: kindOf(getSeats(db, purchase.id)),
          amount_cents: purchase.amountPaid,
          reason: snippet(refundRequest.reason),
          url: "/admin/refunds",
        },
      });
    }
  );
}

/**
 * Archives every Platform Admin's Open Refund Request Notification for a
 * Refund Request once one of them has decided it, the decider's copy
 * included. The bell drops them on its next open. Copies Knock delivers after
 * this stay in the feed.
 */
export function archiveOpenRefundRequestNotifications(
  gateway: NotificationGateway,
  refundRequestId: number
): Promise<void> {
  return fireAndForget(
    { workflow: "open-refund-request", domainId: refundRequestId },
    () =>
      gateway.archiveFeedMessages({
        workflow: "open-refund-request",
        triggerData: { refund_request_id: refundRequestId },
      })
  );
}

// ─── Refund Request decisions ───

const deciders = alias(users, "deciders");

type Decision = RefundStatus.Approved | RefundStatus.Declined;

/**
 * A decided Refund Request with what its Notification shows, or null when it
 * doesn't exist or wasn't decided that way.
 */
function findDecidedRefundRequest(
  db: Db,
  refundRequestId: number,
  decision: Decision
) {
  const decided = db
    .select({
      refundRequest: refunds,
      purchase: purchases,
      buyer: users,
      platformAdmin: deciders,
      course: courses,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(deciders, eq(refunds.resolvedByUserId, deciders.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(and(eq(refunds.id, refundRequestId), eq(refunds.status, decision)))
    .get();
  if (!decided) return null;

  const { refundRequest, purchase, course } = decided;
  return {
    ...decided,
    data: {
      refund_request_id: refundRequest.id,
      purchase_id: purchase.id,
      course_id: course.id,
      course_title: course.title,
      purchase_kind: kindOf(getSeats(db, purchase.id)),
      decision_note:
        refundRequest.decisionNote === null
          ? null
          : snippet(refundRequest.decisionNote),
      url: "/settings",
    },
  };
}

/**
 * Tells the buyer that a Platform Admin approved their Refund Request. The
 * deciding Platform Admin is the actor, so deciding your own Refund Request
 * tells nobody.
 */
export function notifyRefundRequestApproved(
  gateway: NotificationGateway,
  db: Db,
  refundRequestId: number
): Promise<void> {
  return notifyRefundRequestDecision(gateway, db, refundRequestId, {
    workflow: "refund-request-approved",
    decision: RefundStatus.Approved,
    data: ({ refundRequest, data }) =>
      refundRequest.amountRefunded === null
        ? null
        : { ...data, amount_cents: refundRequest.amountRefunded },
  });
}

/**
 * Tells the buyer that a Platform Admin declined their Refund Request. The
 * deciding Platform Admin is the actor, so deciding your own Refund Request
 * tells nobody.
 */
export function notifyRefundRequestDeclined(
  gateway: NotificationGateway,
  db: Db,
  refundRequestId: number
): Promise<void> {
  return notifyRefundRequestDecision(gateway, db, refundRequestId, {
    workflow: "refund-request-declined",
    decision: RefundStatus.Declined,
    data: ({ data }) => data,
  });
}

type DecidedRefundRequest = NonNullable<
  ReturnType<typeof findDecidedRefundRequest>
>;

/**
 * Tells the buyer about a Platform Admin's decision on their Refund Request,
 * with the deciding Platform Admin as the actor. Nothing is sent when the
 * Refund Request wasn't decided that way, or `data` returns null.
 */
function notifyRefundRequestDecision<
  W extends "refund-request-approved" | "refund-request-declined",
>(
  gateway: NotificationGateway,
  db: Db,
  refundRequestId: number,
  notification: {
    workflow: W;
    decision: Decision;
    data: (decided: DecidedRefundRequest) => TriggerDataFor<W> | null;
  }
): Promise<void> {
  const { workflow, decision } = notification;
  return fireAndForget({ workflow, domainId: refundRequestId }, async () => {
    const decided = findDecidedRefundRequest(db, refundRequestId, decision);
    if (!decided) return;
    const data = notification.data(decided);
    if (!data) return;

    await sendNotification(gateway, {
      workflow,
      domainId: refundRequestId,
      recipients: [decided.buyer],
      actor: decided.platformAdmin,
      data,
    });
  });
}

// ─── Claimed Seat ───

const teamAdmins = alias(users, "team_admins");

/**
 * Tells the Team Admin who bought a Team Licence that a Student claimed one of
 * its Seats, with how many of that Team Licence's Seats are still Unclaimed
 * Seats. Counts cover only the Team Licence the Seat came from, even when the
 * Team Admin owns several for the same course.
 */
export function notifySeatClaimed(
  gateway: NotificationGateway,
  db: Db,
  seatId: number
): Promise<void> {
  return fireAndForget(
    { workflow: "seat-claimed", domainId: seatId },
    async () => {
      const claim = db
        .select({
          seat: coupons,
          student: users,
          teamAdmin: teamAdmins,
          course: courses,
        })
        .from(coupons)
        .innerJoin(users, eq(coupons.redeemedByUserId, users.id))
        .innerJoin(purchases, eq(coupons.purchaseId, purchases.id))
        .innerJoin(teamAdmins, eq(purchases.userId, teamAdmins.id))
        .innerJoin(courses, eq(coupons.courseId, courses.id))
        .where(eq(coupons.id, seatId))
        .get();
      if (!claim) return;

      const licenceSeats = getSeats(db, claim.seat.purchaseId);
      const unclaimedSeats = licenceSeats.filter(
        (seat) => seat.redeemedAt === null && seat.refundedAt === null
      ).length;

      await sendNotification(gateway, {
        workflow: "seat-claimed",
        domainId: claim.seat.id,
        recipients: [claim.teamAdmin],
        actor: claim.student,
        data: {
          seat_id: claim.seat.id,
          purchase_id: claim.seat.purchaseId,
          course_id: claim.course.id,
          course_title: claim.course.title,
          unclaimed_seats: unclaimedSeats,
          seats_total: licenceSeats.length,
          url: "/team",
        },
      });
    }
  );
}

// ─── New Enrollment ───

/**
 * Tells a course's Instructor that a Student enrolled in it, through an
 * Individual Purchase or a Claimed Seat. A Lapsed Student enrolling again gets
 * a new Enrollment, so it counts too. Buying a Team Licence enrolls nobody, so
 * nothing calls this for it.
 */
export function notifyNewEnrollment(
  gateway: NotificationGateway,
  db: Db,
  enrollmentId: number
): Promise<void> {
  return fireAndForget(
    { workflow: "new-enrollment", domainId: enrollmentId },
    async () => {
      const found = db
        .select({
          enrollment: enrollments,
          student: users,
          instructor: instructors,
          course: courses,
        })
        .from(enrollments)
        .innerJoin(users, eq(enrollments.userId, users.id))
        .innerJoin(courses, eq(enrollments.courseId, courses.id))
        .innerJoin(instructors, eq(courses.instructorId, instructors.id))
        .where(eq(enrollments.id, enrollmentId))
        .get();
      if (!found) return;

      await sendNotification(gateway, {
        workflow: "new-enrollment",
        domainId: found.enrollment.id,
        recipients: [found.instructor],
        actor: found.student,
        data: {
          enrollment_id: found.enrollment.id,
          course_id: found.course.id,
          course_title: found.course.title,
          url: `/instructor/${found.course.id}/students`,
        },
      });
    }
  );
}
