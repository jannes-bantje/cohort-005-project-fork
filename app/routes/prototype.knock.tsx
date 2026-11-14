// PROTOTYPE — throwaway spike for "Does Knock hold up against Cadence?" (#18).
// Lives on the prototype/knock-spike branch only. Never merge.
//
// One page that exercises the four checks against the real app:
//   1. Signed user tokens: the loader signs an RS256 token for the DevUI user.
//   2. Triggering: the action fires a real Knock workflow via the Node SDK.
//   3. Headless feed API: @knocklabs/client lists items, unread/unseen counts,
//      and marks items read/seen. No Knock React components.
//   4. Preferences: category × channel grid; "enrollments" is off by default
//      (environment default) and the Instructor can opt in.
//
// Setup once: npx tsx scripts/prototype-knock-setup.ts
// Then: npm run dev, open /prototype/knock, switch users in the DevUI panel.

import { useEffect, useMemo, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { eq, and, isNull, desc } from "drizzle-orm";
import { Knock as KnockNode, signUserToken } from "@knocklabs/node";
import Knock, {
  type Feed,
  type FeedStoreState,
  type PreferenceSet,
} from "@knocklabs/client";
import type { Route } from "./+types/prototype.knock";
import { db } from "~/db";
import { comments, courses, lessons, users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";

// Nothing in the app loads .env into process.env, so the spike does it lazily
// (server only: called from the loader/action, which never reach the client).
function loadKnockEnv() {
  if (!process.env.KNOCK_API_KEY) process.loadEnvFile(".env");
}

const knockServer = () => new KnockNode(); // reads KNOCK_API_KEY

async function identify(userId: number) {
  loadKnockEnv();
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw data("User not found", { status: 404 });
  await knockServer().users.update(String(user.id), {
    name: user.name,
    email: user.email,
  });
  return user;
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }
  const user = await identify(currentUserId);
  const token = await signUserToken(String(user.id), {
    expiresInSeconds: 3600,
  });

  const questions = db
    .select({
      id: comments.id,
      body: comments.body,
      authorId: users.id,
      authorName: users.name,
      lessonTitle: lessons.title,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .innerJoin(lessons, eq(lessons.id, comments.lessonId))
    .where(and(isNull(comments.parentId), isNull(comments.deletedAt)))
    .orderBy(desc(comments.id))
    .limit(8)
    .all();

  const courseList = db
    .select({
      id: courses.id,
      title: courses.title,
      instructorId: users.id,
      instructorName: users.name,
    })
    .from(courses)
    .innerJoin(users, eq(users.id, courses.instructorId))
    .limit(8)
    .all();

  return {
    user: { id: user.id, name: user.name, role: user.role },
    token,
    publicKey: process.env.KNOCK_PUBLIC_API_KEY!,
    feedChannelId: process.env.KNOCK_FEED_CHANNEL_ID!,
    questions,
    courses: courseList,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) throw data("No user", { status: 401 });
  const form = await request.formData();
  const intent = form.get("intent");
  const actor = await identify(currentUserId);
  const knock = knockServer();

  if (intent === "reply") {
    const questionId = Number(form.get("questionId"));
    const q = db
      .select({
        authorId: comments.userId,
        lessonTitle: lessons.title,
        lessonId: lessons.id,
      })
      .from(comments)
      .innerJoin(lessons, eq(lessons.id, comments.lessonId))
      .where(eq(comments.id, questionId))
      .get();
    if (!q) throw data("No question", { status: 404 });
    await identify(q.authorId);
    const res = await knock.workflows.trigger("discussion-reply", {
      recipients: [String(q.authorId)],
      actor: String(actor.id),
      data: {
        lesson_title: q.lessonTitle,
        excerpt: String(form.get("excerpt") || "(prototype reply)"),
        url: `/prototype/knock?question=${questionId}`,
      },
    });
    return { triggered: "discussion-reply", recipient: q.authorId, res };
  }

  if (intent === "enroll") {
    const courseId = Number(form.get("courseId"));
    const c = db.select().from(courses).where(eq(courses.id, courseId)).get();
    if (!c) throw data("No course", { status: 404 });
    await identify(c.instructorId);
    const res = await knock.workflows.trigger("new-enrollment", {
      recipients: [String(c.instructorId)],
      actor: String(actor.id),
      data: { course_title: c.title, url: `/instructor/${c.id}/students` },
    });
    return { triggered: "new-enrollment", recipient: c.instructorId, res };
  }

  if (intent === "reset-prefs") {
    await knock.users.unsetPreferences(String(actor.id), "default");
    return { reset: "preferences", user: actor.id };
  }

  throw data("Unknown intent", { status: 400 });
}

function decodeJwt(token: string) {
  const [header, payload] = token.split(".").slice(0, 2).map((p) => {
    const b64 = p.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64));
  });
  return { header, payload };
}

// Client-side Knock session for the DevUI user. Rebuilt whenever the user
// (and so the signed token) changes — that is check 1.
function useKnock(userId: number, token: string, publicKey: string, channelId: string) {
  const [feedState, setFeedState] = useState<FeedStoreState | null>(null);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [knock, setKnock] = useState<Knock | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const k = new Knock(publicKey);
    k.authenticate(String(userId), token);
    const f = k.feeds.initialize(channelId, { page_size: 20, archived: "exclude" });
    const unsub = f.store.subscribe(setFeedState);
    f.listenForUpdates();
    f.fetch().catch((e) => setError(String(e)));
    setKnock(k);
    setFeed(f);
    return () => {
      unsub();
      f.dispose();
      k.teardown();
    };
  }, [userId, token, publicKey, channelId]);

  return { knock, feed, feedState, error };
}

