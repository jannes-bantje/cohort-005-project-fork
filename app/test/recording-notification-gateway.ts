import type {
  ArchiveFeedMessagesInput,
  NotificationGateway,
  NotificationUser,
  SetPreferenceInput,
  TriggerInput,
} from "~/lib/notification-gateway";
import { CATEGORY_DEFAULTS } from "~/lib/notification-keys";

export type RecordedGatewayCall =
  | { method: "trigger"; input: TriggerInput }
  | { method: "archiveFeedMessages"; input: ArchiveFeedMessagesInput }
  | { method: "identifyUser"; input: NotificationUser }
  | { method: "getPreferences"; input: string }
  | { method: "setPreference"; input: SetPreferenceInput };

export type RecordingNotificationGateway = NotificationGateway & {
  calls: RecordedGatewayCall[];
};

/**
 * A NotificationGateway that talks to nobody. Each call is recorded the moment
 * it is made, before its promise settles, so calls a route doesn't await can
 * still be asserted. With `reject: true` every call rejects, like a Knock
 * outage.
 */
export function recordingNotificationGateway(
  options: { reject?: boolean } = {}
): RecordingNotificationGateway {
  const calls: RecordedGatewayCall[] = [];

  async function settle<T>(call: RecordedGatewayCall, value: T): Promise<T> {
    calls.push(call);
    if (options.reject) {
      throw new Error(`Knock is unavailable (${call.method})`);
    }
    return value;
  }

  return {
    calls,
    trigger: (input) => settle({ method: "trigger", input }, undefined),
    archiveFeedMessages: (input) =>
      settle({ method: "archiveFeedMessages", input }, undefined),
    identifyUser: (input) =>
      settle({ method: "identifyUser", input }, undefined),
    getPreferences: (input) =>
      settle({ method: "getPreferences", input }, { ...CATEGORY_DEFAULTS }),
    setPreference: (input) =>
      settle({ method: "setPreference", input }, undefined),
  };
}
