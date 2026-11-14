import { RefundStatus, type users } from "~/db/schema";
import type {
  NotificationGateway,
  NotificationPreferences,
} from "~/lib/notification-gateway";
import type { CategoryKey } from "~/lib/notification-keys";
import {
  NOTIFICATION_PREFERENCE_LABELS,
  visibleNotificationPreferences,
} from "~/lib/notification-preferences";
import { listTeamLicences, type Db } from "~/lib/refunds.server";

// ─── Notification Preferences (server) ───
// Reading and saving a person's Notification Preferences in Knock, through the
// NotificationGateway. Knock is the only place they live (docs/adr/0013).

type User = Pick<typeof users.$inferSelect, "id" | "name" | "email" | "role">;

export type NotificationPreferenceSwitch = {
  category: CategoryKey;
  label: string;
  enabled: boolean;
};

export type NotificationPreferencesCard =
  | { available: true; preferences: NotificationPreferenceSwitch[] }
  | { available: false };

/**
 * The switches a person sees, with their current values from Knock. The user
 * is identified first so Knock knows them, then the preferences are read with
 * Knock's environment defaults merged in. When Knock can't be reached the card
 * is unavailable: it shows no switches rather than guessed values.
 */
export async function loadNotificationPreferences(
  gateway: NotificationGateway,
  db: Db,
  user: User
): Promise<NotificationPreferencesCard> {
  const userId = String(user.id);
  let values: NotificationPreferences;
  try {
    await gateway.identifyUser({
      id: userId,
      name: user.name,
      email: user.email,
    });
    values = await gateway.getPreferences(userId);
  } catch (error) {
    console.error(
      `Notification Preferences for user ${userId} could not be read`,
      error
    );
    return { available: false };
  }
  const visible = visibleNotificationPreferences({
    role: user.role,
    ownsTeamLicence: ownsLiveTeamLicence(db, user.id),
  });
  return {
    available: true,
    preferences: visible.map((category) => ({
      category,
      label: NOTIFICATION_PREFERENCE_LABELS[category],
      enabled: values[category],
    })),
  };
}

/**
 * Turns one Notification Preference on or off in Knock. The user id always
 * comes from the session; the browser never writes preferences. A failure is
 * returned, not thrown, so the switch can go back to its previous value.
 */
export async function saveNotificationPreference(
  gateway: NotificationGateway,
  preference: { userId: number; category: CategoryKey; enabled: boolean }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = String(preference.userId);
  try {
    await gateway.setPreference({
      userId,
      category: preference.category,
      enabled: preference.enabled,
    });
  } catch (error) {
    console.error(
      `Notification Preference ${preference.category} for user ${userId} could not be saved`,
      error
    );
    return {
      ok: false,
      error: "Your Notification Preference didn't save. Try again.",
    };
  }
  return { ok: true };
}

// A Team Licence with an Approved Refund Request has no Seats left to claim,
// so only Team Licences without one count. Once approved, a Purchase can't get
// another Refund Request, so the latest one says whether it was refunded.
function ownsLiveTeamLicence(db: Db, userId: number): boolean {
  return listTeamLicences(db, userId, new Date()).some(
    (teamLicence) =>
      teamLicence.latestRefundRequest?.status !== RefundStatus.Approved
  );
}
