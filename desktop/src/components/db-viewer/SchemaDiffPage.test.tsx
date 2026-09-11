import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../lib/commands", () => ({
  compareSchemas: vi.fn(),
  getSchemas: vi.fn().mockResolvedValue(["public"]),
  getDatabases: vi.fn().mockResolvedValue(["app"]),
}));
vi.mock("../../stores/connectionStore", () => ({
  useConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({ connections: [{ id: "src1", name: "Source PG", db_type: "postgresql" }] }),
}));

import { SchemaDiffPage } from "./SchemaDiffPage";
import { compareSchemas } from "../../lib/commands";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import type { DiffReport } from "../../lib/types";

const report: DiffReport = {
  source_label: "public · src1",
  target_label: "public · tgt",
  truncated: false,
  items: [
    {
      object_type: "table", name: "users", kind: "added", detail: [],
      sync_sql: ['CREATE TABLE "users" (id int);'], destructive: false,
    },
    {
      object_type: "table", name: "old", kind: "removed", detail: [],
      sync_sql: ["DROP TABLE old;"], destructive: true,
    },
  ],
};

describe("SchemaDiffPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDbViewerStore.getState().clearChanges();
    (compareSchemas as ReturnType<typeof vi.fn>).mockResolvedValue(report);
  });

  it("runs the diff and renders grouped items with kind badges", async () => {
    render(<SchemaDiffPage connectionId="tgt" />);
    fireEvent.click(screen.getByRole("button", { name: /run diff/i }));
    await waitFor(() => expect(screen.getByText("users")).toBeTruthy());
    expect(screen.getByText(/added/i)).toBeTruthy();
    expect(screen.getByText(/removed/i)).toBeTruthy();
    expect(screen.getByText(/Destructive/i)).toBeTruthy();
  });

  it("stages only safe items into the queue", async () => {
    render(<SchemaDiffPage connectionId="tgt" />);
    fireEvent.click(screen.getByRole("button", { name: /run diff/i }));
    await waitFor(() => expect(screen.getByText("users")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /stage 1 safe item/i }));
    const queue = useDbViewerStore.getState().changesQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].sql).toContain("CREATE TABLE");
  });

  it("shows the identical empty state", async () => {
    (compareSchemas as ReturnType<typeof vi.fn>).mockResolvedValue({
      source_label: "a", target_label: "b", truncated: false, items: [],
    });
    render(<SchemaDiffPage connectionId="tgt" />);
    fireEvent.click(screen.getByRole("button", { name: /run diff/i }));
    await waitFor(() => expect(screen.getByText(/identical/i)).toBeTruthy());
  });
});
