/**
 * Sentinel Private-Beta Access Gate (web UI only)
 *
 * Minimal, fully self-contained "enter a shared code once" gate for the web
 * UI during private beta. Entirely disabled (a no-op) unless APP_ACCESS_CODE
 * is set - no code path changes, no new tables, no new auth model.
 *
 * Never applies to:
 *   - /api/* (all API requests - key-authenticated or not - are unaffected)
 *   - /health, /ready, /version (operational probes)
 *
 * The verification cookie is HMAC-signed using APP_ACCESS_CODE itself as the
 * key, so rotating the access code automatically invalidates every
 * previously-issued cookie with no extra bookkeeping.
 *
 * To remove this feature entirely: delete this file, the
 * `app.use(betaGateMiddleware)` line in server.ts, and the APP_ACCESS_CODE
 * environment variable.
 */

import crypto from "crypto";

const COOKIE_NAME = "sentinel_beta_access";
const COOKIE_VALUE = "granted";
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
const GATE_SUBMIT_PATH = "/__beta-access";
const MAX_BODY_BYTES = 10_000;

const BYPASS_PREFIXES = ["/api", "/health", "/ready", "/version"];

function sign(code: string): string {
  return crypto.createHmac("sha256", code).update(COOKIE_VALUE).digest("hex");
}

function isValidCookie(raw: string | undefined, code: string): boolean {
  if (!raw) return false;
  const dotIndex = raw.indexOf(".");
  if (dotIndex === -1) return false;
  const value = raw.slice(0, dotIndex);
  const signature = raw.slice(dotIndex + 1);
  if (value !== COOKIE_VALUE || !signature) return false;

  const expected = sign(code);
  const signatureBuf = Buffer.from(signature, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (signatureBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(signatureBuf, expectedBuf);
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
 * Reads and URL-decodes an application/x-www-form-urlencoded POST body
 * directly, so this feature doesn't depend on (or need to add) global
 * body-parser configuration beyond what server.ts already has.
 */
function readFormBody(req: any): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    let data = "";
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8");
      if (data.length > MAX_BODY_BYTES) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on("end", () => {
      if (tooLarge) return resolve({});
      const params = new URLSearchParams(data);
      const out: Record<string, string> = {};
      for (const [key, value] of params.entries()) out[key] = value;
      resolve(out);
    });
    req.on("error", reject);
  });
}

function renderGateHtml(error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Sentinel — Private Beta Access</title>
<style>
  body { background:#07070a; color:#e5e7eb; font-family: ui-sans-serif, system-ui, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
  .card { background:#0d0d12; border:1px solid #1f2937; border-radius:12px; padding:32px; width:100%; max-width:360px; }
  h1 { font-size:16px; margin:0 0 4px; }
  p { font-size:13px; color:#9ca3af; margin:0 0 20px; }
  input { width:100%; box-sizing:border-box; padding:10px 12px; border-radius:8px; border:1px solid #374151; background:#111117; color:#fff; font-size:14px; margin-bottom:12px; }
  button { width:100%; padding:10px 12px; border-radius:8px; border:none; background:#fff; color:#000; font-weight:600; font-size:13px; cursor:pointer; }
  .error { color:#f87171; font-size:12px; margin:-6px 0 12px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Sentinel — Private Beta</h1>
    <p>Enter your access code to continue.</p>
    <form method="POST" action="${GATE_SUBMIT_PATH}">
      ${error ? `<div class="error">${error}</div>` : ""}
      <input type="password" name="code" placeholder="Access code" autofocus required />
      <button type="submit">Continue</button>
    </form>
  </div>
</body>
</html>`;
}

/**
 * Express middleware. Gates every request except /api/*, /health, /ready,
 * and /version behind a one-time access code, when APP_ACCESS_CODE is set.
 */
export async function betaGateMiddleware(req: any, res: any, next: any): Promise<void> {
  const accessCode = process.env.APP_ACCESS_CODE;
  if (!accessCode) return next(); // Gate disabled entirely when unset.

  if (BYPASS_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + "/"))) {
    return next();
  }

  const cookies = parseCookies(req.headers.cookie);
  if (isValidCookie(cookies[COOKIE_NAME], accessCode)) {
    return next();
  }

  if (req.method === "POST" && req.path === GATE_SUBMIT_PATH) {
    const body = await readFormBody(req);
    const submitted = body.code || "";
    const submittedBuf = Buffer.from(submitted);
    const codeBuf = Buffer.from(accessCode);
    const matches = submittedBuf.length === codeBuf.length && crypto.timingSafeEqual(submittedBuf, codeBuf);

    if (matches) {
      const signedValue = `${COOKIE_VALUE}.${sign(accessCode)}`;
      const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
      res.setHeader(
        "Set-Cookie",
        `${COOKIE_NAME}=${encodeURIComponent(signedValue)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secureFlag}`
      );
      res.redirect(302, "/");
      return;
    }

    res.status(401).send(renderGateHtml("Incorrect access code."));
    return;
  }

  res.status(401).send(renderGateHtml());
}
