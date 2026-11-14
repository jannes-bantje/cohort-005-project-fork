// PROTOTYPE — throwaway for "What does the Notification Feed look like in
// Cadence?" (#16). prototype/notification-feed branch only. Never merge.
//
// Resource route. POST fills the DevUI user's Notification Feed with sample
// Notifications from the v1 catalogue, built from real rows in data.db and
// sent through the real Knock workflows (scripts/prototype-feed-setup.ts).
//
//   intent=role → what this user would really get for their role
//   intent=all  → one of each of the 7, regardless of role

import { data } from "react-router";
import { and, eq, isNull, ne } from "drizzle-orm";
import { Knock as KnockNode } from "@knocklabs/node";
import type { Route } from "./+types/prototype.notification-feed";
import { db } from "~/db";
import {
  comments,
  courses,
  lessons,
  modules,
  teamMembers,
  TeamMemberRole,
  UserRole,
  users,
} from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";

type Kind =
  | "refund-approved"
  | "refund-declined"
  | "refund-request-opened"
  | "seat-claimed"
  | "new-enrollment"
  | "discussion-question"
  | "discussion-reply";

const REASONS = [
  "The pace is too fast for me, I need a beginner course first.",
  "I bought the wrong course by mistake.",
  "The content overlaps a lot with a course I already own.",
];
const NOTES = [
  "Sorry it wasn't the right fit. Hope to see you back!",
  "Refunds are only available within 30 days of purchase.",
];

function knock() {
  if (!process.env.KNOCK_API_KEY) process.loadEnvFile(".env");
  return new KnockNode();
}

const person = (u: { id: number; name: string; email: string }) => ({
  id: String(u.id),
  name: u.name,
  email: u.email,
});

function otherStudents(meId: number) {
  return db
    .select()
    .from(users)
    .where(and(eq(users.role, UserRole.Student), ne(users.id, meId)))
    .limit(12)
    .all()
    .sort(() => Math.random() - 0.5);
}

function coursesFor(meId: number, role: UserRole) {
  const all = db.select().from(courses).all();
  const own = all.filter((c) => c.instructorId === meId);
  return role === UserRole.Instructor && own.length ? own : all;
}

function lessonIn(courseId: number) {
  const rows = db
    .select({ id: lessons.id, title: lessons.title })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(eq(modules.courseId, courseId))
    .all();
  return rows[Math.floor(Math.random() * rows.length)];
}

function questionText(lessonId: number) {
  const c = db
    .select({ body: comments.body })
    .from(comments)
    .where(and(eq(comments.lessonId, lessonId), isNull(comments.deletedAt)))
    .get();
  return (
    c?.body ??
    "Why does the compiler infer `never` here instead of the union I expected?"
  );
}

const excerpt = (s: string) => (s.length > 90 ? s.slice(0, 87) + "…" : s);

function build(kind: Kind, meId: number, role: UserRole, i: number) {
  const students = otherStudents(meId);
  const actor = students[i % students.length];
  const cs = coursesFor(meId, role);
  const course = cs[i % cs.length];
  const lesson = lessonIn(course.id);
  const lessonUrl = `/courses/${course.slug}/lessons/${lesson?.id}`;
  const price = `$${(course.price / 100).toFixed(2)}`;

  switch (kind) {
    case "refund-approved":
      return {
        actor: db.select().from(users).where(eq(users.role, UserRole.Admin)).get()!,
        data: {
          course_title: course.title,
          course_slug: course.slug,
          amount: price,
          decision_note: i % 2 ? NOTES[0] : null,
          url: `/courses/${course.slug}`,
        },
      };
    case "refund-declined":
      return {
        actor: db.select().from(users).where(eq(users.role, UserRole.Admin)).get()!,
        data: {
          course_title: course.title,
          course_slug: course.slug,
          decision_note: NOTES[1],
          url: `/courses/${course.slug}`,
        },
      };
    case "refund-request-opened":
      return {
        actor,
        data: {
          course_title: course.title,
          amount: price,
          reason: REASONS[i % REASONS.length],
          url: "/admin/refunds",
        },
      };
    case "seat-claimed":
      return {
        actor,
        data: {
          course_title: course.title,
          seats_left: Math.max(0, 7 - i),
          seats_total: 10,
          url: "/team",
        },
      };
    case "new-enrollment":
      return {
        actor,
        data: {
          course_title: course.title,
          url: `/instructor/${course.id}/students`,
        },
      };
    case "discussion-question":
      return {
        actor,
        data: {
          course_title: course.title,
          lesson_title: lesson?.title,
          excerpt: excerpt(questionText(lesson?.id ?? 0)),
          url: lessonUrl,
        },
      };
    case "discussion-reply":
      return {
        actor,
        data: {
          course_title: course.title,
          lesson_title: lesson?.title,
          excerpt: excerpt(
            [
              "Good question! It's because the generic is resolved before the conditional type runs.",
              "I had the same problem — wrapping it in a tuple fixed it for me.",
            ][i % 2]
          ),
          url: lessonUrl,
        },
      };
  }
}

function kindsForRole(meId: number, role: UserRole): Kind[] {
  const teamAdmin = db
    .select()
    .from(teamMembers)
    .where(
      and(eq(teamMembers.userId, meId), eq(teamMembers.role, TeamMemberRole.Admin))
    )
    .get();
  if (role === UserRole.Admin)
    return ["refund-request-opened", "refund-request-opened", "refund-request-opened"];
  if (role === UserRole.Instructor)
    return [
      "new-enrollment",
      "discussion-question",
      "new-enrollment",
      "discussion-question",
      "discussion-reply",
      "new-enrollment",
    ];
  if (teamAdmin)
    return ["seat-claimed", "seat-claimed", "seat-claimed", "refund-declined"];
  return ["discussion-reply", "refund-approved", "discussion-reply", "refund-declined"];
}

export async function action({ request }: Route.ActionArgs) {
  const meId = await getCurrentUserId(request);
  if (!meId) throw data("Select a user from the DevUI panel.", { status: 401 });
  const me = db.select().from(users).where(eq(users.id, meId)).get()!;
  const intent = (await request.formData()).get("intent");
  const k = knock();

  const kinds: Kind[] =
    intent === "all"
      ? [
          "refund-approved",
          "refund-declined",
          "refund-request-opened",
          "seat-claimed",
          "new-enrollment",
          "discussion-question",
          "discussion-reply",
        ]
      : kindsForRole(me.id, me.role as UserRole);

  const sent: string[] = [];
  for (const [i, kind] of kinds.entries()) {
    const { actor, data: payload } = build(kind, me.id, me.role as UserRole, i);
    await k.workflows.trigger(kind, {
      recipients: [person(me)],
      actor: person(actor),
      data: payload,
    });
    sent.push(kind);
  }
  return { sent };
}
