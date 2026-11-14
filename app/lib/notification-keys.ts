// ─── Notification keys ───
// The one place Knock's workflow keys and preference category keys are named.
// Trigger functions, the trigger data contract, Notification Preferences and
// `npm run knock:setup` all import from here, so a rename is a type error
// instead of a silent mismatch with Knock.
//
// "Category" is Knock's word for what a Notification Preference switches on or
// off. It never reaches the UI: each category is shown as one Notification
// Preference.

export const CATEGORY_KEYS = [
  "refund-request-decisions",
  "open-refund-requests",
  "claimed-seats",
  "enrollments",
  "discussion-questions",
  "discussion-replies",
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const WORKFLOW_KEYS = [
  "refund-request-approved",
  "refund-request-declined",
  "open-refund-request",
  "seat-claimed",
  "new-enrollment",
  "discussion-question",
  "discussion-reply",
] as const;

export type WorkflowKey = (typeof WORKFLOW_KEYS)[number];

// Every workflow belongs to exactly one category.
export const WORKFLOW_CATEGORY: Record<WorkflowKey, CategoryKey> = {
  "refund-request-approved": "refund-request-decisions",
  "refund-request-declined": "refund-request-decisions",
  "open-refund-request": "open-refund-requests",
  "seat-claimed": "claimed-seats",
  "new-enrollment": "enrollments",
  "discussion-question": "discussion-questions",
  "discussion-reply": "discussion-replies",
};

// Whether each category is on for someone who has never changed it.
// Enrollments are off until an Instructor turns them on.
export const CATEGORY_DEFAULTS: Record<CategoryKey, boolean> = {
  "refund-request-decisions": true,
  "open-refund-requests": true,
  "claimed-seats": true,
  enrollments: false,
  "discussion-questions": true,
  "discussion-replies": true,
};
