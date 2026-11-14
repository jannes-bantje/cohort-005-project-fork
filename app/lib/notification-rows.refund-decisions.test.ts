import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notificationRow } from "./notification-rows";

// Rows for Refund Request decisions. The deciding Platform Admin is Knock's
// actor ("Pat Admin" below) and must never show up in the row.

describe("notificationRow for Refund Request decisions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders an approved Refund Request on an Individual Purchase", () => {
    const row = notificationRow({
      workflow: "refund-request-approved",
      data: {
        refund_request_id: 4,
        purchase_id: 9,
        course_id: 1,
        course_title: "Introduction to TypeScript",
        purchase_kind: "individual_purchase",
        amount_cents: 7900,
        decision_note: "Sorry it didn't work out.",
        url: "/settings",
      },
      actorName: "Pat Admin",
      insertedAt: "2026-11-14T11:58:00Z",
    });

    expect(row).toEqual({
      icon: "refund-request-approved",
      title: "Your Refund Request was approved",
      details: [
        "Introduction to TypeScript · Refund of $79.00",
        "“Sorry it didn't work out.”",
      ],
      time: "2m ago",
      url: "/settings",
    });
  });

  it("renders an approved Refund Request on a Team Licence with no decision note", () => {
    const row = notificationRow({
      workflow: "refund-request-approved",
      data: {
        refund_request_id: 5,
        purchase_id: 12,
        course_id: 3,
        course_title: "Design Systems with Tailwind",
        purchase_kind: "team_licence",
        amount_cents: 39500,
        decision_note: null,
        url: "/settings",
      },
      actorName: "Pat Admin",
      insertedAt: "2026-11-14T11:58:00Z",
    });

    expect(row).toEqual({
      icon: "refund-request-approved",
      title: "Your Refund Request was approved",
      details: [
        "Your Team Licence for Design Systems with Tailwind · Refund of $395.00",
      ],
      time: "2m ago",
      url: "/settings",
    });
  });

  it("renders a declined Refund Request on an Individual Purchase", () => {
    const row = notificationRow({
      workflow: "refund-request-declined",
      data: {
        refund_request_id: 6,
        purchase_id: 9,
        course_id: 1,
        course_title: "Introduction to TypeScript",
        purchase_kind: "individual_purchase",
        decision_note: "You watched most of the course before asking.",
        url: "/settings",
      },
      actorName: "Pat Admin",
      insertedAt: "2026-11-14T09:00:00Z",
    });

    expect(row).toEqual({
      icon: "refund-request-declined",
      title: "Your Refund Request was declined",
      details: [
        "Introduction to TypeScript",
        "“You watched most of the course before asking.”",
        "You can raise a new Refund Request.",
      ],
      time: "3h ago",
      url: "/settings",
    });
  });

  it("renders a declined Refund Request on a Team Licence", () => {
    const row = notificationRow({
      workflow: "refund-request-declined",
      data: {
        refund_request_id: 7,
        purchase_id: 12,
        course_id: 3,
        course_title: "Design Systems with Tailwind",
        purchase_kind: "team_licence",
        decision_note: "A Seat has already been claimed.",
        url: "/settings",
      },
      actorName: "Pat Admin",
      insertedAt: "2026-11-14T09:00:00Z",
    });

    expect(row).toEqual({
      icon: "refund-request-declined",
      title: "Your Refund Request was declined",
      details: [
        "Your Team Licence for Design Systems with Tailwind",
        "“A Seat has already been claimed.”",
        "You can raise a new Refund Request.",
      ],
      time: "3h ago",
      url: "/settings",
    });
  });

  it("renders a fallback row when the decision note is longer than 140 characters", () => {
    const row = notificationRow({
      workflow: "refund-request-declined",
      data: {
        refund_request_id: 7,
        purchase_id: 12,
        course_id: 3,
        course_title: "Design Systems with Tailwind",
        purchase_kind: "team_licence",
        decision_note: "A Seat has already been claimed. ".repeat(5),
        url: "/settings",
      },
      actorName: "Pat Admin",
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
});
