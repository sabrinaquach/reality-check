/**
 * Signing in: cookies, sign-in links, and Google.
 *
 * Kept beside server.ts rather than inside it because the scoring routes are
 * one shape -- take a query, call a source, send JSON -- and these are another:
 * they set headers, they redirect, and they are the only routes that decide
 * who is asking.
 */
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
  avatarStamp,
  consumeLoginToken,
  createLoginToken,
  createSession,
  createUser,
  linkGoogle,
  normalizeEmail,
  purgeExpiredSessions,
  purgeExpiredTokens,
  userByEmail,
  userByGoogleSub,
  userBySession,
  type User,
} from "./store.ts";

const SESSION_COOKIE = "rc_session";
const OAUTH_COOKIE = "rc_oauth";
const SESSION_DAYS = 30;

/**
 * Where the browser is, which is not where this server is: in dev the page is
 * on Vite's 5173 and reaches /api through its proxy, so the cookie and the
 * OAuth redirect both belong to that origin. Override for a deployment.
 */
const ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:5173";
const REDIRECT_URI = `${ORIGIN}/api/auth/google/callback`;

/* ---------- cookies ---------- */

function readCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * HttpOnly so a script cannot read the session even if something manages to
 * inject one; Lax so following a link into the app keeps you signed in while
 * a cross-site form post does not carry the cookie. Secure only over HTTPS --
 * setting it in dev would mean the cookie is silently dropped on localhost.
 */
