import { Knock } from "@knocklabs/node";
import { loadEnvFile } from "~/lib/env.server";
import {
  disabledNotificationGateway,
  type NotificationGateway,
  type NotificationPreferences,
} from "~/lib/notification-gateway";
import { CATEGORY_DEFAULTS, CATEGORY_KEYS } from "~/lib/notification-keys";
import { feedUserToken, type UserTokens } from "~/lib/notifications.server";

// ─── Knock ───
// The Knock-backed NotificationGateway. When any of the four runtime keys is
// missing, Notifications are off: the factory returns the disabled gateway and
// one warning is printed at startup, like the mailer's .outbox fallback.
//
// Only route modules import this file. The Notifications module takes the
// gateway as a parameter instead, so tests never reach Knock. It also prepares
// the bell's feed auth, because that needs the keys.

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

// Read once. `null` means Notifications are off.
let config: KnockConfig | null | undefined;
let gateway: NotificationGateway | undefined;

// Read when the server loads this module, so missing keys are reported once at
// startup rather than on the first request. Never under vitest: tests have no
// keys and must not print the warning.
if (!process.env.VITEST) knockConfig();

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

/** What the bell needs to read one user's Notification Feed from the browser. */
export type NotificationFeedAuth = {
  /** The Knock user id: the Cadence user id as a string. */
  userId: string;
  /** An RS256 user token Cadence signed for this user. */
  token: string;
  publicApiKey: string;
  feedChannelId: string;
};

// Feed user tokens issued by this server process, by user id. Reused until
// they're about to expire, so a user is identified once per token.
const userTokens: UserTokens = new Map();

/**
 * Feed auth for the user in the session, or null when Notifications are off
 * or nobody is signed in, which hides the bell. A failure to sign is logged
 * and also hides the bell, so the page still renders.
 */
export function notificationFeedAuth(
  user: { id: number; name: string; email: string } | null
): NotificationFeedAuth | null {
  const knock = knockConfig();
  if (!knock || !user) return null;

  try {
    const { token } = feedUserToken(notificationGateway(), userTokens, {
      user,
      signingKey: knock.signingKey,
      now: new Date(),
    });
    return {
      userId: String(user.id),
      token,
      publicApiKey: knock.publicApiKey,
      feedChannelId: knock.feedChannelId,
    };
  } catch (error) {
    console.error(
      `Could not sign a feed user token for user ${user.id}`,
      error
    );
    return null;
  }
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
    const preference = preferenceSet.categories?.[category];
    if (preference === undefined || preference === null) continue;
    if (typeof preference === "boolean") {
      preferences[category] = preference;
      continue;
    }
    const inAppFeed = preference.channel_types?.in_app_feed;
    if (inAppFeed !== undefined && inAppFeed !== null) {
      preferences[category] = inAppFeed !== false;
    }
  }
  return preferences;
}
