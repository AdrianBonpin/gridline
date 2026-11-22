import { describe, it, expect } from "vitest";
import {
  relationKindOf,
  relationSupportsAction,
  type RelationKind,
} from "./relationKind";

describe("relationKindOf", () => {
  it("maps catalog table types to a relation kind", () => {
    expect(relationKindOf("TABLE")).toBe("table");
    expect(relationKindOf("BASE TABLE")).toBe("table");
    expect(relationKindOf("VIEW")).toBe("view");
    expect(relationKindOf("MATERIALIZED VIEW")).toBe("materialized_view");
    expect(relationKindOf("MATERIALIZED_VIEW")).toBe("materialized_view");
    expect(relationKindOf(" view ")).toBe("view");
    // Unknown/absent metadata is treated as a table, which is what every
    // pre-existing call site without a kind assumed.
    expect(relationKindOf(undefined)).toBe("table");
    expect(relationKindOf(null)).toBe("table");
    expect(relationKindOf("")).toBe("table");
  });
});

describe("relationSupportsAction", () => {
  it("offers read actions for every relation kind", () => {
    for (const kind of ["table", "view", "materialized_view"] as RelationKind[]) {
      expect(relationSupportsAction("open", kind)).toBe(true);
      expect(relationSupportsAction("copy-schema", kind)).toBe(true);
      expect(relationSupportsAction("export", kind)).toBe(true);
    }
  });

  it("offers row writes and table-shape edits only for tables", () => {
    for (const action of [
      "import",
      "create_constraint",
      "edit_table",
      "empty",
      "drop",
    ] as const) {
      expect(relationSupportsAction(action, "table")).toBe(true);
      expect(relationSupportsAction(action, "view")).toBe(false);
      expect(relationSupportsAction(action, "materialized_view")).toBe(false);
    }
  });

  it("offers indexing and maintenance to tables and materialized views only", () => {
    for (const action of ["create_index", "maintenance"] as const) {
      expect(relationSupportsAction(action, "table")).toBe(true);
      expect(relationSupportsAction(action, "materialized_view")).toBe(true);
      expect(relationSupportsAction(action, "view")).toBe(false);
    }
  });
});
