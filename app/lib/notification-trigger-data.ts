import { z } from "zod";

// ─── Trigger data contract ───
// The `data` each Notification carries into Knock, one schema per workflow
// key. The notify functions build payloads with it and the bell's row renderer
// parses them with it, so the two can't drift apart. Browser-safe: no server
// imports.
//
// Conventions:
// - fields are snake_case and ids are numbers
// - `url` is an app-relative path, rendered as a <Link>
// - display text (titles, excerpts) is snapshotted when the trigger fires
// - the actor is never repeated here: their name comes from Knock's actor
// - payloads only change additively, with no version field
//
// To add a Notification, add its schema to `triggerDataSchema`. The row
// renderer then fails to type-check until it renders the new workflow.

/** Longest excerpt, reason or decision note a payload carries. */
export const MAX_SNIPPET_LENGTH = 140;

/**
 * Collapses whitespace and cuts the text to MAX_SNIPPET_LENGTH characters,
 * ending in "…" when it was cut. Applied when the trigger fires; the full text
 * stays on the page the Notification links to.
 */
export function snippet(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_SNIPPET_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_SNIPPET_LENGTH - 1).trimEnd()}…`;
}

const id = z.number().int();
const appPath = z.string().startsWith("/");
const snippetText = z.string().max(MAX_SNIPPET_LENGTH);

const discussionReplyData = z.object({
  comment_id: id,
  question_comment_id: id,
  lesson_id: id,
  course_id: id,
  course_title: z.string(),
  lesson_title: z.string(),
  excerpt: snippetText,
  url: appPath,
});

// The glossary's Individual Purchase and Team Licence.
const purchaseKind = z.enum(["individual_purchase", "team_licence"]);

// A Refund Request decision. The deciding Platform Admin is Knock's actor and
// is never rendered.
const refundRequestDeclinedData = z.object({
  refund_request_id: id,
  purchase_id: id,
  course_id: id,
  course_title: z.string(),
  purchase_kind: purchaseKind,
  decision_note: snippetText.nullable(),
  url: appPath,
});

const refundRequestApprovedData = refundRequestDeclinedData.extend({
  /** The amount refunded, in integer cents. */
  amount_cents: z.number().int(),
});

export const triggerDataSchema = z.discriminatedUnion("workflow", [
  z.object({
    workflow: z.literal("discussion-reply"),
    data: discussionReplyData,
  }),
  z.object({
    workflow: z.literal("refund-request-approved"),
    data: refundRequestApprovedData,
  }),
  z.object({
    workflow: z.literal("refund-request-declined"),
    data: refundRequestDeclinedData,
  }),
]);

export type TriggerData = z.infer<typeof triggerDataSchema>;

/** The workflow keys the contract has a schema for. */
export type ContractWorkflow = TriggerData["workflow"];

/** Each workflow's `data` payload, keyed by workflow. */
export type TriggerDataMap = {
  [P in TriggerData as P["workflow"]]: P["data"];
};

/** The `data` payload of one workflow. */
export type TriggerDataFor<W extends ContractWorkflow> = TriggerDataMap[W];
