import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  buildObjectDdl,
  dropCrudParams,
  getAvailableExtensions,
  initialCrudParams,
} from "./objectCrud";

describe("buildObjectDdl", () => {
  afterEach(() => vi.restoreAllMocks());

  it("invokes build_object_ddl with connectionId, kind, params", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      "CREATE TYPE public.role AS ENUM ('admin')",
    ]);
    const sql = await buildObjectDdl("c1", "enum", {
      schema: "public",
      name: "role",
      action: { op: "create", labels: ["admin"] },
    });
    expect(invoke).toHaveBeenCalledWith("build_object_ddl", {
      connectionId: "c1",
      kind: "enum",
      params: {
        schema: "public",
        name: "role",
        action: { op: "create", labels: ["admin"] },
      },
    });
    expect(sql).toEqual(["CREATE TYPE public.role AS ENUM ('admin')"]);
  });

  it("passes through drop params for sequences", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(['DROP SEQUENCE "public"."s"']);
    const sql = await buildObjectDdl("c1", "sequence", {
      schema: "public",
      name: "s",
      action: { op: "drop" },
    });
    expect(invoke).toHaveBeenCalledWith("build_object_ddl", {
      connectionId: "c1",
      kind: "sequence",
      params: { schema: "public", name: "s", action: { op: "drop" } },
    });
    expect(sql).toEqual(['DROP SEQUENCE "public"."s"']);
  });
});

describe("getAvailableExtensions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("invokes get_available_extensions with connectionId", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { name: "pgcrypto", version: "1.3", comment: null },
    ]);
    const exts = await getAvailableExtensions("c1");
    expect(invoke).toHaveBeenCalledWith("get_available_extensions", {
      connectionId: "c1",
    });
    expect(exts).toEqual([{ name: "pgcrypto", version: "1.3", comment: null }]);
  });

  it("returns empty array when no extensions available", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    const exts = await getAvailableExtensions("c2");
    expect(exts).toEqual([]);
  });
});

describe("initialCrudParams", () => {
  it("create shape starts empty with sensible defaults", () => {
    const p = initialCrudParams(
      "sequence",
      { schema: "public", name: "" },
      "create",
    );
    expect(p).toEqual({
      schema: "public",
      name: "",
      action: {
        op: "create",
        increment: "1",
        min_value: "1",
        max_value: "9223372036854775807",
        start: "1",
        cycle: false,
      },
    });
  });

  it("edit prefills the name from the item", () => {
    const p = initialCrudParams(
      "sequence",
      { schema: "public", name: "s" },
      "edit",
    );
    expect(p).toMatchObject({
      schema: "public",
      name: "s",
      action: { op: "create", increment: "1" },
    });
  });

  it("enum edit carries labels through", () => {
    const p = initialCrudParams(
      "enum",
      { schema: "public", name: "role", labels: ["admin"] },
      "edit",
    );
    expect(p.action).toMatchObject({ op: "create", labels: ["admin"] });
  });

  it("index create keeps the owning table and an empty column list", () => {
    const p = initialCrudParams(
      "index",
      { schema: "public", table: "users", name: "" },
      "create",
    );
    expect(p).toEqual({
      schema: "public",
      table: "users",
      name: "",
      action: { op: "create", unique: false, method: "", columns: [], predicate: null },
    });
  });

  it("constraint create starts as a CHECK on the owning table", () => {
    const p = initialCrudParams(
      "constraint",
      { schema: "public", table: "users", name: "" },
      "create",
    );
    expect(p).toEqual({
      schema: "public",
      table: "users",
      name: "",
      action: { op: "check", expression: "" },
    });
  });

  it("procedure edit prefills is_procedure from kind", () => {
    const p = initialCrudParams(
      "procedure",
      { schema: "public", name: "do_thing" },
      "edit",
    );
    expect(p).toMatchObject({
      schema: "public",
      name: "do_thing",
      is_procedure: true,
      action: { op: "create_or_replace", args: [] },
    });
  });

  it("view edit prefills the definition and marks non-materialized", () => {
    const p = initialCrudParams(
      "view",
      { schema: "public", name: "v", definition: "SELECT 1" },
      "edit",
    );
    expect(p).toMatchObject({
      schema: "public",
      name: "v",
      materialized: false,
      action: { op: "create", definition: "SELECT 1" },
    });
  });
});

describe("dropCrudParams", () => {
  it("plain kinds build a base drop action", () => {
    expect(
      dropCrudParams("sequence", { schema: "public", name: "s" }),
    ).toEqual({ schema: "public", name: "s", action: { op: "drop" } });
  });

  it("index and constraint carry the owning table", () => {
    expect(
      dropCrudParams("index", { schema: "public", name: "i", table: "users" }),
    ).toEqual({
      schema: "public",
      name: "i",
      table: "users",
      action: { op: "drop" },
    });
  });

  it("trigger uses table_name as a fallback for the table", () => {
    expect(
      dropCrudParams("trigger", {
        schema: "public",
        name: "trg",
        table_name: "users",
      }),
    ).toEqual({
      schema: "public",
      name: "trg",
      action: { op: "drop", table: "users" },
    });
  });

  it("view marks materialized via table_type", () => {
    expect(
      dropCrudParams("view", { schema: "public", name: "m", table_type: "m" }),
    ).toMatchObject({ materialized: true, action: { op: "drop" } });
  });

  it("function carries argument types and is_procedure false", () => {
    expect(
      dropCrudParams("function", {
        schema: "public",
        name: "f",
        argument_types: ["int"],
      }),
    ).toMatchObject({
      is_procedure: false,
      action: { op: "drop", arg_types: ["int"] },
    });
  });
});