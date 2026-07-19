/**
 * Sentinel Session Subsystem
 *
 * Replaces the previous module-level `currentUser` singleton (shared by every
 * browser client) with real per-client sessions: a random session ID is
 * generated on login, stored server-side, and handed to the client as a
 * signed, HttpOnly, SameSite=Lax cookie. Each request resolves its own user
 * from that cookie instead of a single shared variable.
 *
 * Intentionally out of scope: passwords, OAuth, email verification. Login
 * remains a self-asserted identity (as it already was), but is no longer
 * global/shared across clients.
 */

import crypto from "crypto";

const COOKIE_NAME = "sid";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Signing secret for the session cookie. Prefer an operator-supplied
// SESSION_SECRET; fall back to a secret generated fresh at process start so
// signing still works out of the box (sessions are in-memory anyway and do
// not need to survive a restart).
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

interface SessionRecord {
  user: any;
  createdAt: number;
}

const sessionStore = new Map<string, SessionRecord>();

function sign(value: string): string {
  const digest = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
  return `${value}.${digest}`;
}

/**
 * Verifies a signed cookie value and returns the embedded session ID, or
 * null if the signature is missing/invalid/tampered with.
 */
function verify(signedValue: string): string | null {
  const separatorIndex = signedValue.lastIndexOf(".");
  if (separatorIndex === -1) return null;

  const value = signedValue.slice(0, separatorIndex);
  const signature = signedValue.slice(separatorIndex + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");

  const signatureBuf = Buffer.from(signature, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (signatureBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(signatureBuf, expectedBuf)) return null;

  return value;
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  cookieHeader.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const rawVal = part.slice(idx + 1).trim();
    if (!key) return;
    try {
      out[key] = decodeURIComponent(rawVal);
    } catch {
      out[key] = rawVal;
    }
  });
  return out;
}

/**
 * Creates a new server-side session for the given user and returns its ID.
 */
export function createSession(user: any): string {
  const sessionId = crypto.randomBytes(24).toString("hex");
  sessionStore.set(sessionId, { user, createdAt: Date.now() });
  return sessionId;
}

/**
 * Destroys exactly one session (used by logout - never affects other
 * clients' sessions).
 */
export function destroySession(sessionId: string): void {
  sessionStore.delete(sessionId);
}

/**
 * Looks up a session by ID, transparently expiring (and evicting) it if
 * older than SESSION_TTL_MS.
 */
export function getSession(sessionId: string): SessionRecord | undefined {
  const record = sessionStore.get(sessionId);
  if (!record) return undefined;
  if (Date.now() - record.createdAt > SESSION_TTL_MS) {
    sessionStore.delete(sessionId);
    return undefined;
  }
  return record;
}

export function setSessionCookie(res: any, sessionId: string): void {
  const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(sign(sessionId))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secureFlag}`
  );
}

export function clearSessionCookie(res: any): void {
  const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag}`);
}

/**
 * Express middleware: resolves `req.sessionId` / `req.session` from the
 * signed session cookie, if present and valid. Never rejects the request -
 * callers decide what to do with an absent session.
 */
export function sessionMiddleware(req: any, res: any, next: any): void {
  req.sessionId = null;
  req.session = null;

  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
  if (raw) {
    const sessionId = verify(raw);
    if (sessionId) {
      const record = getSession(sessionId);
      if (record) {
        req.sessionId = sessionId;
        req.session = record;
      }
    }
  }

  next();
}
