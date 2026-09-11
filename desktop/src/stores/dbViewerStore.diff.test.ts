import { describe, it, expect, beforeEach } from "vitest";
import { useDbViewerStore } from "./dbViewerStore";
import type { DiffItem } from "../lib/types";

const item = (name: string, sql: string, destructive: boolean): DiffItem => ({
  object_type: "table",
  name,
  kind: "added",
  detail: [],
  sync_sql: [sql],
  destructive,
});

describe("addDiffItems", () => {
  beforeEach(() => useDbViewerStore.getState().clearChanges());

  it("stages one ddl change per non-destructive item, skipping destructive and empty", () => {
    const items = [
      item("users", "CREATE TABLE users (id int);", false),
      item("old", "DROP TABLE old;", true),
      { ...item("weird", "", false), sync_sql: [] },
    ];
    useDbViewerStore.getState().addDiffItems(items);
    const queue = useDbViewerStore.getState().changesQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe("ddl");
    expect(queue[0].sql).toBe("CREATE TABLE users (id int);");
    expect(queue[0].description).toContain("users");
  });
});
