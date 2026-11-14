import {
  triggerDataSchema,
  type ContractWorkflow,
  type TriggerDataFor,
} from "~/lib/notification-trigger-data";
import { formatRelativeTime } from "~/lib/utils";

// ─── Notification rows ───
// Turns a Notification Feed item into what one row of the bell shows, in
// Cadence's own words. Knock's rendered templates are never shown. Pure and
// browser-safe, so it can be tested without React or Knock.

/** What the row renderer needs from a Knock feed item. */
export type FeedItemInput = {
  /** The workflow key (Knock's `source.key`). */
  workflow: string;
  /** The trigger data, as Knock hands it back. Not trusted until parsed. */
  data: unknown;
  /** The actor's current name, from Knock's actor. */
  actorName: string | null;
  /** When the Notification reached the feed (ISO timestamp). */
  insertedAt: string;
};

/** One icon per workflow, plus one for the fallback row. */
export type NotificationRowIcon = ContractWorkflow | "notification";

export type NotificationRow = {
  icon: NotificationRowIcon;
  title: string;
  details: string[];
  time: string;
  /** Where clicking the row goes, or null when the row has no link. */
  url: string | null;
};

type RowContent = Omit<NotificationRow, "time">;

// One renderer per workflow in the trigger data contract. Adding a schema to
// the contract makes this object fail to type-check until it has a renderer.
const renderers: {
  [W in ContractWorkflow]: (
    data: TriggerDataFor<W>,
    actorName: string
  ) => RowContent;
} = {
  "discussion-reply": (data, actorName) => ({
    icon: "discussion-reply",
    title: `${actorName} replied to your Discussion Question`,
    details: [
      `${data.course_title} · ${data.lesson_title}`,
      quote(data.excerpt),
    ],
    url: data.url,
  }),
  "discussion-question": (data, actorName) => ({
    icon: "discussion-question",
    title: `${actorName} asked a Discussion Question`,
    details: [
      `${data.course_title} · ${data.lesson_title}`,
      quote(data.excerpt),
    ],
    url: data.url,
  }),
};

const fallback: RowContent = {
  icon: "notification",
  title: "You have a new Notification",
  details: [],
  url: null,
};

export function notificationRow(item: FeedItemInput): NotificationRow {
  const time = formatRelativeTime(item.insertedAt);
  const parsed = triggerDataSchema.safeParse({
    workflow: item.workflow,
    data: item.data,
  });
  if (!parsed.success) return { ...fallback, time };

  const actorName = item.actorName ?? "Someone";
  return { ...render(parsed.data, actorName), time };
}

function render<W extends ContractWorkflow>(
  payload: { workflow: W; data: TriggerDataFor<W> },
  actorName: string
): RowContent {
  return renderers[payload.workflow](payload.data, actorName);
}

/** The bell's badge: the unseen count, "9+" above nine, or null to hide it. */
export function unseenBadge(unseenCount: number): string | null {
  if (unseenCount <= 0) return null;
  return unseenCount > 9 ? "9+" : String(unseenCount);
}

function quote(text: string) {
  return `“${text}”`;
}