function cookie(name: string, value: string, maxAgeSeconds: number): string {
  const secure = ORIGIN.startsWith("https://") ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export const sessionCookie = (id: string) => cookie(SESSION_COOKIE, id, SESSION_DAYS * 24 * 60 * 60);
export const clearedSessionCookie = () => cookie(SESSION_COOKIE, "", 0);

export const sessionIdOf = (req: IncomingMessage) => readCookies(req)[SESSION_COOKIE] ?? null;

/** Who is asking, or null. Every route that touches a person's data uses this. */
export const currentUser = (req: IncomingMessage): User | null => userBySession(sessionIdOf(req));

/* ---------- sign-in links ---------- */

/**
 * Enough of a check to catch a typo, not enough to argue with a real address.
 * The rest of the validation is the delivery: a link to an address that does
 * not exist simply never arrives.
 */
const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export type AuthResult =
  | { ok: true; user: User; sessionId: string }
  | { ok: false; status: number; error: string };

function signedIn(user: User): AuthResult {
  purgeExpiredSessions();
  return { ok: true, user, sessionId: createSession(user.id) };
}

/**
 * Send someone a link that signs them in.
 *
 * No account is created here -- only when a link is actually followed. An
 * address that does not own its inbox never gets past this point, which is the
 * whole reason there is no password to store: proving you can read the mail at
 * an address is the same proof a password reset would have fallen back to
 * anyway.
 */
export async function requestLink(email: unknown): Promise<{ ok: boolean; status: number; error?: string }> {
  // Normalise before validating: a pasted address often arrives with a space
  // on the end, and " a@b.co " is a valid address typed by a real person.
  const address = typeof email === "string" ? normalizeEmail(email) : "";
  if (!looksLikeEmail(address)) return { ok: false, status: 400, error: "Enter a valid email address." };

  purgeExpiredTokens();
  const token = createLoginToken(address);
  await sendLink(address, `${ORIGIN}/api/auth/callback?token=${encodeURIComponent(token)}`);
  return { ok: true, status: 200 };
}

/** Follow a link. The address is proven by the fact that the link arrived. */
export function signInWithToken(token: string | null): AuthResult {
  const email = token && consumeLoginToken(token);
  if (!email) {
    return { ok: false, status: 400, error: "That link has expired or been used. Ask for a new one." };
  }
  /**
   * The first time someone follows a link is the moment their account exists.
   * An address that already signed in through Google lands on the same row.
   */
  return signedIn(userByEmail(email) ?? createUser({ email }));
}

/* ---------- delivering it ---------- */

const RESEND_KEY = process.env.RESEND_API_KEY ?? "";
const MAIL_FROM = process.env.MAIL_FROM ?? "Reality Check <onboarding@resend.dev>";

/**
 * With no mail provider configured the link goes to this server's console.
 *
 * That is the honest development default: the alternative is a Continue button
 * that reports success and sends nothing, which looks like a delivery problem
 * and is not. Set RESEND_API_KEY and it goes to the inbox instead.
 */
async function sendLink(email: string, url: string) {
  if (!RESEND_KEY) {
    console.log(`\n  Sign-in link for ${email}:\n  ${url}\n`);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: email,
        subject: "Your Reality Check sign-in link",
        text: `Sign in to Reality Check:\n\n${url}\n\nThe link works once and expires in 15 minutes. If you didn't ask for it, you can ignore this.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error("sending the sign-in link failed:", res.status, await res.text());
  } catch (e) {
    /**
     * Swallowed on purpose. The route answers "check your email" either way --
     * saying "we could not send to that address" would confirm to a stranger
     * which addresses have accounts.
     */
    console.error("sending the sign-in link failed:", e);
  }
}

/* ---------- Google ---------- */

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";

export const googleConfigured = () => !!CLIENT_ID && !!CLIENT_SECRET;

/**
 * The authorization-code flow, not the one-tap script: the sign-in button is
 * the design's own (Figma 2120:4169), and a redirect keeps it that way instead
 * of handing the corner of the modal to a Google-rendered iframe. It also
 * keeps the client secret and the token exchange on this side.
 *
 * `state` is a nonce echoed back by Google and compared against a cookie, so a
 * callback that did not start here is refused.
 */
export function googleStart(): { url: string; cookie: string } {
  const state = randomBytes(16).toString("base64url");
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid email",
    state,
    // Ask every time rather than silently reusing whichever account is signed
    // into the browser -- people share machines.
    prompt: "select_account",
  });
  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    cookie: cookie(OAUTH_COOKIE, state, 10 * 60),
  };
}

type GoogleClaims = { sub: string; email: string; email_verified?: boolean | string };

/**
 * The id_token comes back over TLS from Google's own token endpoint in
 * exchange for a secret only this server holds, so its payload is read
 * directly. (The signature would have to be checked if the token arrived from
 * the browser instead, as it does in the one-tap flow.)
 */
function claimsOf(idToken: string): GoogleClaims | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as GoogleClaims;
  } catch {
    return null;
  }
}

export async function googleCallback(
  req: IncomingMessage,
  code: string | null,
  state: string | null,
): Promise<AuthResult> {
  const expected = readCookies(req)[OAUTH_COOKIE];
  if (!code || !state || !expected || state !== expected) {
    return { ok: false, status: 400, error: "That sign-in didn't start here. Try again." };
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.error("google token exchange failed:", res.status, await res.text());
    return { ok: false, status: 502, error: "Google wouldn't confirm that sign-in." };
  }

  const claims = claimsOf(((await res.json()) as { id_token?: string }).id_token ?? "");
  if (!claims?.sub || !claims.email) {
    return { ok: false, status: 502, error: "Google didn't return an email address." };
  }
  /**
   * An unverified address is one Google has not confirmed the person owns, so
   * matching it to an existing account would hand that account over.
   */
  if (claims.email_verified === false || claims.email_verified === "false") {
    return { ok: false, status: 403, error: "Verify your email with Google first." };
  }

  const bySub = userByGoogleSub(claims.sub);
  if (bySub) return signedIn(bySub);

  /**
   * Same address, arrived a different way: link it rather than making a second
   * account. Safe because Google has verified the address and this server, not
   * the browser, got that answer.
   */
  const byEmail = userByEmail(claims.email);
  if (byEmail) {
    linkGoogle(byEmail.id, claims.sub);
    return signedIn(byEmail);
  }

  return signedIn(createUser({ email: normalizeEmail(claims.email), googleSub: claims.sub }));
}

export const publicUser = (user: User) => ({
  email: user.email,
  google: !!user.google_sub,
  /** When their picture last changed, so the client can cache-bust its URL. */
  avatar: avatarStamp(user.id),
});
