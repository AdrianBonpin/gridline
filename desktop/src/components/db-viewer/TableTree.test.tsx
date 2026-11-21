import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TableTree } from "./TableTree";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useUiStore } from "../../stores/uiStore";
import * as commands from "../../lib/commands";

function column(name: string, type = "text") {
  return {
    name,
    data_type: type,
    is_nullable: true,
    is_pk: false,
    is_fk: false,
    fk_ref: null,
    default_value: null,
    editable: true,
    is_generated: false,
  };
}

describe("TableTree", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
    useUiStore.setState({ activeConnectionId: "c1" });
    useDbViewerStore.setState({ currentDatabase: "appdb" });
    vi.restoreAllMocks();
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

  it("exposes the stable hooks the desktop E2E harness selects on", () => {
    // desktop/e2e opens a table tab by these attributes; renaming one
    // silently breaks the smoke flow, so pin it here.
    useDbViewerStore.setState({
      schemas: ["main"],
      currentSchema: "main",
      tables: [{ name: "products", schema: "main", table_type: "TABLE" }],
    });
    const { container } = render(<TableTree />);
    const row = container.querySelector('[data-testid="table-tree-item"]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute("data-table-name")).toBe("products");
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
describe("TableTree expanded columns are origin-scoped", () => {
  /** Spy on the column introspection, recording each (connection, db) request. */
  function spyOnColumns(next: (args: unknown[]) => ReturnType<typeof column>[]) {
    const calls: unknown[][] = [];
    const spy = vi.spyOn(commands, "getTableColumns").mockImplementation(((
      ...args: unknown[]
    ) => {
      calls.push(args);
      return Promise.resolve(next(args));
    }) as never);
    return { spy, calls };
  }

  async function expandFirstRow(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByLabelText("Expand"));
  }

  function showTree() {
    useDbViewerStore.setState({
      schemas: ["public"],
      currentSchema: "public",
      tables: [{ name: "users", schema: "public", table_type: "TABLE" }],
    });
  }

  it("shows the introspected columns for the expanded table", async () => {
    const user = userEvent.setup();
    spyOnColumns(() => [column("id", "integer"), column("email")]);
    showTree();
    render(<TableTree />);
    await expandFirstRow(user);
    expect(await screen.findByText("email")).toBeInTheDocument();
  });

  it("reads column metadata without asking for a page of row data", async () => {
    // Ticket 09: metadata is a catalog read. Expanding a tree row must not go
    // through the paginated row path (which would truncate the rows under the
    // grid, or be rejected as an out-of-range page size).
    const user = userEvent.setup();
    const columnsSpy = vi
      .spyOn(commands, "getTableColumns")
      .mockResolvedValue([column("id", "integer")]);
    const dataSpy = vi.spyOn(commands, "getTableData");
    showTree();
    render(<TableTree />);
    await expandFirstRow(user);
    expect(await screen.findByText("id")).toBeInTheDocument();
    expect(columnsSpy).toHaveBeenCalledWith("c1", "public", "users");
    expect(dataSpy).not.toHaveBeenCalled();
  });

  it("resolves the expanded row when the metadata read fails", async () => {
    // A failed metadata read leaves the row expanded with no columns; it must
    // not leave a loading state behind or throw out of the tree.
    const user = userEvent.setup();
    vi.spyOn(commands, "getTableColumns").mockRejectedValue(new Error("connection reset"));
    showTree();
    render(<TableTree />);
    await expandFirstRow(user);
    expect(await screen.findByText("No columns")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("never reuses one database's columns for the same table name in another", async () => {
    const user = userEvent.setup();
    let data = [column("appdb_only")];
    const { calls } = spyOnColumns(() => data);
    showTree();
    render(<TableTree />);
    await expandFirstRow(user);
    expect(await screen.findByText("appdb_only")).toBeInTheDocument();
    expect(calls).toHaveLength(1);

    // The database selector moves. The same table name is a different table, so
    // the cached list (and the visible one) must not survive the switch.
    data = [column("analytics_only")];
    useDbViewerStore.setState({ currentDatabase: "analytics" });

    expect(await screen.findByText("analytics_only")).toBeInTheDocument();
    expect(screen.queryByText("appdb_only")).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("re-introspects an expanded table after schema metadata is invalidated", async () => {
    const user = userEvent.setup();
    let data = [column("legacy")];
    const { calls } = spyOnColumns(() => data);
    showTree();
    render(<TableTree />);
    await expandFirstRow(user);
    expect(await screen.findByText("legacy")).toBeInTheDocument();

    // Relevant DDL changed the columns.
    data = [column("renamed")];
    useDbViewerStore.getState().invalidateMetadata();

    expect(await screen.findByText("renamed")).toBeInTheDocument();
    expect(screen.queryByText("legacy")).toBeNull();
    expect(calls).toHaveLength(2);
  });
});

describe("TableTree relation-kind actions", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
    useUiStore.setState({ activeConnectionId: "c1" });
    useDbViewerStore.setState({ currentDatabase: "appdb" });
    vi.restoreAllMocks();
  });

  it("offers a view row's menu only the actions that apply to a view", async () => {
    const user = userEvent.setup();
    useDbViewerStore.setState({
      schemas: ["main"],
      currentSchema: "main",
      tables: [{ name: "order_summary", schema: "main", table_type: "VIEW" }],
    });
    render(<TableTree dbType="postgresql" />);
    await user.click(screen.getByLabelText("Table options"));
    expect(screen.getByText("Open in new tab")).toBeInTheDocument();
    expect(screen.queryByText("Edit Table…")).toBeNull();
    expect(screen.queryByText("Empty Table")).toBeNull();
    expect(screen.queryByText("Delete Table")).toBeNull();
  });
});
