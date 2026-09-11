import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HypertableDetail } from "./HypertableDetail";
import type { HypertableInfo } from "../../lib/types";

const item: HypertableInfo = {
  name: "metrics",
  schema: "public",
  num_dimensions: 2,
  compression_enabled: true,
  num_chunks: 42,
  total_size_bytes: 1048576,
};

describe("HypertableDetail", () => {
  it("renders dimensions, compression, chunk count and human size", () => {
    render(<HypertableDetail item={item} onOpenTable={vi.fn()} />);
    expect(screen.getByText("metrics")).toBeTruthy();
    expect(screen.getByText(/2 dimensions/)).toBeTruthy();
    expect(screen.getByText(/compression enabled/)).toBeTruthy();
    expect(screen.getByText(/42 chunks/)).toBeTruthy();
    expect(screen.getByText(/1\.0 MB/)).toBeTruthy();
  });

  it("shows the DDL/restore caveat", () => {
    render(<HypertableDetail item={item} onOpenTable={vi.fn()} />);
    expect(screen.getByText(/create_hypertable/)).toBeTruthy();
  });

  it("opens the underlying table on click", () => {
    const onOpenTable = vi.fn();
    render(<HypertableDetail item={item} onOpenTable={onOpenTable} />);
    fireEvent.click(screen.getByRole("button", { name: /view table/i }));
    expect(onOpenTable).toHaveBeenCalledWith("public", "metrics");
  });

  it("marks compression as disabled when off", () => {
    render(
      <HypertableDetail item={{ ...item, compression_enabled: false }} onOpenTable={vi.fn()} />,
    );
    expect(screen.getByText(/compression disabled/)).toBeTruthy();
  });
});
