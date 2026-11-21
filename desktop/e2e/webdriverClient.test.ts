import { describe, expect, it, vi } from "vitest";
import { WebDriverClient, WebDriverError, ELEMENT_KEY } from "./webdriverClient.mjs";

const BASE = "http://127.0.0.1:4444";

interface Reply {
  status: number;
  body: unknown;
}

/**
 * Fake transport: records every request and answers from a scripted queue, so
 * the client's request shape and error mapping can be asserted without a
 * driver (or a browser) anywhere near the test.
 */
function fakeDriver(replies: Reply[] = []) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const queue = [...replies];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      method: init.method ?? "GET",
      url,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const reply = queue.shift();
    if (!reply) throw new Error(`unexpected WebDriver request: ${init.method} ${url}`);
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
    };
  });
  return { calls, fetchImpl };
}

function clientFor(fetchImpl: ReturnType<typeof fakeDriver>["fetchImpl"]) {
  return new WebDriverClient({
    baseUrl: BASE,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

describe("WebDriverClient", () => {
  it("creates a session and keeps its id", async () => {
    const { calls, fetchImpl } = fakeDriver([
      { status: 200, body: { value: { sessionId: "abc123", capabilities: {} } } },
    ]);
    const client = clientFor(fetchImpl);
    const sessionId = await client.createSession({
      alwaysMatch: { "tauri:options": { application: "/bin/gridline" } },
    });
    expect(sessionId).toBe("abc123");
    expect(client.sessionId).toBe("abc123");
    expect(calls[0]).toEqual({
      method: "POST",
      url: `${BASE}/session`,
      body: {
        capabilities: {
          alwaysMatch: { "tauri:options": { application: "/bin/gridline" } },
        },
      },
    });
  });

  it("fails loudly when the driver returns no session id", async () => {
    const { fetchImpl } = fakeDriver([{ status: 200, body: { value: {} } }]);
    const client = clientFor(fetchImpl);
    await expect(client.createSession({ alwaysMatch: {} })).rejects.toThrow(/sessionId/);
  });

  it("finds an element by CSS selector and unwraps the W3C element key", async () => {
    const { calls, fetchImpl } = fakeDriver([
      { status: 200, body: { value: { [ELEMENT_KEY]: "element-1" } } },
    ]);
    const client = clientFor(fetchImpl);
    client.sessionId = "s1";
    const element = await client.findElement('[role="grid"]');
    expect(element).toEqual({ elementId: "element-1" });
    expect(calls[0].url).toBe(`${BASE}/session/s1/element`);
    expect(calls[0].body).toEqual({ using: "css selector", value: '[role="grid"]' });
  });

  it("returns null when the element does not exist yet", async () => {
    const { fetchImpl } = fakeDriver([
      { status: 404, body: { value: { error: "no such element", message: "no element found" } } },
    ]);
    const client = clientFor(fetchImpl);
    client.sessionId = "s1";
    await expect(client.findElement("#missing")).resolves.toBeNull();
  });

  it("reads element text and clicks through the element id", async () => {
    const { calls, fetchImpl } = fakeDriver([
      { status: 200, body: { value: "GL-MSE-001" } },
      { status: 200, body: { value: null } },
    ]);
    const client = clientFor(fetchImpl);
    client.sessionId = "s1";
    await expect(client.elementText({ elementId: "e9" })).resolves.toBe("GL-MSE-001");
    await client.click({ elementId: "e9" });
    expect(calls[0].url).toBe(`${BASE}/session/s1/element/e9/text`);
    expect(calls[1].method).toBe("POST");
    expect(calls[1].url).toBe(`${BASE}/session/s1/element/e9/click`);
    expect(calls[1].body).toEqual({});
  });

  it("captures a screenshot and the page source", async () => {
    const { calls, fetchImpl } = fakeDriver([
      { status: 200, body: { value: "iVBORw0KGgo=" } },
      { status: 200, body: { value: "<html></html>" } },
    ]);
    const client = clientFor(fetchImpl);
    client.sessionId = "s1";
    await expect(client.screenshot()).resolves.toBe("iVBORw0KGgo=");
    await expect(client.pageSource()).resolves.toBe("<html></html>");
    expect(calls[0].url).toBe(`${BASE}/session/s1/screenshot`);
    expect(calls[1].url).toBe(`${BASE}/session/s1/source`);
  });

  it("surfaces a W3C command error with its error code and message", async () => {
    const { fetchImpl } = fakeDriver([
      {
        status: 500,
        body: { value: { error: "invalid selector", message: "Invalid CSS selector" } },
      },
    ]);
    const client = clientFor(fetchImpl);
    client.sessionId = "s1";
    const failure = client.findElement("!!");
    await expect(failure).rejects.toBeInstanceOf(WebDriverError);
    await expect(failure).rejects.toThrow(/invalid selector: Invalid CSS selector/);
  });

  it("reports an unreachable driver instead of hanging", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:4444");
    });
    const client = clientFor(fetchImpl as ReturnType<typeof fakeDriver>["fetchImpl"]);
    client.sessionId = "s1";
    const failure = client.pageSource();
    await expect(failure).rejects.toBeInstanceOf(WebDriverError);
    await expect(failure).rejects.toThrow(/ECONNREFUSED/);
  });

  it("deletes the session and forgets its id", async () => {
    const { calls, fetchImpl } = fakeDriver([{ status: 200, body: { value: null } }]);
    const client = clientFor(fetchImpl);
    client.sessionId = "s1";
    await client.deleteSession();
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe(`${BASE}/session/s1`);
    expect(client.sessionId).toBeNull();
  });

  it("does not call the driver when there is no session to delete", async () => {
    const { fetchImpl } = fakeDriver();
    const client = clientFor(fetchImpl);
    await client.deleteSession();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
