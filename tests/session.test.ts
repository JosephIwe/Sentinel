import { describe, it, expect } from "vitest";
import { createSession, getSession, destroySession, setSessionCookie, clearSessionCookie, sessionMiddleware } from "../utils/session";

function makeRes() {
  const headers: Record<string, string> = {};
  return {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    _headers: headers,
  };
}

function makeReq(cookieHeader?: string) {
  return { headers: { cookie: cookieHeader } } as any;
}

describe("session store", () => {
  it("creates and retrieves a session by id", () => {
    const user = { id: "usr_1", email: "a@example.com" };
    const sessionId = createSession(user);
    const record = getSession(sessionId);
    expect(record?.user).toEqual(user);
  });

  it("destroySession removes exactly one session, leaving others intact", () => {
    const sessionA = createSession({ id: "usr_a" });
    const sessionB = createSession({ id: "usr_b" });

    destroySession(sessionA);

    expect(getSession(sessionA)).toBeUndefined();
    expect(getSession(sessionB)?.user).toEqual({ id: "usr_b" });
  });

  it("getSession returns undefined for an unknown id", () => {
    expect(getSession("does-not-exist")).toBeUndefined();
  });
});

describe("sessionMiddleware + signed cookies", () => {
  it("resolves req.session from a cookie set by setSessionCookie", () => {
    const sessionId = createSession({ id: "usr_cookie_test" });
    const res = makeRes();
    setSessionCookie(res, sessionId);

    const setCookieHeader = res._headers["Set-Cookie"];
    expect(setCookieHeader).toContain("HttpOnly");
    expect(setCookieHeader).toContain("SameSite=Lax");

    const cookiePair = setCookieHeader.split(";")[0]; // "sid=<value>"
    const req = makeReq(cookiePair);
    let nextCalled = false;
    sessionMiddleware(req, {}, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.session?.user).toEqual({ id: "usr_cookie_test" });
    expect(req.sessionId).toBe(sessionId);
  });

  it("does not resolve a session when no cookie is present", () => {
    const req = makeReq(undefined);
    sessionMiddleware(req, {}, () => {});
    expect(req.session).toBeNull();
    expect(req.sessionId).toBeNull();
  });

  it("rejects a tampered cookie value (invalid signature)", () => {
    const sessionId = createSession({ id: "usr_tamper_test" });
    const res = makeRes();
    setSessionCookie(res, sessionId);

    const cookiePair: string = res._headers["Set-Cookie"].split(";")[0];
    const [name, value] = cookiePair.split("=");
    // Flip a character in the signed value to simulate tampering.
    const tampered = value.slice(0, -1) + (value.endsWith("a") ? "b" : "a");
    const req = makeReq(`${name}=${tampered}`);

    sessionMiddleware(req, {}, () => {});
    expect(req.session).toBeNull();
  });

  it("rejects a well-formed but unknown session id", () => {
    const req = makeReq("sid=not-a-real-session-id.deadbeef");
    sessionMiddleware(req, {}, () => {});
    expect(req.session).toBeNull();
  });

  it("clearSessionCookie expires the cookie immediately", () => {
    const res = makeRes();
    clearSessionCookie(res);
    expect(res._headers["Set-Cookie"]).toContain("Max-Age=0");
  });
});
