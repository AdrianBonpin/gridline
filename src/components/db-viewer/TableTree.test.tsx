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

  it("shows a distinct icon and label for materialized views", () => {
    useDbViewerStore.setState({
      schemas: ["public"],
      currentSchema: "public",
      tables: [
        {
          name: "mv_products",
          schema: "public",
          table_type: "MATERIALIZED VIEW" as any,
        },
      ],
    });
    render(<TableTree />);
    expect(screen.getByText("mv_products")).toBeInTheDocument();
    expect(screen.getByText("Materialized View")).toBeInTheDocument();
  });

  it("shows a distinct icon and label for views", () => {
    useDbViewerStore.setState({
      schemas: ["public"],
      currentSchema: "public",
      tables: [
        {
          name: "order_summary",
          schema: "public",
          table_type: "VIEW",
        },
      ],
    });
    render(<TableTree />);
    expect(screen.getByText("order_summary")).toBeInTheDocument();
    expect(screen.getByText("View")).toBeInTheDocument();
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

  it("shows Loading when schema tree is loading and no tables are present", () => {
    useDbViewerStore.setState({ schemaTreeLoading: true });
    render(<TableTree />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("No tables")).not.toBeInTheDocument();
  });

  it("shows No tables when not loading and no tables are present", () => {
    useDbViewerStore.setState({ schemaTreeLoading: false });
    render(<TableTree />);
    expect(screen.getByText("No tables")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });
});