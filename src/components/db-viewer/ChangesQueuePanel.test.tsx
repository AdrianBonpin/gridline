import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangesQueuePanel } from "./ChangesQueuePanel";
import { useDbViewerStore } from "../../stores/dbViewerStore";

describe("ChangesQueuePanel", () => {
  beforeEach(() => {
    useDbViewerStore.setState({ changesQueue: [] });
  });

  it("shows nothing when queue is empty", () => {
    const { container } = render(<ChangesQueuePanel />);
    expect(container.textContent).toBe("");
  });

  it("shows pending changes", () => {
    useDbViewerStore.getState().addChange({
      type: "update",
      schema: "public",
      table: "users",
      primaryKey: { id: 1 },
      oldData: { name: "Bob" },
      newData: { name: "Alice" },
    });
    render(<ChangesQueuePanel />);
    expect(screen.getByText(/1 pending change/i)).toBeInTheDocument();
    expect(screen.getByText(/users/i)).toBeInTheDocument();
  });

  it("cancel button changes status", async () => {
    const user = userEvent.setup();
    useDbViewerStore.getState().addChange({
      type: "update",
      schema: "public",
      table: "users",
      primaryKey: { id: 1 },
      oldData: { name: "Bob" },
      newData: { name: "Alice" },
    });
    render(<ChangesQueuePanel />);
    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    await user.click(cancelBtn);
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
  });
});