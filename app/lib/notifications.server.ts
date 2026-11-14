import { sign } from "node:crypto";
import { alias } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";
import { comments, courses, lessons, modules, users } from "~/db/schema";
import type {
  NotificationGateway,
  NotificationUser,
} from "~/lib/notification-gateway";
import type { WorkflowKey } from "~/lib/notification-keys";
import {
  snippet,
  type ContractWorkflow,
  type TriggerDataFor,
} from "~/lib/notification-trigger-data";
import type { Db } from "~/lib/refunds.server";

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

type Person = { id: number; name: string; email: string };

/** A Cadence user as Knock knows them: the Knock id is the Cadence id as a string. */
function knockUser(person: Person): NotificationUser {
  return { id: String(person.id), name: person.name, email: person.email };
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

function lessonUrl(courseSlug: string, lessonId: number) {
  return `/courses/${courseSlug}/lessons/${lessonId}`;
}

// ─── Discussion Reply ───

const questions = alias(comments, "questions");
const questionAuthors = alias(users, "question_authors");

/**
 * Tells a Discussion Question's author that someone else posted a Discussion
 * Reply to it. Only the question's author hears about it, not others who
 * replied in the thread.
 */
export function notifyDiscussionReply(
  gateway: NotificationGateway,
  db: Db,
  replyId: number
): Promise<void> {
  return fireAndForget(
    { workflow: "discussion-reply", domainId: replyId },
    async () => {
      const reply = db
        .select({
          comment: comments,
          question: questions,
          replier: users,
          questionAuthor: questionAuthors,
          lesson: lessons,
          course: courses,
        })
        .from(comments)
        .innerJoin(questions, eq(comments.parentId, questions.id))
        .innerJoin(users, eq(comments.userId, users.id))
        .innerJoin(questionAuthors, eq(questions.userId, questionAuthors.id))
        .innerJoin(lessons, eq(comments.lessonId, lessons.id))
        .innerJoin(modules, eq(lessons.moduleId, modules.id))
        .innerJoin(courses, eq(modules.courseId, courses.id))
        .where(eq(comments.id, replyId))
        .get();
      if (!reply) return;

      await sendNotification(gateway, {
        workflow: "discussion-reply",
        domainId: reply.comment.id,
        recipients: [reply.questionAuthor],
        actor: reply.replier,
        data: {
          comment_id: reply.comment.id,
          question_comment_id: reply.question.id,
          lesson_id: reply.lesson.id,
          course_id: reply.course.id,
          course_title: reply.course.title,
          lesson_title: reply.lesson.title,
          excerpt: snippet(reply.comment.body),
          url: lessonUrl(reply.course.slug, reply.lesson.id),
        },
      });
    }
  );
}

// ─── Feed user token ───
// Knock's enhanced security mode only lets the browser read a Notification
// Feed with a token Cadence signed for that user. Signing is local crypto, not
// a gateway call.

/** How long a feed user token lasts. */
const USER_TOKEN_LIFETIME_SECONDS = 60 * 60;

/**
 * A token is reused until fewer than this many seconds remain, so the browser
 * never gets one that is about to expire.
 */
const USER_TOKEN_RENEW_BEFORE_SECONDS = 10 * 60;

export type UserToken = {
  token: string;
  /** Seconds since the epoch, like the token's `exp` claim. */
  expiresAt: number;
};

/** Feed user tokens already issued, by Cadence user id. */
export type UserTokens = Map<number, UserToken>;

/**
 * The user's feed token. Reuses the one already issued until it is about to
 * expire; otherwise identifies the user to Knock (name and email) and signs a
 * new one, so there is one identification per token issued, not per request.
 * Keyed by user, so switching users in DevUI gets that user's token. If
 * identifying fails, the error is logged and the token is still signed.
 */
export async function feedUserToken(
  gateway: NotificationGateway,
  tokens: UserTokens,
  { user, signingKey, now }: { user: Person; signingKey: string; now: Date }
): Promise<UserToken> {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const issued = tokens.get(user.id);
  if (
    issued &&
    issued.expiresAt - nowSeconds > USER_TOKEN_RENEW_BEFORE_SECONDS
  ) {
    return issued;
  }

  try {
    await gateway.identifyUser(knockUser(user));
  } catch (error) {
    console.error(`Could not identify user ${user.id} to Knock`, error);
  }

  const userToken = signUserToken(user.id, signingKey, nowSeconds);
  tokens.set(user.id, userToken);
  return userToken;
}

/**
 * Signs an RS256 JWT whose `sub` is the Cadence user id as a string, the shape
 * Knock expects. `signingKey` is the PKCS#8 private key as PEM, or as
 * base64-encoded PEM (how KNOCK_SIGNING_KEY holds it).
 */
function signUserToken(
  userId: number,
  signingKey: string,
  nowSeconds: number
): UserToken {
  const expiresAt = nowSeconds + USER_TOKEN_LIFETIME_SECONDS;
  const header = base64url({ alg: "RS256", typ: "JWT" });
  const claims = base64url({
    sub: String(userId),
    iat: nowSeconds,
    exp: expiresAt,
  });
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${claims}`),
    privateKeyPem(signingKey)
  ).toString("base64url");
  return { token: `${header}.${claims}.${signature}`, expiresAt };
}

function base64url(json: object) {
  return Buffer.from(JSON.stringify(json)).toString("base64url");
}

function privateKeyPem(signingKey: string) {
  if (signingKey.includes("-----BEGIN")) return signingKey;
  return Buffer.from(signingKey, "base64").toString("utf8");
}
