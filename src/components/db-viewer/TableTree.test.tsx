import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TableTree } from "./TableTree";
import { useDbViewerStore } from "../../stores/dbViewerStore";

describe("TableTree", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
  });

  it("renders table names from store", () => {
    useDbViewerStore.setState({
      schemas: ["public"],
      currentSchema: "public",
      tables: [
        { name: "users", schema: "public", table_type: "TABLE" },
        { name: "orders", schema: "public", table_type: "TABLE" },
      ],
    });
    render(<TableTree />);
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
  });

  it("opens a tab when table is clicked", async () => {
    const user = userEvent.setup();
    useDbViewerStore.setState({
      schemas: ["public"],
      currentSchema: "public",
      tables: [{ name: "users", schema: "public", table_type: "TABLE" }],
    });
    render(<TableTree />);
    await user.click(screen.getByText("users"));
    const state = useDbViewerStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({ schema: "public", table: "users" });
  });
});