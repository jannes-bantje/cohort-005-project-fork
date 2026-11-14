import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { feedUserToken, type UserTokens } from "./feed-user-token.server";
import type { NotificationUser, Person } from "~/lib/notification-gateway";
import { captureConsoleErrors } from "~/test/capture-console-errors";
import { recordingNotificationGateway } from "~/test/recording-notification-gateway";

const emma: Person = { id: 3, name: "Emma Wilson", email: "emma@example.com" };
const james: Person = { id: 4, name: "James Park", email: "james@example.com" };

// A throwaway RS256 keypair. KNOCK_SIGNING_KEY holds the private key as
// base64-encoded PEM, so the test hands it over the same way.
const keyPair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const signingKey = Buffer.from(keyPair.privateKey).toString("base64");

// 2026-11-14 12:00:00 UTC, and the same instant in seconds since the epoch.
const NOW = new Date("2026-11-14T12:00:00Z");
const NOW_SECONDS = 1794657600;

/** Checks the RS256 signature with the public key and returns what it signed. */
function verifiedToken(token: string) {
  const [header, payload, signature] = token.split(".");
  const signed = verify(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    keyPair.publicKey,
    Buffer.from(signature, "base64url")
  );
  if (!signed) throw new Error("The token's signature doesn't verify");
  return {
    header: JSON.parse(Buffer.from(header, "base64url").toString()),
    claims: JSON.parse(Buffer.from(payload, "base64url").toString()),
  };
}

describe("feedUserToken", () => {
  it("asks Knock to identify the user and signs an RS256 token for them", async () => {
    const gateway = recordingNotificationGateway();

    const { token } = feedUserToken(gateway, new Map(), {
      user: emma,
      signingKey,
      now: NOW,
    });

    expect(gateway.calls).toEqual([
      {
        method: "identifyUser",
        input: { id: "3", name: "Emma Wilson", email: "emma@example.com" },
      },
    ]);
    expect(verifiedToken(token)).toEqual({
      header: { alg: "RS256", typ: "JWT" },
      claims: { sub: "3", iat: NOW_SECONDS, exp: NOW_SECONDS + 60 * 60 },
    });
  });

  it("signs the token without waiting for Knock to identify the user", async () => {
    // Knock never answers the identification.
    const recorder = recordingNotificationGateway();
    const gateway = {
      ...recorder,
      identifyUser: (user: NotificationUser) => {
        void recorder.identifyUser(user);
        return new Promise<void>(() => {});
      },
    };

    const { token } = feedUserToken(gateway, new Map(), {
      user: emma,
      signingKey,
      now: NOW,
    });

    expect(recorder.calls).toEqual([
      {
        method: "identifyUser",
        input: { id: "3", name: "Emma Wilson", email: "emma@example.com" },
      },
    ]);
    expect(verifiedToken(token).claims).toEqual({
      sub: "3",
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 60 * 60,
    });
  });

  it("still signs the token when identifying the user fails, and logs it", async () => {
    const gateway = recordingNotificationGateway({ reject: true });

    let token = "";
    const errors = await captureConsoleErrors(async () => {
      ({ token } = feedUserToken(gateway, new Map(), {
        user: emma,
        signingKey,
        now: NOW,
      }));
      // The identification isn't awaited, so let its failure be logged.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(verifiedToken(token).claims).toEqual({
      sub: "3",
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 60 * 60,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0][0]).toBe("Could not identify user 3 to Knock");
  });

  it("reuses a user's token, identifying them once per token issued", async () => {
    const gateway = recordingNotificationGateway();
    const tokens: UserTokens = new Map();

    const first = feedUserToken(gateway, tokens, {
      user: emma,
      signingKey,
      now: NOW,
    });
    const later = feedUserToken(gateway, tokens, {
      user: emma,
      signingKey,
      now: new Date("2026-11-14T12:45:00Z"),
    });

    expect(later.token).toBe(first.token);
    expect(gateway.calls).toEqual([
      {
        method: "identifyUser",
        input: { id: "3", name: "Emma Wilson", email: "emma@example.com" },
      },
    ]);
  });

  it("gives each user their own token, like after switching users in DevUI", async () => {
    const gateway = recordingNotificationGateway();
    const tokens: UserTokens = new Map();

    feedUserToken(gateway, tokens, { user: emma, signingKey, now: NOW });
    const { token } = feedUserToken(gateway, tokens, {
      user: james,
      signingKey,
      now: NOW,
    });

    expect(verifiedToken(token).claims.sub).toBe("4");
    expect(gateway.calls).toEqual([
      {
        method: "identifyUser",
        input: { id: "3", name: "Emma Wilson", email: "emma@example.com" },
      },
      {
        method: "identifyUser",
        input: { id: "4", name: "James Park", email: "james@example.com" },
      },
    ]);
  });

  it("issues a new token when the old one is about to expire", async () => {
    const gateway = recordingNotificationGateway();
    const tokens: UserTokens = new Map();

    feedUserToken(gateway, tokens, { user: emma, signingKey, now: NOW });
    const { token } = feedUserToken(gateway, tokens, {
      user: emma,
      signingKey,
      now: new Date("2026-11-14T12:55:00Z"),
    });

    expect(verifiedToken(token).claims).toEqual({
      sub: "3",
      iat: NOW_SECONDS + 55 * 60,
      exp: NOW_SECONDS + 115 * 60,
    });
    expect(gateway.calls).toHaveLength(2);
  });
});