const CATEGORIES = ["discussions", "enrollments"] as const;

export default function PrototypeKnock({ loaderData }: Route.ComponentProps) {
  const { user, token, publicKey, feedChannelId, questions, courses } = loaderData;
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const { knock, feed, feedState, error } = useKnock(user.id, token, publicKey, feedChannelId);
  const [prefs, setPrefs] = useState<PreferenceSet | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const claims = useMemo(() => decodeJwt(token), [token]);

  useEffect(() => {
    setPrefs(null);
    if (!knock) return;
    knock.preferences
      .get()
      .then(setPrefs)
      .catch((e) => setPrefsError(String(e)));
  }, [knock]);

  async function toggleCategory(category: string, on: boolean) {
    if (!knock) return;
    try {
      const next = await knock.preferences.setCategory(category, {
        channel_types: { in_app_feed: on },
      });
      setPrefs(next);
    } catch (e) {
      setPrefsError(String(e));
    }
  }

  function categoryValue(category: string): string {
    const v = prefs?.categories?.[category];
    if (v === undefined) return "unset (falls back to env default)";
    if (typeof v === "boolean") return String(v);
    if ("channel_types" in v) return `in_app_feed: ${String(v.channel_types.in_app_feed)}`;
    return JSON.stringify(v);
  }

  const items = feedState?.items ?? [];
  const meta = feedState?.metadata;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="rounded border-2 border-dashed border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">
        PROTOTYPE: Knock spike for #18. Throwaway, never merge.
      </div>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2 rounded border p-4">
          <h2 className="font-semibold">1 · Signed user token</h2>
          <p className="text-sm">
            DevUI user: <b>{user.name}</b> (id {user.id}, {user.role})
          </p>
          <pre className="overflow-x-auto bg-muted p-2 text-xs">
            {JSON.stringify(claims, null, 2)}
          </pre>
          {error && <p className="text-sm text-red-600">Feed error: {error}</p>}
        </div>

        <div className="space-y-3 rounded border p-4">
          <h2 className="font-semibold">2 · Trigger via Node SDK</h2>
          <p className="text-xs text-muted-foreground">
            Acting as {user.name}. Reply → question author gets a Discussion Reply.
          </p>
          {questions.map((q) => (
            <Form method="post" key={q.id} className="flex items-center gap-2 text-sm">
              <input type="hidden" name="intent" value="reply" />
              <input type="hidden" name="questionId" value={q.id} />
              <input type="hidden" name="excerpt" value={`Re: ${q.body.slice(0, 40)}`} />
              <button className="rounded border px-2 py-0.5 hover:bg-muted" disabled={nav.state !== "idle"}>
                Reply
              </button>
              <span className="truncate">
                {q.authorName} · {q.lessonTitle} · “{q.body.slice(0, 40)}”
              </span>
            </Form>
          ))}
          <p className="pt-2 text-xs text-muted-foreground">
            Enroll → course Instructor gets a New Enrollment (off by default).
          </p>
          {courses.map((c) => (
            <Form method="post" key={c.id} className="flex items-center gap-2 text-sm">
              <input type="hidden" name="intent" value="enroll" />
              <input type="hidden" name="courseId" value={c.id} />
              <button className="rounded border px-2 py-0.5 hover:bg-muted" disabled={nav.state !== "idle"}>
                Enroll
              </button>
              <span className="truncate">
                {c.title} · instructor {c.instructorName} (id {c.instructorId})
              </span>
            </Form>
          ))}
          {actionData && (
            <pre className="overflow-x-auto bg-muted p-2 text-xs">
              {JSON.stringify(actionData, null, 2)}
            </pre>
          )}
        </div>
      </section>

      <section className="space-y-3 rounded border p-4">
        <div className="flex items-center gap-4">
          <h2 className="font-semibold">3 · Headless feed</h2>
          <span className="text-sm">
            total {meta?.total_count ?? "–"} · unread <b>{meta?.unread_count ?? "–"}</b> · unseen{" "}
            <b>{meta?.unseen_count ?? "–"}</b>
          </span>
          <button className="rounded border px-2 py-0.5 text-sm" onClick={() => feed?.markAllAsSeen()}>
            Mark all seen
          </button>
          <button className="rounded border px-2 py-0.5 text-sm" onClick={() => feed?.markAllAsRead()}>
            Mark all read
          </button>
          <button className="rounded border px-2 py-0.5 text-sm" onClick={() => feed?.fetch()}>
            Refetch
          </button>
        </div>
        {items.length === 0 && <p className="text-sm text-muted-foreground">No items.</p>}
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 py-2 text-sm">
              <span className={item.read_at ? "text-muted-foreground" : "font-semibold"}>
                {item.read_at ? "○" : "●"}
              </span>
              <div className="flex-1">
                <div
                  dangerouslySetInnerHTML={{
                    __html: item.blocks.find((b) => b.type === "markdown" && "rendered" in b)
                      ? (item.blocks.find((b) => "rendered" in b) as { rendered: string }).rendered
                      : "",
                  }}
                />
                <div className="text-xs text-muted-foreground">
                  {item.source.key} · {new Date(item.inserted_at).toLocaleTimeString()} · seen{" "}
                  {item.seen_at ? "✓" : "✗"} · read {item.read_at ? "✓" : "✗"}
                </div>
              </div>
              <button className="rounded border px-2 py-0.5 text-xs" onClick={() => feed?.markAsSeen(item)}>
                Seen
              </button>
              <button
                className="rounded border px-2 py-0.5 text-xs"
                onClick={() => (item.read_at ? feed?.markAsUnread(item) : feed?.markAsRead(item))}
              >
                {item.read_at ? "Unread" : "Read"}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded border p-4">
        <h2 className="font-semibold">4 · Preferences (category × in-app feed)</h2>
        <table className="text-sm">
          <tbody>
            {CATEGORIES.map((cat) => (
              <tr key={cat}>
                <td className="pr-4 font-mono">{cat}</td>
                <td className="pr-4">{categoryValue(cat)}</td>
                <td className="space-x-2">
                  <button className="rounded border px-2 py-0.5" onClick={() => toggleCategory(cat, true)}>
                    Opt in
                  </button>
                  <button className="rounded border px-2 py-0.5" onClick={() => toggleCategory(cat, false)}>
                    Opt out
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Form method="post">
          <input type="hidden" name="intent" value="reset-prefs" />
          <button className="rounded border px-2 py-0.5 text-sm">
            Reset my preferences (server: unsetPreferences)
          </button>
        </Form>
        {prefsError && <p className="text-sm text-red-600">{prefsError}</p>}
        <pre className="overflow-x-auto bg-muted p-2 text-xs">{JSON.stringify(prefs, null, 2)}</pre>
      </section>
    </div>
  );
}
