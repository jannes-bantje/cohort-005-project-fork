import { sign } from "node:crypto";
import {
  knockUser,
  knockUserId,
  type NotificationGateway,
  type Person,
} from "~/lib/notification-gateway";

// ─── Feed user token ───
// Knock's enhanced security mode only lets the browser read a Notification
// Feed with a token Cadence signed for that user. Signing is local crypto, not
// a gateway call.

/** How long a feed user token lasts. */
const USER_TOKEN_LIFETIME_SECONDS = 60 * 60;

/**
 * A token is reused until fewer than this many seconds remain, so the browser
 * never gets one that is about to expire.
 */
const USER_TOKEN_RENEW_BEFORE_SECONDS = 10 * 60;

export type UserToken = {
  token: string;
  /** Seconds since the epoch, like the token's `exp` claim. */
  expiresAt: number;
};

/** Feed user tokens already issued, by Cadence user id. */
export type UserTokens = Map<number, UserToken>;

/**
 * The user's feed token. Reuses the one already issued until it is about to
 * expire; otherwise asks Knock to identify the user (name and email) and signs
 * a new one, so there is one identification per token issued, not per request.
 * Keyed by user, so switching users in DevUI gets that user's token.
 *
 * The token never waits on Knock: identifying is started, not awaited, and the
 * token is signed straight away. If identifying fails, the error is logged.
 */
export function feedUserToken(
  gateway: NotificationGateway,
  tokens: UserTokens,
  { user, signingKey, now }: { user: Person; signingKey: string; now: Date }
): UserToken {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const issued = tokens.get(user.id);
  if (
    issued &&
    issued.expiresAt - nowSeconds > USER_TOKEN_RENEW_BEFORE_SECONDS
  ) {
    return issued;
  }

  gateway.identifyUser(knockUser(user)).catch((error: unknown) => {
    console.error(`Could not identify user ${user.id} to Knock`, error);
  });

  const userToken = signUserToken(user.id, signingKey, nowSeconds);
  tokens.set(user.id, userToken);
  return userToken;
}

/**
 * Signs an RS256 JWT whose `sub` is the Knock user id, the shape Knock
 * expects. `signingKey` is the PKCS#8 private key as PEM, or as base64-encoded
 * PEM (how KNOCK_SIGNING_KEY holds it).
 */
function signUserToken(
  userId: number,
  signingKey: string,
  nowSeconds: number
): UserToken {
  const expiresAt = nowSeconds + USER_TOKEN_LIFETIME_SECONDS;
  const header = base64url({ alg: "RS256", typ: "JWT" });
  const claims = base64url({
    sub: knockUserId(userId),
    iat: nowSeconds,
    exp: expiresAt,
  });
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${claims}`),
    privateKeyPem(signingKey)
  ).toString("base64url");
  return { token: `${header}.${claims}.${signature}`, expiresAt };
}

function base64url(json: object) {
  return Buffer.from(JSON.stringify(json)).toString("base64url");
}

function privateKeyPem(signingKey: string) {
  if (signingKey.includes("-----BEGIN")) return signingKey;
  return Buffer.from(signingKey, "base64").toString("utf8");
}
