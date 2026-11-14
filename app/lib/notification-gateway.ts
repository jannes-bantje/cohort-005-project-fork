import {
  CATEGORY_DEFAULTS,
  type CategoryKey,
  type WorkflowKey,
} from "~/lib/notification-keys";

// ─── NotificationGateway ───
// The one seam between Cadence and Knock: one method per server-side Knock
// call. The Knock-backed gateway lives in knock.server.ts; tests use the
// recording fake in app/test. Anything that sends Notifications takes the
// gateway as a required parameter and never imports knock.server.ts.
//
// Ids are Knock user ids: the Cadence user id as a string.

/** Someone in Cadence who can get or cause a Notification. */
export type Person = {
  id: number;
  name: string;
  email: string;
};

/** A Person as Knock knows them. */
export type NotificationUser = {
  id: string;
  name: string;
  email: string;
};

/** The Knock user id for a Cadence user id: the same number as a string. */
export function knockUserId(id: number): string {
  return String(id);
}

export function knockUser(person: Person): NotificationUser {
  return { id: knockUserId(person.id), name: person.name, email: person.email };
}

export type TriggerInput = {
  workflow: WorkflowKey;
  recipients: NotificationUser[];
  actor: NotificationUser;
  data: Record<string, unknown>;
  idempotencyKey: string;
};

export type ArchiveFeedMessagesInput = {
  workflow: WorkflowKey;
  triggerData: Record<string, unknown>;
};

export type SetPreferenceInput = {
  userId: string;
  category: CategoryKey;
  enabled: boolean;
};

// Whether each category reaches the user's Notification Feed, with Knock's
// environment defaults merged in.
export type NotificationPreferences = Record<CategoryKey, boolean>;

export interface NotificationGateway {
  trigger(input: TriggerInput): Promise<void>;
  archiveFeedMessages(input: ArchiveFeedMessagesInput): Promise<void>;
  identifyUser(user: NotificationUser): Promise<void>;
  getPreferences(userId: string): Promise<NotificationPreferences>;
  setPreference(input: SetPreferenceInput): Promise<void>;
}

// Used when Knock isn't configured: every call does nothing.
export const disabledNotificationGateway: NotificationGateway = {
  async trigger() {},
  async archiveFeedMessages() {},
  async identifyUser() {},
  async getPreferences() {
    return { ...CATEGORY_DEFAULTS };
  },
  async setPreference() {},
};
