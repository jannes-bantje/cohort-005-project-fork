import { Knock } from "@knocklabs/node";
import { loadEnvFile } from "~/lib/env.server";
import {
  disabledNotificationGateway,
  type NotificationGateway,
  type NotificationPreferences,
} from "~/lib/notification-gateway";
import { CATEGORY_DEFAULTS, CATEGORY_KEYS } from "~/lib/notification-keys";

// ─── Knock ───
// The Knock-backed NotificationGateway. When any of the four runtime keys is
// missing, Notifications are off: the factory returns the disabled gateway and
// one warning is printed, like the mailer's .outbox fallback.
//
// Only route modules import this file. The Notifications module takes the
// gateway as a parameter instead, so tests never reach Knock.

const RUNTIME_KEYS = [
  "KNOCK_PUBLIC_API_KEY",
  "KNOCK_API_KEY",
  "KNOCK_SIGNING_KEY",
  "KNOCK_FEED_CHANNEL_ID",
] as const;

type KnockConfig = {
  publicApiKey: string;
  apiKey: string;
  signingKey: string;
  feedChannelId: string;
};

// Read once, on first use. `null` means Notifications are off.
let config: KnockConfig | null | undefined;
let gateway: NotificationGateway | undefined;

function knockConfig(): KnockConfig | null {
  if (config !== undefined) return config;
  loadEnvFile();
  const {
    KNOCK_PUBLIC_API_KEY,
    KNOCK_API_KEY,
    KNOCK_SIGNING_KEY,
    KNOCK_FEED_CHANNEL_ID,
  } = process.env;
  if (
    KNOCK_PUBLIC_API_KEY &&
    KNOCK_API_KEY &&
    KNOCK_SIGNING_KEY &&
    KNOCK_FEED_CHANNEL_ID
  ) {
    config = {
      publicApiKey: KNOCK_PUBLIC_API_KEY,
      apiKey: KNOCK_API_KEY,
      signingKey: KNOCK_SIGNING_KEY,
      feedChannelId: KNOCK_FEED_CHANNEL_ID,
    };
  } else {
    const missing = RUNTIME_KEYS.filter((key) => !process.env[key]);
    console.warn(
      `Notifications are off. Missing Knock keys: ${missing.join(", ")}. Run scripts/setup-knock.sh to add them to .env.`
    );
    config = null;
  }
  return config;
}

/** Whether Knock is configured, so the bell and the Notifications card can show. */
export function notificationsEnabled(): boolean {
  return knockConfig() !== null;
}

/** The Knock-backed gateway, or the disabled gateway when keys are missing. */
export function notificationGateway(): NotificationGateway {
  if (gateway) return gateway;
  const knock = knockConfig();
  gateway = knock ? knockGateway(knock) : disabledNotificationGateway;
  return gateway;
}

function knockGateway({
  apiKey,
  feedChannelId,
}: KnockConfig): NotificationGateway {
  // maxRetries is the SDK default; the per-attempt timeout is cut from 60s.
  // We add no retries of our own.
  const knock = new Knock({ apiKey, maxRetries: 2, timeout: 10_000 });

  return {
    async trigger({ workflow, recipients, actor, data, idempotencyKey }) {
      await knock.workflows.trigger(
        workflow,
        { recipients, actor, data },
        { idempotencyKey }
      );
    },

    async archiveFeedMessages({ workflow, triggerData }) {
      await knock.channels.bulk.updateMessageStatus(feedChannelId, "archive", {
        workflows: [workflow],
        trigger_data: JSON.stringify(triggerData),
      });
    },

    async identifyUser({ id, name, email }) {
      await knock.users.update(id, { name, email });
    },

    async getPreferences(userId) {
      const preferenceSet = await knock.users.getPreferences(userId, "default");
      return inAppFeedPreferences(preferenceSet);
    },

    async setPreference({ userId, category, enabled }) {
      await knock.users.setPreferences(userId, "default", {
        __persistence_strategy__: "merge",
        categories: {
          [category]: { channel_types: { in_app_feed: enabled } },
        },
      });
    },
  };
}

type PreferenceSet = Awaited<ReturnType<Knock["users"]["getPreferences"]>>;

// A category reaches the in-app feed unless Knock turns it off, either as a
// whole or for its in_app_feed channel type. A conditions object counts as on.
function inAppFeedPreferences(
  preferenceSet: PreferenceSet
): NotificationPreferences {
  const preferences = { ...CATEGORY_DEFAULTS };
  for (const category of CATEGORY_KEYS) {
    const setting = preferenceSet.categories?.[category];
    if (setting === undefined || setting === null) continue;
    if (typeof setting === "boolean") {
      preferences[category] = setting;
      continue;
    }
    const inAppFeed = setting.channel_types?.in_app_feed;
    if (inAppFeed !== undefined && inAppFeed !== null) {
      preferences[category] = inAppFeed !== false;
    }
  }
  return preferences;
}
