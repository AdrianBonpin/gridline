import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TableForm } from "./TableForm";
import { useDbViewerStore } from "../../../stores/dbViewerStore";
import { useConnectionStore } from "../../../stores/connectionStore";
import * as cmd from "../../../lib/commands";
import * as objectCrud from "../../../lib/objectCrud";

beforeEach(() => {
  useDbViewerStore.getState().reset();
  // The form reads the engine off the saved connection; no test may inherit
  // another's connection (e.g. a SQLite one) and silently change the path taken.
  useConnectionStore.setState({ connections: [] });
  vi.spyOn(cmd, "buildObjectDdl").mockReset().mockResolvedValue([]);
  vi.spyOn(cmd, "buildRebuildScript").mockReset().mockResolvedValue("");
  vi.spyOn(cmd, "getTableRebuildReadiness").mockReset().mockResolvedValue({ ok: true, reasons: [] });
  vi.spyOn(cmd, "getTableColumns").mockReset().mockResolvedValue([]);
  vi.spyOn(cmd, "getTablespaces").mockReset().mockResolvedValue([]);
  vi.spyOn(cmd, "getConstraints").mockReset().mockResolvedValue([]);
  vi.spyOn(cmd, "getSchemaGraph").mockReset().mockResolvedValue({ tables: [], relationships: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function baseParams(mode: "create" | "edit") {
  return {
    schema: "public",
    name: mode === "edit" ? "users" : "",
    action: {
      op: mode === "edit" ? "edit" : "create",
      columns: [],
      old_columns:
        mode === "edit"
          ? [{ name: "id", type: "integer", nullable: false, default: null, is_pk: true }]
          : undefined,
    },
  } as any;
}

function seedFormTab(tab: any) {
  useDbViewerStore.setState({ tabs: [{ ...tab, tabType: tab.tabType ?? "objectForm" }], activeTabId: tab.id });
}

describe("TableForm", () => {
  it("add/remove rows; composite PK allowed", () => {
    const tab = {
      id: "t1",
      form: {
        kind: "table",
        params: baseParams("create"),
        title: "Create Table",
        description: "Create Table",
        mode: "create",
      },
      title: "Create Table",
    } as any;
    seedFormTab(tab);
    render(<TableForm connectionId="c1" tab={tab} />);
    fireEvent.click(screen.getByLabelText("Add column"));
    fireEvent.click(screen.getByLabelText("Add column"));
    const cols = () => (useDbViewerStore.getState().tabs[0].form?.params.action as any).columns;
    expect(cols()).toHaveLength(2);
    // the first added column auto-starts as the PK
    expect(cols()[0].is_pk).toBe(true);
    // marking a second column as PK keeps both (composite key)
    fireEvent.click(screen.getAllByLabelText("Column settings")[1]);
    fireEvent.click(screen.getByLabelText("PK"));
    expect(cols().filter((c: any) => c.is_pk)).toHaveLength(2);
  });

  it("reorder triggers rebuild path and readiness refusal blocks staging", async () => {
    (cmd.getTableRebuildReadiness as any).mockResolvedValue({ ok: false, reasons: ["table has triggers"] });
    render(
      <TableForm
        connectionId="c1"
        tab={{
          id: "t1",
          form: {
            kind: "table",
            params: {
              schema: "public",
              name: "users",
              action: {
                op: "edit",
                columns: [
                  { name: "email", type: "text", nullable: true, default: null, is_pk: false },
                  { name: "id", type: "integer", nullable: false, default: null, is_pk: true },
                ],
                old_columns: [
                  { name: "id", type: "integer", nullable: false, default: null, is_pk: true },
                  { name: "email", type: "text", nullable: true, default: null, is_pk: false },
                ],
              },
            },
            title: "Edit Table",
            description: "Edit Table",
            mode: "edit",
          },
          title: "Edit Table",
        } as any}
      />,
    );
    // order differs => rebuild; readiness not ok => refusal copy + Stage disabled
    expect(await screen.findByText(/has triggers/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stage" })).toBeDisabled();
  });

  it("rebuild ok stages a single rebuild_table change", async () => {
    (cmd.getTableRebuildReadiness as any).mockResolvedValue({ ok: true, reasons: [] });
    (cmd.buildRebuildScript as any).mockResolvedValue("CREATE TABLE _t();");
    render(
      <TableForm
        connectionId="c1"
        tab={{
          id: "t1",
          form: {
            kind: "table",
            params: {
              schema: "public",
              name: "users",
              action: {
                op: "edit",
                columns: [
                  { name: "email", type: "text", nullable: true, default: null, is_pk: false },
                  { name: "id", type: "integer", nullable: false, default: null, is_pk: true },
                ],
                old_columns: [
                  { name: "id", type: "integer", nullable: false, default: null, is_pk: true },
                  { name: "email", type: "text", nullable: true, default: null, is_pk: false },
                ],
              },
            },
            title: "Edit Table",
            description: "Edit Table",
            mode: "edit",
          },
          title: "Edit Table",
        } as any}
      />,
    );
    await screen.findByLabelText(/SQL/i);
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));
    await screen.findByText(/Rebuild/i).catch(() => null); // staging is sync-ish
    const q = useDbViewerStore.getState().changesQueue;
    expect(q).toHaveLength(1);
    expect(q[0].type).toBe("rebuild_table");
    expect(q[0].sql).toBe("CREATE TABLE _t();");
  });

  it("edit diff (no reorder) stages ddl per statement after stale guard passes", async () => {
    (cmd.getTableColumns as any).mockResolvedValue([
      {
        name: "id",
        data_type: "integer",
        is_nullable: false,
        is_pk: true,
        is_fk: false,
        fk_ref: null,
        default_value: null,
        editable: true,
        is_generated: false,
      },
    ]);
    (cmd.buildObjectDdl as any).mockResolvedValue([
      'ALTER TABLE "public"."users" ADD COLUMN "email" text',
    ]);
    render(
      <TableForm
        connectionId="c1"
        tab={{
          id: "t1",
          form: {
            kind: "table",
            params: {
              schema: "public",
              name: "users",
              action: {
                op: "edit",
                columns: [
                  { name: "id", type: "integer", nullable: false, default: null, is_pk: true },
                  { name: "email", type: "text", nullable: true, default: null, is_pk: false },
                ],
                old_columns: [{ name: "id", type: "integer", nullable: false, default: null, is_pk: true }],
              },
            },
            title: "Edit Table",
            description: "Edit users",
            mode: "edit",
          },
          title: "Edit Table",
        } as any}
      />,
    );
    await screen.findByLabelText(/SQL/i);
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));
    await screen.findByText(/committed/i).catch(() => null); // staging is sync-ish
    const q = useDbViewerStore.getState().changesQueue;
    expect(q).toHaveLength(1);
    expect(q[0].type).toBe("ddl");
  });

  // --- Column Identity: rename is explicit intent (ticket 07) ---

  const liveId = {
    name: "id",
    data_type: "integer",
    is_nullable: false,
    is_pk: true,
    is_fk: false,
    fk_ref: null,
    default_value: null,
    editable: true,
    is_generated: false,
  };
  const liveName = {
    name: "name",
    data_type: "text",
    is_nullable: true,
    is_pk: false,
    is_fk: false,
    fk_ref: null,
    default_value: null,
    editable: true,
    is_generated: false,
  };
  const snapshot = [
    { name: "id", type: "integer", nullable: false, default: null, is_pk: true },
    { name: "name", type: "text", nullable: true, default: null, is_pk: false },
  ];

  function renderEdit(columns: any[]) {
    const tab = {
      id: "t1",
      form: {
        kind: "table",
        params: {
          schema: "public",
          name: "users",
          action: { op: "edit", columns, old_columns: snapshot },
        },
        title: "Edit Table",
        description: "Edit users",
        mode: "edit",
      },
      title: "Edit Table",
    } as any;
    seedFormTab(tab);
    render(<TableForm connectionId="c1" tab={tab} />);
  }

  function editPayloads() {
    return (cmd.buildObjectDdl as any).mock.calls
      .map((call: any) => call[2])
      .filter(
        (p: any) =>
          p.action?.op === "edit" && Array.isArray(p.action.columns),
      );
  }

  it("changing a live column's name sends explicit rename intent", async () => {
    (cmd.getTableColumns as any).mockResolvedValue([liveId, liveName]);
    renderEdit([
      { ...snapshot[0], original_name: "id" },
      { ...snapshot[1], original_name: "name" },
    ]);
    fireEvent.change(screen.getAllByPlaceholderText("name")[1], {
      target: { value: "label" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));

    await waitFor(() => {
      const withIntent = editPayloads().filter((p: any) =>
        p.action.columns.some((c: any) => c.renamed_from !== undefined),
      );
      expect(withIntent.length).toBeGreaterThan(0);
      const cols = withIntent[withIntent.length - 1].action.columns;
      expect(cols[1]).toMatchObject({ name: "label", renamed_from: "name" });
      expect(cols[0].renamed_from).toBeUndefined();
    });
  });

  it("a newly added row carries no rename intent", async () => {
    (cmd.getTableColumns as any).mockResolvedValue([liveId, liveName]);
    renderEdit([
      { ...snapshot[0], original_name: "id" },
      { ...snapshot[1], original_name: "name" },
    ]);
    fireEvent.click(screen.getByLabelText("Add column"));
    fireEvent.change(screen.getAllByPlaceholderText("name")[2], {
      target: { value: "email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));

    await waitFor(() => {
      const payloads = editPayloads();
      expect(payloads.length).toBeGreaterThan(0);
      const cols = payloads[payloads.length - 1].action.columns;
      expect(cols.map((c: any) => c.name)).toEqual(["id", "name", "email"]);
      expect(cols.every((c: any) => c.renamed_from === undefined)).toBe(true);
    });
  });

  it("a combined rename + add stages every generated statement", async () => {
    (cmd.getTableColumns as any).mockResolvedValue([liveId, liveName]);
    (cmd.buildObjectDdl as any).mockResolvedValue([
      'ALTER TABLE "public"."users" RENAME COLUMN "name" TO "label"',
      'ALTER TABLE "public"."users" ADD COLUMN "email" text',
    ]);
    renderEdit([
      { ...snapshot[0], original_name: "id" },
      { ...snapshot[1], original_name: "name" },
    ]);
    fireEvent.change(screen.getAllByPlaceholderText("name")[1], {
      target: { value: "label" },
    });
    fireEvent.click(screen.getByLabelText("Add column"));
    fireEvent.change(screen.getAllByPlaceholderText("name")[2], {
      target: { value: "email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));

    await waitFor(() => {
      const q = useDbViewerStore.getState().changesQueue;
      expect(q.map((c: any) => c.sql)).toEqual([
        'ALTER TABLE "public"."users" RENAME COLUMN "name" TO "label"',
        'ALTER TABLE "public"."users" ADD COLUMN "email" text',
      ]);
    });
  });

  it("a permutation rename is never staged as a set-equal rebuild", async () => {
    // `id→name` + `name→id` keeps the column-name SET unchanged, so it looks
    // exactly like a pure reorder. A PostgreSQL rebuild copies data by identity
    // name, so taking that path dropped both renames and rebuilt the table with
    // the old names — silently. The edit path applies a rename and refuses a
    // swap with a reason, so the submission must go there instead.
    (cmd.getTableColumns as any).mockResolvedValue([liveId, liveName]);
    (cmd.buildObjectDdl as any).mockRejectedValue(
      new Error(
        'Cannot rename to "name": it is still the source of another rename in this submission',
      ),
    );
    renderEdit([
      { ...snapshot[1], original_name: "id" },
      { ...snapshot[0], original_name: "name" },
    ]);
    await screen.findByLabelText(/SQL/i);

    expect(cmd.buildRebuildScript).not.toHaveBeenCalled();
    const payloads = editPayloads();
    expect(payloads.length).toBeGreaterThan(0);
    expect(payloads[payloads.length - 1].action.op).toBe("edit");
    expect(payloads[payloads.length - 1].action.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "name", renamed_from: "id" }),
        expect.objectContaining({ name: "id", renamed_from: "name" }),
      ]),
    );

    // Staging surfaces the backend's refusal; nothing enters the queue as a
    // "reorder" that would have thrown the rename away.
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));
    expect(
      await screen.findByText(/still the source of another rename/i),
    ).toBeInTheDocument();
    expect(useDbViewerStore.getState().changesQueue).toHaveLength(0);
  });

  it("a SQLite permutation rename keeps the rebuild path, which carries renames", async () => {
    // SQLite's rebuild maps every new column to its `renamed_from` source, so it
    // applies a swap atomically; it must not be routed away from the rebuild.
    useConnectionStore.setState({
      connections: [
        {
          id: "c1",
          name: "Local",
          db_type: "sqlite",
          host: "/tmp/app.db",
          port: null,
          username: null,
          database: "main",
          folder_id: null,
          keychain_ref: null,
          tag_ids: [],
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          favorite: false,
        },
      ],
    } as any);
    (cmd.buildRebuildScript as any).mockResolvedValue(
      'INSERT INTO "main"."_gl_users_tmp" ("name", "id") SELECT "id", "name" FROM "main"."users"',
    );
    renderEdit([
      { ...snapshot[1], original_name: "id" },
      { ...snapshot[0], original_name: "name" },
    ]);
    await screen.findByLabelText(/SQL/i);
    await waitFor(() => expect(cmd.buildRebuildScript).toHaveBeenCalled());
    const [args] = (cmd.buildRebuildScript as any).mock.calls.slice(-1);
    // The script builder receives every column with its rename intent intact.
    expect(args[3]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "name", original_name: "id" }),
        expect.objectContaining({ name: "id", original_name: "name" }),
      ]),
    );
  });

  it("stale guard blocks staging when live columns differ", async () => {
    (cmd.getTableColumns as any).mockResolvedValue([
      {
        name: "id",
        data_type: "bigint",
        is_nullable: false,
        is_pk: true,
        is_fk: false,
        fk_ref: null,
        default_value: null,
        editable: true,
        is_generated: false,
      },
    ]);
    render(
      <TableForm
        connectionId="c1"
        tab={{
          id: "t1",
          form: {
            kind: "table",
            params: {
              schema: "public",
              name: "users",
              action: {
                op: "edit",
                columns: [{ name: "id", type: "integer", nullable: false, default: null, is_pk: true }],
                old_columns: [{ name: "id", type: "integer", nullable: false, default: null, is_pk: true }],
              },
            },
            title: "Edit Table",
            description: "Edit users",
            mode: "edit",
          },
          title: "Edit Table",
        } as any}
      />,
    );
    await screen.findByLabelText(/SQL/i);
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));
    expect(await screen.findByText(/changed since you opened/i)).toBeInTheDocument();
    expect(useDbViewerStore.getState().changesQueue).toHaveLength(0);
  });

  it("create-mode grid renders header and cog settings menus", () => {
    const tab = {
      id: "t1",
      form: {
        kind: "table",
        params: {
          schema: "public",
          name: "products",
          action: {
            op: "create",
            columns: [
              { name: "id", type: "integer", nullable: false, default: null, is_pk: true },
              { name: "sku", type: "text", nullable: true, default: null, is_pk: false },
            ],
          },
        },
        title: "Create Table",
        description: "Create Table",
        mode: "create",
      },
      title: "Create Table",
    } as any;
    seedFormTab(tab);
    render(<TableForm connectionId="c1" tab={tab} />);
    const headers = screen.getAllByText("Name");
    expect(headers.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Parameters")).toBeInTheDocument();
    expect(screen.getByText("Default Value")).toBeInTheDocument();
    // first row (id, integer): Auto-Increment is available
    fireEvent.click(screen.getAllByLabelText("Column settings")[0]);
    expect(screen.getByLabelText("PK")).toBeInTheDocument();
    expect(screen.getByLabelText("Auto-Increment")).toBeInTheDocument();
    expect(screen.getByLabelText("Unique")).toBeInTheDocument();
    expect(screen.getByLabelText("Nullable")).toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText("Column settings")[0]); // close
    // second row (sku, text): no Auto-Increment
    fireEvent.click(screen.getAllByLabelText("Column settings")[1]);
    expect(screen.getByLabelText("PK")).toBeInTheDocument();
    expect(screen.queryByLabelText("Auto-Increment")).toBeNull();
    expect(screen.getByLabelText("Unique")).toBeInTheDocument();
    expect(screen.getByLabelText("Nullable")).toBeInTheDocument();
  });

  it("folds auto_increment integer to serial in the DDL payload", async () => {
    const tab = {
      id: "t1",
      form: {
        kind: "table",
        params: {
          schema: "public",
          name: "products",
          action: {
            op: "create",
            columns: [{ name: "id", type: "integer", nullable: false, default: null, is_pk: true }],
          },
        },
        title: "Create Table",
        description: "Create Table",
        mode: "create",
      },
      title: "Create Table",
    } as any;
    seedFormTab(tab);
    render(<TableForm connectionId="c1" tab={tab} />);
    fireEvent.click(screen.getByLabelText("Column settings"));
    fireEvent.click(screen.getByLabelText("Auto-Increment"));
    await waitFor(() => {
      expect((useDbViewerStore.getState().tabs[0].form?.params.action as any).columns[0].auto_increment).toBe(true);
    });
    fireEvent.click(screen.getByLabelText("Column settings")); // close menu
    fireEvent.click(screen.getByRole("button", { name: "Create Table" }));
    await waitFor(() => expect(cmd.buildObjectDdl).toHaveBeenCalled());
    const calls = (cmd.buildObjectDdl as any).mock.calls;
    const stageCall = calls.find((call: any) => call[2].action.columns.some((c: any) => c.type === "serial"));
    expect(stageCall).toBeTruthy();
    expect(stageCall[2].action.columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "id", type: "serial", nullable: false, is_pk: true })]),
    );
  });

  it("folds unique to the DDL payload column", async () => {
    const tab = {
      id: "t1",
      form: {
        kind: "table",
        params: {
          schema: "public",
          name: "products",
          action: {
            op: "create",
            columns: [
              { name: "id", type: "integer", nullable: false, default: null, is_pk: true },
              { name: "sku", type: "text", nullable: false, default: null, is_pk: false },
            ],
          },
        },
        title: "Create Table",
        description: "Create Table",
        mode: "create",
      },
      title: "Create Table",
    } as any;
    seedFormTab(tab);
    render(<TableForm connectionId="c1" tab={tab} />);
    fireEvent.click(screen.getAllByLabelText("Column settings")[1]);
    fireEvent.click(screen.getByLabelText("Unique"));
    await waitFor(() => {
      expect((useDbViewerStore.getState().tabs[0].form?.params.action as any).columns[1].unique).toBe(true);
    });
    fireEvent.click(screen.getAllByLabelText("Column settings")[1]); // close menu
    fireEvent.click(screen.getByRole("button", { name: "Create Table" }));
    await waitFor(() => expect(cmd.buildObjectDdl).toHaveBeenCalled());
    const calls = (cmd.buildObjectDdl as any).mock.calls;
    const stageCall = calls.find((call: any) => call[2].action.columns.some((c: any) => c.name === "sku" && c.unique === true));
    expect(stageCall).toBeTruthy();
    expect(stageCall[2].action.columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "sku", unique: true })]),
    );
  });

  it("schema select auto-selects the current schema in create mode", () => {
    useDbViewerStore.setState({ schemas: ["public", "audit"] });
    const tab = {
      id: "t1",
      form: {
        kind: "table",
        params: {
          schema: "audit",
          name: "",
          action: { op: "create", columns: [] },
        },
        title: "Create Table",
        description: "Create Table",
        mode: "create",
      },
      title: "Create Table",
    } as any;
    seedFormTab(tab);
    render(<TableForm connectionId="c1" tab={tab} />);
    const sel = screen.getByLabelText("Schema") as HTMLSelectElement;
    expect(sel.value).toBe("audit");
    fireEvent.change(sel, { target: { value: "public" } });
    expect((useDbViewerStore.getState().tabs[0].form?.params as any).schema).toBe("public");
  });

  it("staging an FK applies the referenced type to the local column", async () => {
    (cmd.getSchemaGraph as any).mockResolvedValue({
      tables: [
        { name: "products", schema: "public", table_type: "BASE TABLE", columns: [{ name: "id", data_type: "int", is_pk: true, is_fk: false, is_unique: true, is_nullable: false, fk_ref: null }] },
        { name: "categories", schema: "public", table_type: "BASE TABLE", columns: [{ name: "id", data_type: "int", is_pk: true, is_fk: false, is_unique: true, is_nullable: false, fk_ref: null }] },
      ],
      relationships: [],
    });
    vi.spyOn(objectCrud, "buildObjectDdl").mockResolvedValue(["ALTER TABLE \"public\".\"products\" ADD FOREIGN KEY (\"category_id\") REFERENCES \"public\".\"categories\" (\"id\")"]);
    const tab = {
      id: "t1",
      form: {
        kind: "table",
        params: {
          schema: "public",
          name: "products",
          action: {
            op: "create",
            columns: [
              { name: "id", type: "integer", nullable: false, default: null, is_pk: true },
              { name: "category_id", type: "integer", nullable: true, default: null, is_pk: false },
            ],
          },
        },
        title: "Create Table",
        description: "Create Table",
        mode: "create",
      },
      title: "Create Table",
    } as any;
    seedFormTab(tab);
    render(<TableForm connectionId="c1" tab={tab} />);
    fireEvent.click(screen.getByLabelText("Set foreign key")); // category_id (id is PK → no FK icon)
    await screen.findByText("Foreign key");
    const refColSel = (await screen.findByLabelText("Referenced column 1")) as HTMLSelectElement;
    await waitFor(() => {
      expect([...refColSel.options].map((o) => o.value)).toContain("id");
    });
    const addFkButtons = screen.getAllByRole("button", { name: "Add FK" });
    fireEvent.click(addFkButtons[addFkButtons.length - 1]);
    await waitFor(() => {
      const cols = (useDbViewerStore.getState().tabs[0].form?.params.action as any).columns;
      const col = cols.find((c: any) => c.name === "category_id");
      expect(col.type).toBe("int");
      expect(col.fk).toBe(true);
    });
    // the FK is staged inline into the CREATE TABLE (single change), not as a separate ALTER
    expect(useDbViewerStore.getState().changesQueue).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Create Table" }));
    await waitFor(() => {
      const stageCall = (cmd.buildObjectDdl as any).mock.calls.find((call: any) =>
        call[1] === "table" &&
        call[2]?.action?.foreign_keys?.some((fk: any) => fk.columns[0] === "category_id"),
      );
      expect(stageCall).toBeTruthy();
    });
  });

  it("shows staged FK changes in the Foreign keys section", async () => {
    const tab = {
      id: "t1",
      form: {
        kind: "table",
        params: {
          schema: "public",
          name: "products",
          action: { op: "create", columns: [] },
        },
        title: "Create Table",
        description: "Create Table",
        mode: "create",
      },
      title: "Create Table",
    } as any;
    seedFormTab(tab);
    useDbViewerStore.getState().addChange({
      type: "ddl",
      sql: 'ALTER TABLE "public"."products" ADD FOREIGN KEY ("category_id") REFERENCES "public"."categories" ("id") ON DELETE CASCADE',
      description: "Add FK category_id → public.categories",
    });
    render(<TableForm connectionId="c1" tab={tab} />);
    expect(await screen.findByText(/Foreign key relation to/)).toBeInTheDocument();
    expect(screen.getByText("public.categories")).toBeInTheDocument();
    expect(screen.getByText(/products.category_id → categories.id/)).toBeInTheDocument();
    expect(screen.getByText(/· CASCADE/)).toBeInTheDocument();
  });

  it("opens the FK panel with the column preselected", async () => {
    (cmd.getSchemaGraph as any).mockResolvedValue({
      tables: [
        { name: "products", schema: "public", table_type: "BASE TABLE", columns: [{ name: "category_id", data_type: "int", is_pk: false, is_fk: false, is_unique: false, is_nullable: true, fk_ref: null }] },
        { name: "categories", schema: "public", table_type: "BASE TABLE", columns: [{ name: "id", data_type: "int", is_pk: true, is_fk: false, is_unique: true, is_nullable: false, fk_ref: null }] },
      ],
      relationships: [],
    });
    const tab = {
      id: "t1",
      form: {
        kind: "table",
        params: {
          schema: "public",
          name: "products",
          action: {
            op: "create",
            columns: [
              { name: "id", type: "integer", nullable: false, default: null, is_pk: true },
              { name: "category_id", type: "integer", nullable: true, default: null, is_pk: false },
            ],
          },
        },
        title: "Create Table",
        description: "Create Table",
        mode: "create",
      },
      title: "Create Table",
    } as any;
    seedFormTab(tab);
    render(<TableForm connectionId="c1" tab={tab} />);
    const fkButtons = screen.getAllByLabelText("Set foreign key");
    // id is the PK column → its FK icon is hidden; category_id is the only one
    expect(fkButtons).toHaveLength(1);
    fireEvent.click(fkButtons[0]);
    expect(await screen.findByText("Foreign key")).toBeInTheDocument();
    const local = (await screen.findByLabelText("Local column 1")) as HTMLSelectElement;
    expect(local.value).toBe("category_id");
  });
});

