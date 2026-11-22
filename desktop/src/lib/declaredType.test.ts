import { describe, it, expect } from "vitest";
import { baseDeclaredType } from "./declaredType";

describe("baseDeclaredType", () => {
  it("drops type modifiers and lengths", () => {
    expect(baseDeclaredType("NUMERIC(12, 4)")).toBe("numeric");
    expect(baseDeclaredType("character varying(64)")).toBe("character");
    expect(baseDeclaredType("timestamp(0) with time zone")).toBe("timestamp");
  });

  it("drops MySQL storage-class noise", () => {
    expect(baseDeclaredType("bigint(20) unsigned")).toBe("bigint");
    expect(baseDeclaredType("int unsigned zerofill")).toBe("int");
    expect(baseDeclaredType("double unsigned")).toBe("double");
  });

  it("keeps a multi-word base type intact", () => {
    expect(baseDeclaredType("double precision")).toBe("double precision");
    expect(baseDeclaredType("time without time zone")).toBe("time without time zone");
  });

  it("is null-safe and idempotent", () => {
    expect(baseDeclaredType(null)).toBe("");
    expect(baseDeclaredType(undefined)).toBe("");
    expect(baseDeclaredType("")).toBe("");
    expect(baseDeclaredType(baseDeclaredType("int8"))).toBe("int8");
  });
});
