import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notificationRow, unseenBadge } from "./notification-rows";

describe("unseenBadge", () => {
  it("is hidden when nothing is unseen", () => {
    expect(unseenBadge(0)).toBeNull();
  });

  it("counts up to nine, then says 9+", () => {
    expect(unseenBadge(1)).toBe("1");
    expect(unseenBadge(9)).toBe("9");
    expect(unseenBadge(10)).toBe("9+");
  });
});

describe("notificationRow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a Discussion Reply", () => {
    const row = notificationRow({
      workflow: "discussion-reply",
      data: {
        comment_id: 12,
        question_comment_id: 7,
        lesson_id: 3,
        course_id: 1,
        course_title: "Introduction to TypeScript",
        lesson_title: "Generics",
        excerpt: "Use Array<T>, or T[] for short.",
        url: "/courses/introduction-to-typescript/lessons/3",
      },
      actorName: "Sarah Chen",
      insertedAt: "2026-11-14T11:55:00Z",
    });

    expect(row).toEqual({
      icon: "discussion-reply",
      title: "Sarah Chen replied to your Discussion Question",
      details: [
        "Introduction to TypeScript · Generics",
        "“Use Array<T>, or T[] for short.”",
      ],
      time: "5m ago",
      url: "/courses/introduction-to-typescript/lessons/3",
    });
  });

  it("renders a Discussion Question", () => {
    const row = notificationRow({
      workflow: "discussion-question",
      data: {
        comment_id: 9,
        lesson_id: 3,
        course_id: 1,
        course_title: "Introduction to TypeScript",
        lesson_title: "Generics",
        excerpt: "How do generics work with arrays?",
        url: "/courses/introduction-to-typescript/lessons/3",
      },
      actorName: "Emma Wilson",
      insertedAt: "2026-11-14T11:58:00Z",
    });

    expect(row).toEqual({
      icon: "discussion-question",
      title: "Emma Wilson asked a Discussion Question",
      details: [
        "Introduction to TypeScript · Generics",
        "“How do generics work with arrays?”",
      ],
      time: "2m ago",
      url: "/courses/introduction-to-typescript/lessons/3",
    });
  });

  it("renders a fallback row with no link when the data doesn't parse", () => {
    const row = notificationRow({
      workflow: "discussion-reply",
      data: { comment_id: "12", excerpt: "Use Array<T>." },
      actorName: "Sarah Chen",
      insertedAt: "2026-11-14T09:00:00Z",
    });

    expect(row).toEqual({
      icon: "notification",
      title: "You have a new Notification",
      details: [],
      time: "3h ago",
      url: null,
    });
  });

  it("renders a fallback row for a workflow it doesn't know", () => {
    const row = notificationRow({
      workflow: "something-new",
      data: null,
      actorName: null,
      insertedAt: "2026-11-12T12:00:00Z",
    });

    expect(row).toEqual({
      icon: "notification",
      title: "You have a new Notification",
      details: [],
      time: "2d ago",
      url: null,
    });
  });
});
