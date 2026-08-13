import { describe, it, expect } from "vitest";
import { parseConnectionString, looksLikeConnectionString, detectProviderFromHost, buildConnectionUrl } from "./connectionString";
import type { Connection } from "./types";

function makeConn(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "c1",
    name: "Test",
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    username: "user",
    folder_id: null,
    keychain_ref: null,
    tag_ids: [],
    favorite: false,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("parseConnectionString", () => {
  it("parses a PostgreSQL URL", () => {
    const result = parseConnectionString("postgresql://user:pass@localhost:5432/mydb");
    expect(result).toEqual({
      db_type: "postgresql",
      host: "localhost",
      port: 5432,
      username: "user",
      password: "pass",
      database: "mydb",
    });
  });

  it("parses a MySQL URL without password", () => {
    const result = parseConnectionString("mysql://root@127.0.0.1:3306/app");
    expect(result).toEqual({
      db_type: "mysql",
      host: "127.0.0.1",
      port: 3306,
      username: "root",
      password: null,
      database: "app",
    });
  });

  it("parses a Redis URL", () => {
    const result = parseConnectionString("redis://user:pass@localhost:6379/0");
    expect(result).toEqual({
      db_type: "redis",
      host: "localhost",
      port: 6379,
      username: "user",
      password: "pass",
      database: "0",
    });
  });

  it("parses a SQLite file URL — path maps to host (v0.7.0 fix)", () => {
    const result = parseConnectionString("sqlite:///path/to/db.sqlite");
    expect(result).toEqual({
      db_type: "sqlite",
      host: "/path/to/db.sqlite",
      port: null,
      username: null,
      password: null,
      database: null,
    });
  });

  it("parses a SQLite file: URL — path maps to host", () => {
    const result = parseConnectionString("file:///Users/me/data.db");
    expect(result).toEqual({
      db_type: "sqlite",
      host: "/Users/me/data.db",
      port: null,
      username: null,
      password: null,
      database: null,
    });
  });

  it("defaults PostgreSQL port to 5432 when omitted", () => {
    const result = parseConnectionString("postgresql://user@host/db");
    expect(result).toEqual({
      db_type: "postgresql",
      host: "host",
      port: 5432,
      username: "user",
      password: null,
      database: "db",
    });
  });

  it("preserves database name when query parameters are present", () => {
    const result = parseConnectionString("postgresql://user@host/db?sslmode=require");
    expect(result).toEqual({
      db_type: "postgresql",
      host: "host",
      port: 5432,
      username: "user",
      password: null,
      database: "db",
    });
  });

  it("returns null for an empty string", () => {
    expect(parseConnectionString("")).toBeNull();
  });

  it("returns null for a non-URL string", () => {
    expect(parseConnectionString("hello world")).toBeNull();
  });

  it("defaults MySQL port to 3306 when omitted", () => {
    const result = parseConnectionString("mysql://user@host/db");
    expect(result).toEqual({
      db_type: "mysql",
      host: "host",
      port: 3306,
      username: "user",
      password: null,
      database: "db",
    });
  });

  it("defaults Redis port to 6379 when omitted", () => {
    const result = parseConnectionString("redis://localhost");
    expect(result).toEqual({
      db_type: "redis",
      host: "localhost",
      port: 6379,
      username: null,
      password: null,
      database: null,
    });
  });
});

describe("looksLikeConnectionString", () => {
  it("returns true for postgres URL", () => {
    expect(looksLikeConnectionString("postgresql://a@b/c")).toBe(true);
  });

  it("returns true for Redis URL", () => {
    expect(looksLikeConnectionString("redis://localhost")).toBe(true);
  });

  it("returns true for SQLite URL", () => {
    expect(looksLikeConnectionString("sqlite:///path/to/db.sqlite")).toBe(true);
  });

  it("returns false for normal search text", () => {
    expect(looksLikeConnectionString("production database")).toBe(false);
  });
});

describe("detectProviderFromHost", () => {
    it("detects Supabase by host suffix", () => {
      expect(detectProviderFromHost("db.abcdefghijklmnopqrst.supabase.co")).toBe("supabase");
      expect(detectProviderFromHost("aws-us-east-1.pooler.supabase.com")).toBeNull();
    });
    it("detects NeonDB by host suffix", () => {
      expect(detectProviderFromHost("ep-cool-darkness-a1b2c3d4-pooler.us-east-2.aws.neon.tech")).toBe("neon");
    });
    it("returns null for plain Postgres hosts", () => {
      expect(detectProviderFromHost("localhost")).toBeNull();
      expect(detectProviderFromHost("prod.example.com")).toBeNull();
    });
  });

describe("buildConnectionUrl", () => {
  it("builds a PostgreSQL URL with password and sslmode", () => {
    const url = buildConnectionUrl(
      makeConn({ db_type: "postgresql", host: "prod.example.com", port: 5432, username: "alice", database: "app", ssl_mode: "require" }),
      "s3cret",
    );
    expect(url).toBe("postgresql://alice:s3cret@prod.example.com:5432/app?sslmode=require");
  });

  it("omits password when null (no-password variant)", () => {
    const url = buildConnectionUrl(
      makeConn({ db_type: "postgresql", host: "prod.example.com", port: 5432, username: "alice", database: "app" }),
      null,
    );
    expect(url).toBe("postgresql://alice@prod.example.com:5432/app");
  });

  it("omits sslmode when disable or unset", () => {
    expect(
      buildConnectionUrl(makeConn({ ssl_mode: "disable" }), null),
    ).toBe("postgresql://user@localhost:5432");
    expect(
      buildConnectionUrl(makeConn({ ssl_mode: undefined }), null),
    ).toBe("postgresql://user@localhost:5432");
  });

  it("percent-encodes special characters in user/password/database", () => {
    const url = buildConnectionUrl(
      makeConn({ username: "a b", database: "my db" }),
      "p@ss w:rd",
    );
    expect(url).toBe("postgresql://a%20b:p%40ss%20w%3Ard@localhost:5432/my%20db");
  });

  it("builds a MySQL URL", () => {
    const url = buildConnectionUrl(
      makeConn({ db_type: "mysql", host: "127.0.0.1", port: 3306, username: "root", database: "app" }),
      "pw",
    );
    expect(url).toBe("mysql://root:pw@127.0.0.1:3306/app");
  });

  it("builds a Redis URL with password but no username", () => {
    const url = buildConnectionUrl(
      makeConn({ db_type: "redis", host: "localhost", port: 6379, username: null, database: "0" }),
      "pw",
    );
    expect(url).toBe("redis://:pw@localhost:6379/0");
  });

  it("builds a SQLite URL from the host file path", () => {
    const url = buildConnectionUrl(
      makeConn({ db_type: "sqlite", host: "/Users/me/data.db", port: null, username: null, database: null }),
      null,
    );
    expect(url).toBe("sqlite:///Users/me/data.db");
  });

  it("round-trips through parseConnectionString", () => {
    const conn = makeConn({ db_type: "postgresql", host: "localhost", port: 5432, username: "user", database: "mydb" });
    const url = buildConnectionUrl(conn, "pass");
    expect(parseConnectionString(url)).toEqual({
      db_type: "postgresql",
      host: "localhost",
      port: 5432,
      username: "user",
      password: "pass",
      database: "mydb",
    });
  });
});
