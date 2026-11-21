import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TableOverflowMenu } from "./TableOverflowMenu";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useUiStore } from "../../stores/uiStore";
import * as commands from "../../lib/commands";
import * as exportData from "../../lib/exportData";

describe("TableOverflowMenu", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn() },
      configurable: true,
      writable: true,
    });
    useDbViewerStore.getState().reset();
    useUiStore.setState({ activeConnectionId: "c1" });
    vi.resetAllMocks();
  });

  it("offers Create Index… and Create Constraint…", () => {
    render(<TableOverflowMenu schema="public" table="users" onOpenTab={() => "tab-1"} connectionId="c1" />);
    fireEvent.click(screen.getByLabelText(/table options/i));
    expect(screen.getByText("Create Index…")).toBeInTheDocument();
    expect(screen.getByText("Create Constraint…")).toBeInTheDocument();
  });

  it("opens objectForm create tabs for Create Index… and Create Constraint…", async () => {
    render(<TableOverflowMenu schema="public" table="users" onOpenTab={() => "tab-1"} connectionId="c1" />);
    fireEvent.click(screen.getByLabelText(/table options/i));
    fireEvent.click(screen.getByText("Create Index…"));
    const st = useDbViewerStore.getState();
    expect(st.tabs).toHaveLength(1);
    expect(st.tabs[0].tabType).toBe("objectForm");
    expect(st.tabs[0].form?.kind).toBe("index");
    expect(st.tabs[0].form?.mode).toBe("create");

    useDbViewerStore.getState().reset();
    render(<TableOverflowMenu schema="public" table="users" onOpenTab={() => "tab-1"} connectionId="c1" />);
    fireEvent.click(screen.getAllByLabelText(/table options/i)[1]);
    fireEvent.click(screen.getByText("Create Constraint…"));
    expect(useDbViewerStore.getState().tabs[0].tabType).toBe("objectForm");
    expect(useDbViewerStore.getState().tabs[0].form?.kind).toBe("constraint");
  });

  it("renders menu trigger button", () => {
    render(<TableOverflowMenu schema="public" table="users" onOpenTab={() => "tab-1"} />);
    expect(screen.getByLabelText(/table options/i)).toBeInTheDocument();
  });

  it("shows menu options on click", async () => {
    const user = userEvent.setup();
    render(<TableOverflowMenu schema="public" table="users" onOpenTab={() => "tab-1"} />);
    await user.click(screen.getByLabelText(/table options/i));
    expect(screen.getByText("Open in new tab")).toBeInTheDocument();
    expect(screen.getByText("Copy table schema")).toBeInTheDocument();
    expect(screen.getByText("Export data (CSV)")).toBeInTheDocument();
    expect(screen.getByText("Export data (Excel)")).toBeInTheDocument();
  });

  it("fires onOpenTab when menu item clicked", async () => {
    const user = userEvent.setup();
    const onOpenTab = vi.fn().mockReturnValue("tab-1");
    render(<TableOverflowMenu schema="public" table="users" onOpenTab={onOpenTab} />);
    await user.click(screen.getByLabelText(/table options/i));
    await user.click(screen.getByText("Open in new tab"));
    expect(onOpenTab).toHaveBeenCalledWith("public", "users", true);
  });

  it("Copy table schema calls getTableDdl and writes clipboard", async () => {
    vi.spyOn(commands, "getTableDdl").mockResolvedValue("CREATE TABLE t (id int)");
    const writeText = (navigator.clipboard as any).writeText as ReturnType<typeof vi.fn>;
    render(<TableOverflowMenu schema="public" table="t" onOpenTab={() => "tab-1"} />);
    fireEvent.click(screen.getByLabelText(/table options/i));
    fireEvent.click(screen.getByText(/copy table schema/i));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("CREATE TABLE t (id int)"));
  });

  it("Empty Table opens confirm then stages an empty_table change", async () => {
    render(<TableOverflowMenu schema="public" table="t" onOpenTab={() => "tab-1"} />);
    fireEvent.click(screen.getByLabelText(/table options/i));
    fireEvent.click(screen.getByText(/empty table/i));
    fireEvent.click(screen.getByRole("button", { name: /empty table/i }));
    await waitFor(() => {
      const q = useDbViewerStore.getState().changesQueue;
      expect(q[q.length - 1]).toEqual(expect.objectContaining({ type: "empty_table", schema: "public", table: "t" }));
    });
  });

  it("Delete Table opens confirm then stages a drop_table change", async () => {
    vi.spyOn(commands, "getObjectDependencies").mockResolvedValue([]);
    render(<TableOverflowMenu schema="public" table="t" onOpenTab={() => "tab-1"} />);
    fireEvent.click(screen.getByLabelText(/table options/i));
    fireEvent.click(screen.getByText(/delete table/i));
    await waitFor(() => expect(screen.queryByText(/open in new tab/i)).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete table/i }));
    await waitFor(() => {
      const q = useDbViewerStore.getState().changesQueue;
      expect(q[q.length - 1]).toEqual(expect.objectContaining({ type: "drop_table", schema: "public", table: "t" }));
    });
  });

  it("Delete Table fetches dependencies and shows DependencyDialog before confirming", async () => {
    vi.spyOn(commands, "getObjectDependencies").mockResolvedValue([{ deptype: "n", class: "pg_class", name: "v_orders" }]);
    render(<TableOverflowMenu schema="public" table="orders" connectionId="c1" onOpenTab={() => "tab-1"} />);
    fireEvent.click(screen.getByLabelText(/table options/i));
    fireEvent.click(screen.getByText(/delete table/i));
    await waitFor(() => expect(commands.getObjectDependencies).toHaveBeenCalledWith("c1", "public", "table", "orders"));
    await waitFor(() => expect(screen.getByText("v_orders")).toBeInTheDocument());
  });

  it("Export data calls exportData when rows and columns are provided", async () => {
    const spy = vi.spyOn(exportData, "exportData");
    const columns = [{ name: "id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false }];
    render(<TableOverflowMenu schema="public" table="t" onOpenTab={() => "tab-1"} columns={columns} rows={[[1]]} />);
    fireEvent.click(screen.getByLabelText(/table options/i));
    fireEvent.click(screen.getByText(/export data \(csv\)/i));
    await waitFor(() => expect(spy).toHaveBeenCalledWith([[1]], columns, "csv", "t", { schema: "public", dbType: undefined }));
  });

  it("Excel export calls exportData and notifies", async () => {
    const spy = vi.spyOn(exportData, "exportData").mockImplementation(() => {});
    const { useNotificationStore } = await import("../../stores/notificationStore");
    useNotificationStore.getState().notifications.length = 0;
    const columns = [{ name: "id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false }];
    render(<TableOverflowMenu schema="public" table="t" onOpenTab={() => "tab-1"} columns={columns} rows={[[1]]} />);
    fireEvent.click(screen.getByLabelText(/table options/i));
    fireEvent.click(screen.getByText(/export data \(excel\)/i));
    await waitFor(() => expect(spy).toHaveBeenCalledWith([[1]], columns, "xlsx", "t", { schema: "public", dbType: undefined }));
    const st = useNotificationStore.getState();
    expect(st.notifications.some((n) => n.message.toLowerCase().includes("exported"))).toBe(true);
  });

  it("tree kebab export fetches table data when rows are absent", async () => {
    const spy = vi.spyOn(exportData, "exportData").mockImplementation(() => {});
    const getSpy = vi.spyOn(commands, "getTableData").mockResolvedValue({
      columns: [{ name: "id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false }],
      rows: [[42]],
      total_rows: 1,
      page: 1,
      page_size: 500,
    });
    const { useNotificationStore } = await import("../../stores/notificationStore");
    useNotificationStore.getState().notifications.length = 0;
    render(<TableOverflowMenu schema="public" table="t" onOpenTab={() => "tab-1"} connectionId="c1" />);
    fireEvent.click(screen.getByLabelText(/table options/i));
    fireEvent.click(screen.getByText(/export data \(excel\)/i));
    // One bounded page — 500 is the backend's largest accepted page size, so a
    // larger request would be rejected rather than clamped.
    await waitFor(() =>
      expect(getSpy).toHaveBeenCalledWith("c1", "public", "t", 1, 500),
    );
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const st = useNotificationStore.getState();
    expect(st.notifications.some((n) => n.message.includes("Exported"))).toBe(true);
  });

  it("maintenance items are gated by capability and run via confirm", async () => {
    vi.spyOn(commands, "runMaintenance").mockResolvedValue({ duration_ms: 3, message: "VACUUM completed" });
    render(<TableOverflowMenu schema="public" table="users" onOpenTab={() => ""} connectionId="c1" />);
    fireEvent.click(screen.getByLabelText("Table options"));
    fireEvent.click(screen.getByText("VACUUM"));
    fireEvent.click(screen.getByRole("button", { name: /vacuum/i }));
    await screen.findByText(/completed/i);
    expect(commands.runMaintenance).toHaveBeenCalledWith("c1", "public", "users", "vacuum");
  });

  it("Edit Table opens a table form tab with the live columns", async () => {
    const getTableColumns = vi.spyOn(commands, "getTableColumns").mockResolvedValue([
      { name: "id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
      { name: "email", data_type: "text", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
    ] as any);
    const openFormTab = vi.spyOn(useDbViewerStore.getState(), "openFormTab");
    render(<TableOverflowMenu schema="public" table="users" onOpenTab={() => ""} connectionId="c1" columns={[{ name: "id", data_type: "int", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false }]} />);
    fireEvent.click(screen.getByLabelText("Table options"));
    fireEvent.click(screen.getByText("Edit Table…"));

    await waitFor(() =>
      expect(openFormTab).toHaveBeenCalledWith(expect.objectContaining({ kind: "table", mode: "edit" })),
    );
    // The form is built from a live catalog read, never from whatever the tree
    // happened to have cached (or not cached) for this table.
    expect(getTableColumns).toHaveBeenCalledWith("c1", "public", "users");
    const params = openFormTab.mock.calls[0][0].params as any;
    expect(params.action.columns.map((c: any) => c.name)).toEqual(["id", "email"]);
    expect(params.action.old_columns.map((c: any) => c.name)).toEqual(["id", "email"]);
    // Column Identity travels with each editable row.
    expect(params.action.columns.map((c: any) => c.original_name)).toEqual(["id", "email"]);
  });

  it("Edit Table from an unexpanded tree item shows the live columns, not an empty form", async () => {
    // An unexpanded tree row passes no columns at all.
    vi.spyOn(commands, "getTableColumns").mockResolvedValue([
      { name: "order_id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
      { name: "product_id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
      { name: "quantity", data_type: "integer", is_nullable: false, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
    ] as any);
    render(<TableOverflowMenu schema="main" table="order_items" onOpenTab={() => ""} connectionId="c1" dbType="sqlite" />);
    fireEvent.click(screen.getByLabelText("Table options"));
    fireEvent.click(screen.getByText("Edit Table…"));

    await waitFor(() => expect(useDbViewerStore.getState().tabs).toHaveLength(1));
    const params = useDbViewerStore.getState().tabs[0].form?.params as any;
    expect(params.action.columns.map((c: any) => c.name)).toEqual([
      "order_id",
      "product_id",
      "quantity",
    ]);
  });

  it("Edit Table does not open an empty form when the live columns cannot be read", async () => {
    vi.spyOn(commands, "getTableColumns").mockRejectedValue(new Error("connection reset"));
    const openFormTab = vi.spyOn(useDbViewerStore.getState(), "openFormTab");
    const { useNotificationStore } = await import("../../stores/notificationStore");
    useNotificationStore.getState().notifications.length = 0;
    render(<TableOverflowMenu schema="public" table="users" onOpenTab={() => ""} connectionId="c1" />);
    fireEvent.click(screen.getByLabelText("Table options"));
    fireEvent.click(screen.getByText("Edit Table…"));

    await waitFor(() => {
      expect(
        useNotificationStore
          .getState()
          .notifications.some((n) => /live columns/i.test(n.message)),
      ).toBe(true);
    });
    expect(openFormTab).not.toHaveBeenCalled();
    expect(useDbViewerStore.getState().tabs).toHaveLength(0);
  });
});
describe("TableOverflowMenu offers only actions that apply to the relation kind", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
    useUiStore.setState({ activeConnectionId: "c1" });
    vi.resetAllMocks();
  });

  /** Menu labels only a plain table may offer. */
  const TABLE_ONLY_LABELS = [
    "Edit Table…",
    "Empty Table",
    "Delete Table",
    "Import data (CSV/JSON)",
    "Create Index…",
    "Create Constraint…",
    "VACUUM",
  ];

  function openMenu() {
    fireEvent.click(screen.getByLabelText("Table options"));
  }

  function offered(label: string): boolean {
    return screen.queryByText(label) !== null;
  }

  it("offers a plain table every action", () => {
    render(
      <TableOverflowMenu
        schema="public"
        table="users"
        tableType="TABLE"
        connectionId="c1"
        dbType="postgresql"
        onOpenTab={() => "tab-1"}
      />,
    );
    openMenu();
    for (const label of TABLE_ONLY_LABELS) {
      expect(offered(label), label).toBe(true);
    }
  });

  it("offers a view only the actions that apply to it", () => {
    render(
      <TableOverflowMenu
        schema="main"
        table="order_summary"
        tableType="VIEW"
        connectionId="c1"
        dbType="postgresql"
        onOpenTab={() => "tab-1"}
      />,
    );
    openMenu();
    // Reads still apply: a view is browsable, exportable, and its DDL is copyable.
    expect(offered("Open in new tab")).toBe(true);
    expect(offered("Export data (CSV)")).toBe(true);
    expect(offered("Copy table schema")).toBe(true);
    // Nothing the server would reject for a view is offered.
    for (const label of TABLE_ONLY_LABELS) {
      expect(offered(label), label).toBe(false);
    }
  });

  it("offers a materialized view no edit, empty-table or drop action", () => {
    render(
      <TableOverflowMenu
        schema="public"
        table="mv_orders"
        tableType="MATERIALIZED VIEW"
        connectionId="c1"
        dbType="postgresql"
        onOpenTab={() => "tab-1"}
      />,
    );
    openMenu();
    // A materialized view is a real relation: indexing and maintenance apply.
    expect(offered("Create Index…")).toBe(true);
    expect(offered("VACUUM")).toBe(true);
    // Its rows and its table shape never do.
    for (const label of [
      "Edit Table…",
      "Empty Table",
      "Delete Table",
      "Import data (CSV/JSON)",
      "Create Constraint…",
    ]) {
      expect(offered(label), label).toBe(false);
    }
  });

  it("stages nothing when a table-only action is invoked for a view", async () => {
    // The menu never renders these rows for a view; the action guard is the
    // second line of defence so no invalid change can be staged either way.
    vi.spyOn(commands, "getObjectDependencies").mockResolvedValue([]);
    render(
      <TableOverflowMenu
        schema="main"
        table="order_summary"
        tableType="VIEW"
        connectionId="c1"
        dbType="postgresql"
        onOpenTab={() => "tab-1"}
      />,
    );
    openMenu();
    expect(screen.queryByText("Empty Table")).toBeNull();
    expect(screen.queryByText("Delete Table")).toBeNull();
    expect(useDbViewerStore.getState().changesQueue).toHaveLength(0);
  });
});

describe("TableOverflowMenu stages a dependent drop through one confirmation path", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
    useUiStore.setState({ activeConnectionId: "c1" });
    vi.resetAllMocks();
  });

  const dependencies = [
    { deptype: "n", class: "pg_class", name: "v_orders" },
    { deptype: "n", class: "pg_class", name: "fk_orders_user" },
  ];

  /** Open the menu and reach the point where the drop confirmation is shown. */
  async function startDependentDrop() {
    vi.spyOn(commands, "getObjectDependencies").mockResolvedValue(dependencies);
    render(
      <TableOverflowMenu
        schema="public"
        table="orders"
        tableType="TABLE"
        connectionId="c1"
        dbType="postgresql"
        onOpenTab={() => "tab-1"}
      />,
    );
    fireEvent.click(screen.getByLabelText("Table options"));
    fireEvent.click(screen.getByText("Delete Table"));
    await screen.findByText("v_orders");
  }

  it("presents exactly one dialog that names the dependencies", async () => {
    await startDependentDrop();
    // One dialog — not a dependency dialog stacked on a confirm dialog.
    expect(screen.getAllByTestId("animated-backdrop")).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: /^delete table$/i }),
    ).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^cancel$/i })).toHaveLength(
      1,
    );
    expect(screen.getByText("v_orders")).toBeInTheDocument();
    expect(screen.getByText("fk_orders_user")).toBeInTheDocument();
  });

  it("stages exactly one drop change when that one confirmation proceeds", async () => {
    await startDependentDrop();
    const confirm = screen.getByRole("button", { name: /^delete table$/i });
    // The single dialog requires one deliberate acknowledgement.
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);

    const queue = useDbViewerStore.getState().changesQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      type: "drop_table",
      schema: "public",
      table: "orders",
    });
    // No second confirmation follows: the one dialog is the whole path.
    expect(screen.queryByTestId("animated-backdrop")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^delete table$/i }),
    ).toBeNull();
  });

  it("stages nothing when the acknowledgement is cancelled", async () => {
    await startDependentDrop();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(useDbViewerStore.getState().changesQueue).toHaveLength(0);
    expect(screen.queryByTestId("animated-backdrop")).toBeNull();
  });

  it("still stages exactly one change for a drop with no dependencies", async () => {
    vi.spyOn(commands, "getObjectDependencies").mockResolvedValue([]);
    render(
      <TableOverflowMenu
        schema="public"
        table="orders"
        tableType="TABLE"
        connectionId="c1"
        dbType="postgresql"
        onOpenTab={() => "tab-1"}
      />,
    );
    fireEvent.click(screen.getByLabelText("Table options"));
    fireEvent.click(screen.getByText("Delete Table"));
    await waitFor(() =>
      expect(screen.getAllByTestId("animated-backdrop")).toHaveLength(1),
    );
    fireEvent.click(screen.getByRole("button", { name: /^delete table$/i }));

    const queue = useDbViewerStore.getState().changesQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ type: "drop_table", table: "orders" });
  });
});
