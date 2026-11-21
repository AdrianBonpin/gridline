import { describe, it, expect, vi } from "vitest";
import { copyConnectionUrl } from "./connectionUrlCopy";
import type { Connection } from "./types";

function makeConn(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "c1",
    name: "Test",
    db_type: "postgresql",
    host: "db.example.com",
    port: 5432,
    username: "user",
    database: "appdb",
    folder_id: null,
    keychain_ref: null,
    tag_ids: [],
    favorite: false,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function deps(overrides: Partial<Parameters<typeof copyConnectionUrl>[2]> = {}) {
  return {
    readPassword: vi.fn(async () => "s3cr3t"),
    writeClipboard: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("copyConnectionUrl", () => {
  it("copies a URL with the keychain password when both work", async () => {
    const d = deps();
    const result = await copyConnectionUrl(makeConn(), { withPassword: true }, d);
    expect(result).toEqual({ ok: true, copiedWithPassword: true });
    expect(d.writeClipboard).toHaveBeenCalledWith(
      "postgresql://user:s3cr3t@db.example.com:5432/appdb",
    );
  });

  it("reports a keychain failure and copies nothing instead of a password-less URL", async () => {
    const d = deps({
      readPassword: vi.fn(async () => {
        throw new Error("keychain locked");
      }),
    });
    const result = await copyConnectionUrl(makeConn(), { withPassword: true }, d);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain("keychain");
    }
    expect(d.writeClipboard).not.toHaveBeenCalled();
  });

  it("refuses to present a password-less URL as the with-password copy", async () => {
    // The keychain answered, but there is no stored password: the URL would
    // silently lose the credential the user asked for, so nothing is copied.
    const d = deps({ readPassword: vi.fn(async () => null) });
    const result = await copyConnectionUrl(makeConn(), { withPassword: true }, d);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain("no saved password");
    }
    expect(d.writeClipboard).not.toHaveBeenCalled();
  });

  it("reports a clipboard failure for the with-password copy", async () => {
    const d = deps({
      writeClipboard: vi.fn(async () => {
        throw new Error("clipboard unavailable");
      }),
    });
    const result = await copyConnectionUrl(makeConn(), { withPassword: true }, d);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain("clipboard");
    }
  });

  it("copies without the keychain when no password is requested", async () => {
    const d = deps();
    const result = await copyConnectionUrl(makeConn(), { withPassword: false }, d);
    expect(result).toEqual({ ok: true, copiedWithPassword: false });
    expect(d.readPassword).not.toHaveBeenCalled();
    expect(d.writeClipboard).toHaveBeenCalledWith(
      "postgresql://user@db.example.com:5432/appdb",
    );
  });

  it("reports a clipboard failure for the no-password copy", async () => {
    const d = deps({
      writeClipboard: vi.fn(async () => {
        throw new Error("clipboard unavailable");
      }),
    });
    const result = await copyConnectionUrl(makeConn(), { withPassword: false }, d);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain("clipboard");
    }
  });

  it("percent-encodes a password containing reserved characters", async () => {
    const d = deps({ readPassword: vi.fn(async () => "p@ss:w/ord") });
    await copyConnectionUrl(makeConn(), { withPassword: true }, d);
    expect(d.writeClipboard).toHaveBeenCalledWith(
      "postgresql://user:p%40ss%3Aw%2Ford@db.example.com:5432/appdb",
    );
  });
});
