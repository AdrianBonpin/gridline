import { describe, it, expect } from "vitest";
import { parseConnectionString, looksLikeConnectionString } from "./connectionString";

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

  it("parses a SQLite file URL", () => {
    const result = parseConnectionString("sqlite:///path/to/db.sqlite");
    expect(result).toEqual({
      db_type: "sqlite",
      host: "localhost",
      port: null,
      username: null,
      password: null,
      database: "/path/to/db.sqlite",
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
