import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  Banknote,
  Binary,
  Braces,
  CalendarClock,
  Clock,
  FileCode2,
  Fingerprint,
  Globe,
  Hash,
  Layers,
  ListChecks,
  Shapes,
  ToggleLeft,
  Type,
} from "lucide-react";
import { DataTypeIcon, getDataTypeIcon } from "./DataTypeIcon";

describe("getDataTypeIcon", () => {
  it("maps numeric types to Hash", () => {
    expect(getDataTypeIcon("integer")).toBe(Hash);
    expect(getDataTypeIcon("bigint")).toBe(Hash);
    expect(getDataTypeIcon("numeric(10,2)")).toBe(Hash);
    expect(getDataTypeIcon("double precision")).toBe(Hash);
    expect(getDataTypeIcon("REAL")).toBe(Hash);
  });

  it("maps money to Banknote", () => {
    expect(getDataTypeIcon("money")).toBe(Banknote);
  });

  it("maps text types to Type", () => {
    expect(getDataTypeIcon("character varying")).toBe(Type);
    expect(getDataTypeIcon("text")).toBe(Type);
    expect(getDataTypeIcon("TEXT")).toBe(Type);
    expect(getDataTypeIcon("citext")).toBe(Type);
  });

  it("maps booleans to ToggleLeft", () => {
    expect(getDataTypeIcon("boolean")).toBe(ToggleLeft);
    expect(getDataTypeIcon("bool")).toBe(ToggleLeft);
  });

  it("maps JSON types to Braces", () => {
    expect(getDataTypeIcon("json")).toBe(Braces);
    expect(getDataTypeIcon("jsonb")).toBe(Braces);
  });

  it("maps binary types to Binary", () => {
    expect(getDataTypeIcon("bytea")).toBe(Binary);
    expect(getDataTypeIcon("BLOB")).toBe(Binary);
    expect(getDataTypeIcon("bit varying")).toBe(Binary);
  });

  it("maps date/time types to CalendarClock or Clock", () => {
    expect(getDataTypeIcon("timestamp")).toBe(CalendarClock);
    expect(getDataTypeIcon("timestamp with time zone")).toBe(CalendarClock);
    expect(getDataTypeIcon("date")).toBe(Clock);
    expect(getDataTypeIcon("time without time zone")).toBe(Clock);
    expect(getDataTypeIcon("interval")).toBe(Clock);
  });

  it("maps uuid to Fingerprint", () => {
    expect(getDataTypeIcon("uuid")).toBe(Fingerprint);
  });

  it("maps array types to Layers", () => {
    expect(getDataTypeIcon("integer[]")).toBe(Layers);
    expect(getDataTypeIcon("text[]")).toBe(Layers);
  });

  it("maps enums, xml, network and geometric types", () => {
    expect(getDataTypeIcon("enum('a','b')")).toBe(ListChecks);
    expect(getDataTypeIcon("xml")).toBe(FileCode2);
    expect(getDataTypeIcon("inet")).toBe(Globe);
    expect(getDataTypeIcon("point")).toBe(Shapes);
  });

  it("falls back to Type for unknown/custom types", () => {
    expect(getDataTypeIcon("mood")).toBe(Type);
  });
});

describe("DataTypeIcon", () => {
  it("renders the mapped icon with a title tooltip", () => {
    const { container } = render(<DataTypeIcon dataType="integer" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("class")).toContain("lucide-hash");
    // The tooltip lives on the wrapper span (React SVG types omit `title`).
    expect(container.querySelector("span")!.getAttribute("title")).toBe("integer");
  });

  it("honors a custom title override", () => {
    const { container } = render(
      <DataTypeIcon dataType="integer" title="User ID (int)" />,
    );
    expect(container.querySelector("span")!.getAttribute("title")).toBe(
      "User ID (int)",
    );
  });

  it("applies size and className", () => {
    const { container } = render(
      <DataTypeIcon dataType="jsonb" size={9} className="text-text-muted/60" />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("9");
    expect(container.querySelector("span")!.getAttribute("class")).toContain(
      "text-text-muted/60",
    );
    expect(svg.getAttribute("class")).toContain("lucide-braces");
  });
});