import { generateKeyPairSync, verify } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  feedUserToken,
  fireAndForget,
  notifyDiscussionReply,
  type UserTokens,
} from "./notifications.server";
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
            question_comment_id: 1,
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
            question_comment_id: 1,
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
            question_comment_id: 1,
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

// ─── Feed user token ───

// A throwaway RS256 keypair. KNOCK_SIGNING_KEY holds the private key as
// base64-encoded PEM, so the test hands it over the same way.
const keyPair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const signingKey = Buffer.from(keyPair.privateKey).toString("base64");

// 2026-11-14 12:00:00 UTC, and the same instant in seconds since the epoch.
const NOW = new Date("2026-11-14T12:00:00Z");
const NOW_SECONDS = 1794657600;

/** Checks the RS256 signature with the public key and returns what it signed. */
function verifiedToken(token: string) {
  const [header, payload, signature] = token.split(".");
  const signed = verify(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    keyPair.publicKey,
    Buffer.from(signature, "base64url")
  );
  if (!signed) throw new Error("The token's signature doesn't verify");
  return {
    header: JSON.parse(Buffer.from(header, "base64url").toString()),
    claims: JSON.parse(Buffer.from(payload, "base64url").toString()),
  };
}

describe("feedUserToken", () => {
  it("identifies the user, then signs an RS256 token for them", async () => {
    const gateway = recordingNotificationGateway();

    const { token } = await feedUserToken(gateway, new Map(), {
      user: emma,
      signingKey,
      now: NOW,
    });

    expect(gateway.calls).toEqual([
      {
        method: "identifyUser",
        input: { id: "3", name: "Emma Wilson", email: "emma@example.com" },
      },
    ]);
    expect(verifiedToken(token)).toEqual({
      header: { alg: "RS256", typ: "JWT" },
      claims: { sub: "3", iat: NOW_SECONDS, exp: NOW_SECONDS + 60 * 60 },
    });
  });

  it("still signs the token when identifying the user fails", async () => {
    const gateway = recordingNotificationGateway({ reject: true });

    let token = "";
    const errors = await captureConsoleErrors(async () => {
      ({ token } = await feedUserToken(gateway, new Map(), {
        user: emma,
        signingKey,
        now: NOW,
      }));
    });

    expect(verifiedToken(token).claims).toEqual({
      sub: "3",
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 60 * 60,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0][0]).toBe("Could not identify user 3 to Knock");
  });

  it("reuses a user's token, identifying them once per token issued", async () => {
    const gateway = recordingNotificationGateway();
    const tokens: UserTokens = new Map();

    const first = await feedUserToken(gateway, tokens, {
      user: emma,
      signingKey,
      now: NOW,
    });
    const later = await feedUserToken(gateway, tokens, {
      user: emma,
      signingKey,
      now: new Date("2026-11-14T12:45:00Z"),
    });

    expect(later.token).toBe(first.token);
    expect(gateway.calls).toEqual([
      {
        method: "identifyUser",
        input: { id: "3", name: "Emma Wilson", email: "emma@example.com" },
      },
    ]);
  });

  it("gives each user their own token, like after switching users in DevUI", async () => {
    const gateway = recordingNotificationGateway();
    const tokens: UserTokens = new Map();

    await feedUserToken(gateway, tokens, { user: emma, signingKey, now: NOW });
    const { token } = await feedUserToken(gateway, tokens, {
      user: james,
      signingKey,
      now: NOW,
    });

    expect(verifiedToken(token).claims.sub).toBe("4");
    expect(gateway.calls).toEqual([
      {
        method: "identifyUser",
        input: { id: "3", name: "Emma Wilson", email: "emma@example.com" },
      },
      {
        method: "identifyUser",
        input: { id: "4", name: "James Park", email: "james@example.com" },
      },
    ]);
  });

  it("issues a new token when the old one is about to expire", async () => {
    const gateway = recordingNotificationGateway();
    const tokens: UserTokens = new Map();

    await feedUserToken(gateway, tokens, { user: emma, signingKey, now: NOW });
    const { token } = await feedUserToken(gateway, tokens, {
      user: emma,
      signingKey,
      now: new Date("2026-11-14T12:55:00Z"),
    });

    expect(verifiedToken(token).claims).toEqual({
      sub: "3",
      iat: NOW_SECONDS + 55 * 60,
      exp: NOW_SECONDS + 115 * 60,
    });
    expect(gateway.calls).toHaveLength(2);
  });
});
