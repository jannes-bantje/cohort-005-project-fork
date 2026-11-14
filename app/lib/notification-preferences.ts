import { UserRole } from "~/db/schema";
import type { CategoryKey } from "~/lib/notification-keys";

// ─── Notification Preferences ───
// Which Notification Preferences a person sees on the Notifications card. A
// person only sees the switches whose Notifications can reach them.

/** Facts from Cadence's database that decide which switches a person sees. */
export type NotificationPreferenceFacts = {
  role: UserRole;
  ownsTeamLicence: boolean;
};

export function visibleNotificationPreferences(
  facts: NotificationPreferenceFacts
): CategoryKey[] {
  const visible: CategoryKey[] = [
    "refund-request-decisions",
    "discussion-replies",
  ];
  if (facts.ownsTeamLicence) visible.push("claimed-seats");
  if (facts.role === UserRole.Instructor) {
    visible.push("enrollments", "discussion-questions");
  }
  if (facts.role === UserRole.Admin) visible.push("open-refund-requests");
  return visible;
}

/** How each Notification Preference is named on the Notifications card. */
export const NOTIFICATION_PREFERENCE_LABELS: Record<CategoryKey, string> = {
  "refund-request-decisions": "Refund Request decisions",
  "open-refund-requests": "Open Refund Requests",
  "claimed-seats": "Claimed Seats",
  enrollments: "Enrollments",
  "discussion-questions": "Discussion Questions",
  "discussion-replies": "Discussion Replies",
};
