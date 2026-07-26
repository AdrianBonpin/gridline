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

  it("returns null for an empty string", () => {
    expect(parseConnectionString("")).toBeNull();
  });

  it("returns null for a non-URL string", () => {
    expect(parseConnectionString("hello world")).toBeNull();
  });
});

describe("looksLikeConnectionString", () => {
  it("returns true for postgres URL", () => {
    expect(looksLikeConnectionString("postgresql://a@b/c")).toBe(true);
  });

  it("returns false for normal search text", () => {
    expect(looksLikeConnectionString("production database")).toBe(false);
  });
});
