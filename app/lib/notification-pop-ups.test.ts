import { describe, expect, it } from "vitest";
import { stackPopUps } from "./notification-pop-ups";

const reply = { id: "reply", inserted_at: "2026-11-14T12:00:00.000Z" };
const question = { id: "question", inserted_at: "2026-11-14T12:01:00.000Z" };
const enrollment = { id: "enrollment", inserted_at: "2026-11-14T12:02:00.000Z" };
const seat = { id: "seat", inserted_at: "2026-11-14T12:03:00.000Z" };

describe("stackPopUps", () => {
  it("puts Notifications that arrive on top of the pop-ups already showing, newest first", () => {
    expect(stackPopUps([reply], [question, enrollment])).toEqual([
      enrollment,
      question,
      reply,
    ]);
  });

  it("keeps at most three pop-ups, dropping the oldest", () => {
    expect(stackPopUps([question, reply], [seat, enrollment])).toEqual([
      seat,
      enrollment,
      question,
    ]);
  });

  it("doesn't pop up a Notification that is already showing", () => {
    expect(stackPopUps([question, reply], [question])).toEqual([
      question,
      reply,
    ]);
  });
});
