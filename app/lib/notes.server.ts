import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { courses, lessons, modules, notes } from "~/db/schema";
import { MAX_NOTE_LENGTH, NOTE_TOO_LONG } from "~/lib/notes";

// ─── Notes ───
// A Student's own plain-text writing about a Lesson, private to that Student.
// One per Student per Lesson, enforced by the unique index on
// (user_id, lesson_id). See GLOSSARY.md.
//
// Nothing outside the owning Student's Lesson page and Saved page may read a
// Note body: no Instructor or Platform Admin view.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Content access is the caller's job: the Lesson page action checks it
// before calling in.

export type Db = BetterSQLite3Database<typeof schema>;

type Note = typeof notes.$inferSelect;

function whereStudentLesson(studentId: number, lessonId: number) {
  return and(eq(notes.userId, studentId), eq(notes.lessonId, lessonId));
}

export function getNote(db: Db, studentId: number, lessonId: number) {
  return db
    .select()
    .from(notes)
    .where(whereStudentLesson(studentId, lessonId))
    .get();
}

export type SaveNoteResult =
  { ok: true; note: Note | null } | { ok: false; error: string };

/**
 * Stores the Student's Note on the Lesson, trimmed. Saving again replaces the
 * body and moves `updatedAt` (the "last edited" time) on; `createdAt` stays.
 * An empty body removes the Note, and the result's `note` is then null.
 */
export function saveNote(
  db: Db,
  studentId: number,
  lessonId: number,
  body: string,
  now: Date
): SaveNoteResult {
  const trimmed = body.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: NOTE_TOO_LONG };
  }

  if (trimmed.length === 0) {
    db.delete(notes).where(whereStudentLesson(studentId, lessonId)).run();
    return { ok: true, note: null };
  }

  const at = now.toISOString();
  const note = db
    .insert(notes)
    .values({
      userId: studentId,
      lessonId,
      body: trimmed,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: trimmed, updatedAt: at },
    })
    .returning()
    .get();

  return { ok: true, note };
}

/** The Student's Notes, last edited first, each with its Lesson and Course. */
export function listNotes(db: Db, studentId: number) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(notes)
    .innerJoin(lessons, eq(lessons.id, notes.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(notes.userId, studentId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}
