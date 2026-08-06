import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { buildObjectDdl, getAvailableExtensions } from "./objectCrud";

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