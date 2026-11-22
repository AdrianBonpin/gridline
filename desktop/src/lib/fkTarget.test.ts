import { describe, it, expect } from "vitest";
import { fkTarget, fkRelation, fkLabel } from "./fkTarget";

/**
 * A foreign-key reference carries its schema. These helpers are the single
 * place the viewer turns that reference into a relation: if the schema were
 * dropped here, every call site would be free to substitute the browsing
 * schema — the silent wrong-row bug this ticket removes.
 */
describe("fkTarget", () => {
    it("keeps the referenced schema, table and column", () => {
        expect(
            fkTarget({ is_fk: true, fk_ref: ["reporting", "users", "id"] }),
        ).toEqual({ schema: "reporting", table: "users", column: "id" });
    });

    it("resolves to null for non-FK columns and absent references", () => {
        expect(fkTarget({ is_fk: false, fk_ref: null })).toBeNull();
        expect(
            fkTarget({ is_fk: true, fk_ref: null } as never),
        ).toBeNull();
        expect(fkTarget(null)).toBeNull();
        expect(fkTarget(undefined)).toBeNull();
    });

    it("refuses an incomplete reference instead of guessing a relation", () => {
        // A reference that lost its schema (older payloads) must not silently
        // become a same-schema lookup.
        expect(fkTarget({ is_fk: true, fk_ref: ["", "users", "id"] } as never)).toBeNull();
        expect(fkTarget({ is_fk: true, fk_ref: ["reporting", "", "id"] } as never)).toBeNull();
        expect(fkTarget({ is_fk: true, fk_ref: ["reporting", "users", ""] } as never)).toBeNull();
    });

    it("labels the relation and the full reference", () => {
        const target = fkTarget({ is_fk: true, fk_ref: ["reporting", "users", "id"] });
        expect(fkRelation(target)).toBe("reporting.users");
        expect(fkLabel(target)).toBe("reporting.users.id");
        expect(fkRelation(null)).toBe("");
        expect(fkLabel(null)).toBe("");
    });
});
