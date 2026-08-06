import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TableForm } from "./TableForm";
import { useDbViewerStore } from "../../../stores/dbViewerStore";
import * as cmd from "../../../lib/commands";

beforeEach(() => {
  useDbViewerStore.getState().reset();
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
  it("add/remove rows and multi-column PK", () => {
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
    expect((useDbViewerStore.getState().tabs[0].form?.params.action as any).columns).toHaveLength(2);
    // toggle PK on both → multi-col PK survives (both is_pk true)
    const pks = screen.getAllByLabelText(/PK/i);
    fireEvent.click(pks[0]);
    fireEvent.click(pks[1]);
    expect(
      (useDbViewerStore.getState().tabs[0].form?.params.action as any).columns.filter((c: any) => c.is_pk),
    ).toHaveLength(2);
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

  it("create-mode grid renders the redesigned header and constraint checkboxes", () => {
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
    expect(screen.getByText("Constraints")).toBeInTheDocument();
    expect(screen.getAllByLabelText("PK").length).toBe(2);
    expect(screen.getAllByLabelText("Auto-Increment").length).toBe(2);
    expect(screen.getAllByLabelText("Unique").length).toBe(2);
    // Nullable is hidden on the PK column (id) and shown on the non-PK one (sku)
    const nullableBoxes = screen.getAllByLabelText("Nullable");
    expect(nullableBoxes).toHaveLength(1);
    expect((nullableBoxes[0] as HTMLInputElement).checked).toBe(true); // sku is nullable
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
    fireEvent.click(screen.getByLabelText("Auto-Increment"));
    await waitFor(() => {
      expect((useDbViewerStore.getState().tabs[0].form?.params.action as any).columns[0].auto_increment).toBe(true);
    });
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));
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
    const uniqueBoxes = screen.getAllByLabelText("Unique");
    fireEvent.click(uniqueBoxes[1]);
    await waitFor(() => {
      expect((useDbViewerStore.getState().tabs[0].form?.params.action as any).columns[1].unique).toBe(true);
    });
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));
    await waitFor(() => expect(cmd.buildObjectDdl).toHaveBeenCalled());
    const calls = (cmd.buildObjectDdl as any).mock.calls;
    const stageCall = calls.find((call: any) => call[2].action.columns.some((c: any) => c.name === "sku" && c.unique === true));
    expect(stageCall).toBeTruthy();
    expect(stageCall[2].action.columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "sku", unique: true })]),
    );
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
    fireEvent.click(fkButtons[1]);
    expect(await screen.findByText("Foreign key")).toBeInTheDocument();
    const local = screen.getByLabelText("Column") as HTMLSelectElement;
    expect(local.value).toBe("category_id");
  });
});