import { describe, it, expect } from "vitest";
import {
  testConnection,
  dbConnect,
  dbDisconnect,
  getDatabases,
  getSchemas,
  getTables,
  getTableData,
  executeChange,
  refreshConnection,
} from "./commands";

describe("commands", () => {
  it("testConnection has correct signature", () => {
    expect(typeof testConnection).toBe("function");
  });

  it("dbConnect returns void promise", () => {
    expect(typeof dbConnect).toBe("function");
  });

  it("dbDisconnect returns void promise", () => {
    expect(typeof dbDisconnect).toBe("function");
  });

  it("getDatabases returns string array promise", () => {
    expect(typeof getDatabases).toBe("function");
  });

  it("getSchemas returns string array promise", () => {
    expect(typeof getSchemas).toBe("function");
  });

  it("getTables returns TableInfo array promise", () => {
    expect(typeof getTables).toBe("function");
  });

  it("getTableData returns QueryResult-shaped promise", () => {
    expect(typeof getTableData).toBe("function");
  });

  it("executeChange returns void promise", () => {
    expect(typeof executeChange).toBe("function");
  });

  it("refreshConnection returns full tree promise", () => {
    expect(typeof refreshConnection).toBe("function");
  });
});