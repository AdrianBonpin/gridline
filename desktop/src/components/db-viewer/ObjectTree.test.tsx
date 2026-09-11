import { describe, it, expect } from "vitest";
import { TYPE_LABELS, visibleObjectTypes } from "./ObjectTree";

describe("hypertables object type", () => {
  it("registers label and stays in the type union", () => {
    expect(TYPE_LABELS.hypertables).toBe("hypertables");
    expect(Object.keys(TYPE_LABELS)).toContain("hypertables");
  });

  it("hides hypertables until availability is confirmed true", () => {
    const base = Object.keys(TYPE_LABELS) as ReturnType<typeof visibleObjectTypes>;
    expect(visibleObjectTypes(null)).not.toContain("hypertables");
    expect(visibleObjectTypes(false)).not.toContain("hypertables");
    expect(visibleObjectTypes(true)).toContain("hypertables");
    expect(visibleObjectTypes(true).length).toBe(base.length);
  });
});
