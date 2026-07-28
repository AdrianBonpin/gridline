import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DbViewerScreen } from "./DbViewerScreen";
import { useDbViewerStore } from "../../stores/dbViewerStore";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    measureElement: () => {},
  }),
}));

describe("DbViewerScreen", () => {
  beforeEach(() => {
    useDbViewerStore.setState({
      tabs: [], activeTabId: null, changesQueue: [],
      databases: ["mydb"], schemas: ["public"],
      tables: [{ name: "users", schema: "public", table_type: "TABLE" }],
      currentDatabase: "mydb", currentSchema: "public",
    });
  });

  it("renders the sidebar", () => {
    render(<DbViewerScreen connectionId="c1" onHome={() => {}} onSettings={() => {}} />);
    expect(screen.getByLabelText(/home/i)).toBeInTheDocument();
  });
});