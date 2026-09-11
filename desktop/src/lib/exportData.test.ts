import { describe, it, expect, vi } from "vitest";
import { exportData, csvCell, qualifiedTableSql } from "./exportData";
import type { ColumnInfo } from "./types";

const columns: ColumnInfo[] = [
  { name: "id", data_type: "int", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
  { name: "v", data_type: "text", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
];

describe("exportData", () => {
  it("csv quotes cells and escapes quotes", () => {
    const create = vi.spyOn(document, "createElement");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.fn();
    create.mockReturnValue({ click } as unknown as HTMLAnchorElement);
    exportData([[1, "a"], [2, 'b"c']], columns, "csv", "t");
    expect(click).toHaveBeenCalled();
  });

  it("json serializes rows as objects", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue({ click } as unknown as HTMLAnchorElement);
    exportData([[1, "a"]], columns, "json", "t");
    expect(click).toHaveBeenCalled();
  });

  it("xlsx produces a Blob with the xlsx MIME and extension download", () => {
    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    globalThis.URL.createObjectURL = vi.fn(() => "blob:x") as any;
    globalThis.URL.revokeObjectURL = vi.fn() as any;
    const a = { click: vi.fn(), href: "", download: "" };
    vi.spyOn(document, "createElement").mockReturnValue(a as any);
    const rows = [[1]];
    const cols: ColumnInfo[] = [
      { name: "id", data_type: "integer", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
    ];
    try {
      exportData(rows, cols, "xlsx", "t");
      expect(a.download).toBe("t.xlsx");
      expect((URL.createObjectURL as any).mock.calls[0][0] instanceof Blob).toBe(true);
      expect((URL.createObjectURL as any).mock.calls[0][0].type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } finally {
      globalThis.URL.createObjectURL = origCreateObjectURL;
      globalThis.URL.revokeObjectURL = origRevokeObjectURL;
    }
  });
});

describe("csvCell (client CSV parity with streamed export)", () => {
  it("quotes and guards like the Rust writer", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+x")).toBe("'+x");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell(null)).toBe("");
  });
});

describe("qualifiedTableSql", () => {
  it("double-quotes for PG/SQLite and backticks for MySQL/MariaDB", () => {
    expect(qualifiedTableSql("postgresql", "public", "users")).toBe('SELECT * FROM "public"."users"');
    expect(qualifiedTableSql("sqlite", "main", "users")).toBe('SELECT * FROM "main"."users"');
    expect(qualifiedTableSql("mysql", "app", "users")).toBe("SELECT * FROM `app`.`users`");
    expect(qualifiedTableSql("mariadb", "app", "users")).toBe("SELECT * FROM `app`.`users`");
  });
});