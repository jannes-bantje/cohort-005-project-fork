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

export type NotificationUser = {
  id: string;
  name: string;
  email: string;
};

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