describe("TableForm SQLite mode", () => {
  beforeEach(() => {
    useConnectionStore.setState({
      connections: [
        {
          id: "c1",
          db_type: "sqlite",
          name: "SQLite",
          host: "",
          port: null,
          username: null,
          database: null,
          folder_id: null,
          keychain_ref: null,
          tag_ids: [],
          created_at: "",
          updated_at: "",
          favorite: false,
        } as any,
      ],
    });
  });

  afterEach(() => {
    useConnectionStore.setState({ connections: [] });
  });

  it("shows SQLite types in the dropdown and not serial", () => {
    const tab = {
      id: "t1",
      form: {
        kind: "table",
        params: {
          schema: "main",
          name: "products",
          action: {
            op: "create",
            columns: [{ name: "id", type: "integer", nullable: false, default: null, is_pk: true }],
          },
        },
        title: "Create Table",
        description: "Create Table",
        mode: "create",
      },
      title: "Create Table",
    } as any;
    seedFormTab(tab);
    render(<TableForm connectionId="c1" tab={tab} />);
    const typeSel = screen.getByLabelText("type") as HTMLSelectElement;
    const values = Array.from(typeSel.options).map((o) => o.value);
    expect(values).toContain("integer");
    expect(values).toContain("text");
    expect(values).toContain("real");
    expect(values).toContain("blob");
    expect(values).not.toContain("serial");
  });

  it("shows INTEGER PRIMARY KEY AUTOINCREMENT in the SQL preview", async () => {
    (cmd.buildObjectDdl as any).mockResolvedValue([
      'CREATE TABLE "main"."t" ("id" INTEGER PRIMARY KEY AUTOINCREMENT)',
    ]);
    const tab = {
      id: "t1",
      form: {
        kind: "table",
        params: {
          schema: "main",
          name: "t",
          action: {
            op: "create",
            columns: [{ name: "id", type: "integer", nullable: false, default: null, is_pk: true }],
          },
        },
        title: "Create Table",
        description: "Create Table",
        mode: "create",
      },
      title: "Create Table",
    } as any;
    seedFormTab(tab);
    render(<TableForm connectionId="c1" tab={tab} />);
    fireEvent.click(screen.getByLabelText("Column settings"));
    fireEvent.click(screen.getByLabelText("Auto-Increment"));
    fireEvent.click(screen.getByLabelText("SQL"));
    expect(
      await screen.findByText('CREATE TABLE "main"."t" ("id" INTEGER PRIMARY KEY AUTOINCREMENT)'),
    ).toBeInTheDocument();
  });

  it("a SQLite edit that needs a rebuild is refused in the editor", async () => {
    (cmd.getTableRebuildReadiness as any).mockResolvedValue({
      ok: false,
      reasons: [
        'index "idx_order_items_product_id" uses column "product_id", which this rebuild drops',
      ],
    });
    const live = [
      { name: "quantity", type: "INTEGER", nullable: false, default: "1", is_pk: false },
    ];
    const tab = {
      id: "t1",
      form: {
        kind: "table",
        params: {
          schema: "main",
          name: "order_items",
          action: {
            op: "edit",
            columns: [
              {
                name: "quantity",
                type: "TEXT",
                nullable: false,
                default: "1",
                is_pk: false,
                original_name: "quantity",
              },
            ],
            old_columns: live,
          },
        },
        title: "Edit Table",
        description: "Edit main.order_items",
        mode: "edit",
      },
      title: "Edit Table",
    } as any;
    seedFormTab(tab);
    render(<TableForm connectionId="c1" tab={tab} />);

    // The refusal is legible in the editor itself, not only as a queue error.
    const banner = await screen.findByTestId("rebuild-refusal");
    expect(banner.textContent).toContain("idx_order_items_product_id");
    expect(screen.getByRole("button", { name: "Stage" })).toBeDisabled();
    expect(useDbViewerStore.getState().changesQueue).toHaveLength(0);

    // …and the question included the columns about to be staged, so the answer
    // is about this submission rather than the live table in general.
    const calls = (cmd.getTableRebuildReadiness as any).mock.calls;
    expect(calls[calls.length - 1][3]).toEqual([
      expect.objectContaining({ name: "quantity", type: "TEXT" }),
    ]);
  });

  it("a SQLite ALTER-only edit shows no rebuild refusal", async () => {
    (cmd.getTableRebuildReadiness as any).mockResolvedValue({ ok: true, reasons: [] });
    const tab = {
      id: "t1",
      form: {
        kind: "table",
        params: {
          schema: "main",
          name: "users",
          action: {
            op: "edit",
            columns: [
              { name: "id", type: "INTEGER", nullable: true, default: null, is_pk: true, original_name: "id" },
              { name: "email", type: "TEXT", nullable: true, default: null, is_pk: false },
            ],
            old_columns: [
              { name: "id", type: "INTEGER", nullable: true, default: null, is_pk: true },
            ],
          },
        },
        title: "Edit Table",
        description: "Edit main.users",
        mode: "edit",
      },
      title: "Edit Table",
    } as any;
    seedFormTab(tab);
    render(<TableForm connectionId="c1" tab={tab} />);
    await waitFor(() =>
      expect(cmd.getTableRebuildReadiness).toHaveBeenCalled(),
    );
    expect(screen.queryByTestId("rebuild-refusal")).toBeNull();
    expect(screen.getByRole("button", { name: "Stage" })).not.toBeDisabled();
  });

  it("fixes schema to main and hides the schema picker", async () => {
    const tab = {
      id: "t1",
      form: {
        kind: "table",
        params: {
          schema: "public",
          name: "t",
          action: { op: "create", columns: [] },
        },
        title: "Create Table",
        description: "Create Table",
        mode: "create",
      },
      title: "Create Table",
    } as any;
    seedFormTab(tab);
    render(<TableForm connectionId="c1" tab={tab} />);
    expect(screen.queryByLabelText("Schema")).toBeNull();
    await waitFor(() => {
      expect((useDbViewerStore.getState().tabs[0].form?.params as any).schema).toBe("main");
    });
  });

  // --- Fail-closed rebuild guard (ticket 08 follow-up) ---

  function sqliteEditTab(columns: any[], oldColumnNames: string[]) {
    const oldColumns = oldColumnNames.map((name, i) => ({
      ...columns[i],
      original_name: name,
    }));
    return {
      id: "t1",
      form: {
        kind: "table",
        params: {
          schema: "main",
          name: "order_items",
          action: { op: "edit", columns, old_columns: oldColumns },
        },
        title: "Edit Table",
        description: "Edit main.order_items",
        mode: "edit",
      },
      title: "Edit Table",
    } as any;
  }

  it("sends every required SQLite column field, falsy or not", async () => {
    // `SqliteColumn` requires `auto_increment` and `unique` (no serde default),
    // so a payload that omits them for falsy values does not deserialize — the
    // bug that made this guard fail open in the built app.
    render(
      <TableForm
        connectionId="c1"
        tab={sqliteEditTab(
          [
            { name: "order_id", type: "INTEGER", nullable: false, default: null, is_pk: true, original_name: "order_id" },
            { name: "product_id", type: "INTEGER", nullable: false, default: null, is_pk: true, original_name: "product_id" },
          ],
          ["order_id", "product_id"],
        )}
      />,
    );
    await waitFor(() => expect(cmd.getTableRebuildReadiness).toHaveBeenCalled());

    const proposed = (cmd.getTableRebuildReadiness as any).mock.calls.at(-1)[3];
    expect(proposed).toHaveLength(2);
    for (const column of proposed) {
      // own properties, not `undefined` defaults: JSON.stringify drops the key
      // for `undefined`, and the backend then answers "missing field".
      expect(Object.prototype.hasOwnProperty.call(column, "auto_increment")).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(column, "unique")).toBe(true);
      expect(column.auto_increment).toBe(false);
      expect(column.unique).toBe(false);
      expect(column).toMatchObject({
        name: expect.any(String),
        type: expect.any(String),
        nullable: expect.any(Boolean),
        is_pk: expect.any(Boolean),
      });
      // What the IPC layer actually puts on the wire.
      expect(JSON.parse(JSON.stringify(column))).toMatchObject({
        auto_increment: false,
        unique: false,
      });
    }

    // …and the DDL payload staged through the same projection is complete too.
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));
    await waitFor(() => expect(cmd.buildObjectDdl).toHaveBeenCalled());
    const staged = (cmd.buildObjectDdl as any).mock.calls.at(-1)[2].action.columns;
    for (const column of staged) {
      expect(JSON.parse(JSON.stringify(column))).toMatchObject({
        auto_increment: false,
        unique: false,
      });
    }
  });

  it("a readiness probe that fails is visible and blocks staging", async () => {
    (cmd.getTableRebuildReadiness as any).mockRejectedValue(
      new Error("missing field `auto_increment`"),
    );
    render(
      <TableForm
        connectionId="c1"
        tab={sqliteEditTab(
          [
            { name: "order_id", type: "INTEGER", nullable: false, default: null, is_pk: true, original_name: "order_id" },
            { name: "quantity", type: "INTEGER", nullable: false, default: null, is_pk: false, original_name: "quantity" },
          ],
          ["order_id", "quantity"],
        )}
      />,
    );

    // A guard that could not run is reported, never read as "no refusal".
    const failure = await screen.findByTestId("rebuild-readiness-error");
    expect(failure.textContent).toContain("missing field `auto_increment`");
    expect(screen.queryByTestId("rebuild-refusal")).toBeNull();
    expect(screen.getByRole("button", { name: "Stage" })).toBeDisabled();
    // Nothing reached the changes queue.
    expect(useDbViewerStore.getState().changesQueue).toHaveLength(0);
  });

  it("holds the submission while the readiness answer is still pending", async () => {
    let resolve: (value: unknown) => void = () => {};
    (cmd.getTableRebuildReadiness as any).mockImplementation(
      () => new Promise((r) => { resolve = r; }),
    );
    render(
      <TableForm
        connectionId="c1"
        tab={sqliteEditTab(
          [
            { name: "order_id", type: "INTEGER", nullable: false, default: null, is_pk: true, original_name: "order_id" },
            { name: "note", type: "TEXT", nullable: true, default: null, is_pk: false, original_name: "note" },
          ],
          ["order_id", "note"],
        )}
      />,
    );
    await waitFor(() => expect(cmd.getTableRebuildReadiness).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Stage" })).toBeDisabled();

    // The answer arrives and permits the edit: only now may it be staged.
    resolve({ ok: true, reasons: [] });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stage" })).not.toBeDisabled(),
    );
    expect(screen.queryByTestId("rebuild-readiness-error")).toBeNull();
  });
});