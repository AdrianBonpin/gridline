import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangesQueuePanel } from "./ChangesQueuePanel";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useUiStore } from "../../stores/uiStore";
import * as commands from "../../lib/commands";

describe("ChangesQueuePanel", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
    useUiStore.setState({ activeConnectionId: "c1" });
    vi.resetAllMocks();
  });

  it("shows nothing when queue is empty", () => {
    const { container } = render(<ChangesQueuePanel />);
    expect(container.textContent).toBe("");
  });

  it("shows the pending-changes header and a change card", () => {
    useDbViewerStore.getState().addChange({
      type: "update",
      schema: "public",
      table: "users",
      primaryKey: { id: 1 },
      oldData: { name: "Bob" },
      newData: { name: "Alice" },
      description: "Update row in users",
    } as any);
    render(<ChangesQueuePanel />);
    expect(screen.getByText(/pending changes/i)).toBeInTheDocument();
    expect(screen.getByText(/update/i)).toBeInTheDocument();
    expect(screen.getByText(/public.users/i)).toBeInTheDocument();
  });

  it("shows the old → new value diff on update cards", () => {
    useDbViewerStore.getState().addChange({
      type: "update",
      schema: "public",
      table: "users",
      primaryKey: { id: 1 },
      oldData: { name: "Bob" },
      newData: { name: "Alice" },
      description: "Update row in users",
    } as any);
    render(<ChangesQueuePanel />);
    // the diff renders old (struck) → new (accent) as separate spans
    expect(screen.getByText(/name: Bob/)).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("revert removes the change from the queue", async () => {
    const user = userEvent.setup();
    useDbViewerStore.getState().addChange({
      type: "update",
      schema: "public",
      table: "users",
      primaryKey: { id: 1 },
      oldData: { name: "Bob" },
      newData: { name: "Alice" },
      description: "Update row in users",
    } as any);
    render(<ChangesQueuePanel />);
    await user.click(screen.getByRole("button", { name: /revert/i }));
    expect(useDbViewerStore.getState().changesQueue).toHaveLength(0);
  });

  it("labels bulk_insert / empty_table / drop_table cards", () => {
    useDbViewerStore.getState().addChange({
      type: "bulk_insert",
      schema: "public",
      table: "t",
      columns: ["a"],
      rows: [[1]],
      description: "Import 2 rows into public.t",
    } as any);
    useDbViewerStore.getState().addChange({
      type: "empty_table",
      schema: "public",
      table: "t",
      description: "Empty Table: public.t",
    } as any);
    useDbViewerStore.getState().addChange({
      type: "drop_table",
      schema: "public",
      table: "t",
      description: "Drop Table: public.t",
    } as any);
    render(<ChangesQueuePanel />);
    expect(screen.getByText(/import 2 rows into public.t/i)).toBeInTheDocument();
    expect(screen.getByText(/empty table: public.t/i)).toBeInTheDocument();
    expect(screen.getByText(/drop table: public.t/i)).toBeInTheDocument();
  });

  it("renders a ddl change with a DDL badge + description (visual) and SQL preview (sql view)", async () => {
    const user = userEvent.setup();
    useDbViewerStore.getState().addChange({
      type: "ddl",
      sql: "DROP INDEX public.i",
      description: "Drop index i",
    } as any);
    render(<ChangesQueuePanel />);
    expect(screen.getByText("DDL")).toBeInTheDocument();
    expect(screen.getByText("Drop index i")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /sql/i }));
    expect(screen.getByText(/DROP INDEX public\.i/)).toBeInTheDocument();
  });

  it("commit calls executeChange with buildChangePayload output for insert", async () => {
    const exec = vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
    useDbViewerStore.getState().addChange({
      type: "insert",
      schema: "public",
      table: "t",
      newData: { id: 1, name: "Alice" },
      description: "Insert row into t",
    });
    render(<ChangesQueuePanel />);
    fireEvent.click(screen.getByRole("button", { name: /commit all/i }));
    await waitFor(() => expect(exec).toHaveBeenCalled());
    expect(exec.mock.calls[0][0]).toBe("c1");
    expect(exec.mock.calls[0][1]).toEqual(expect.objectContaining({
      type: "insert",
      schema: "public",
      table: "t",
      data: expect.any(String),
    }));
  });

  it("refreshes the schema tree after committing a drop_table change", async () => {
    vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
    const getSchemas = vi.spyOn(commands, "getSchemas").mockResolvedValue(["public"]);
    vi.spyOn(commands, "getDatabases").mockResolvedValue(["mydb"]);
    vi.spyOn(commands, "getTables").mockResolvedValue([] as any);
    useDbViewerStore.getState().addChange({
      type: "drop_table",
      schema: "public",
      table: "t",
      description: "Drop Table: public.t",
    });
    render(<ChangesQueuePanel />);
    fireEvent.click(screen.getByRole("button", { name: /commit all/i }));
    await waitFor(() => expect(getSchemas).toHaveBeenCalledWith("c1"));
  });

  it("SQL toggle shows the generated SQL", async () => {
    const user = userEvent.setup();
    useDbViewerStore.getState().addChange({
      type: "insert",
      schema: "public",
      table: "users",
      newData: { name: "Alice" },
      description: "Insert row into users",
    } as any);
    render(<ChangesQueuePanel />);
    await user.click(screen.getByRole("button", { name: /sql/i }));
    expect(screen.getByText(/insert into "public"."users"/i)).toBeInTheDocument();
  });

  it("Cmd+S commits all pending changes", async () => {
    const exec = vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
    useDbViewerStore.getState().addChange({
      type: "insert",
      schema: "public",
      table: "t",
      newData: { a: 1 },
      description: "Insert row into t",
    } as any);
    render(<ChangesQueuePanel />);
    fireEvent.keyDown(document, { key: "s", metaKey: true });
    await waitFor(() => expect(exec).toHaveBeenCalled());
  });

  it("Clear All empties the queue", async () => {
    const user = userEvent.setup();
    useDbViewerStore.getState().addChange({
      type: "insert",
      schema: "public",
      table: "t",
      newData: { a: 1 },
      description: "Insert row into t",
    } as any);
    render(<ChangesQueuePanel />);
    await user.click(screen.getByRole("button", { name: /clear all/i }));
    expect(useDbViewerStore.getState().changesQueue).toHaveLength(0);
  });

  it("calls onCommitted after a successful commit cycle", async () => {
    const onCommitted = vi.fn();
    vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
    useDbViewerStore.getState().addChange({
      type: "insert",
      schema: "public",
      table: "t",
      newData: { a: 1 },
      description: "Insert row into t",
    } as any);
    render(<ChangesQueuePanel onCommitted={onCommitted} />);
    fireEvent.click(screen.getByRole("button", { name: /commit all/i }));
    await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
  });

  it("shows a green check on committed changes after Commit All", async () => {
    vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
    useDbViewerStore.getState().addChange({ type: "insert", schema: "public", table: "t", newData: { a: 1 }, description: "Insert row into t" } as any);
    render(<ChangesQueuePanel />);
    fireEvent.click(screen.getByRole("button", { name: /commit all/i }));
    await waitFor(() => expect(screen.getByTitle("Committed")).toBeInTheDocument());
  });

  it("auto-closes tabs for a table dropped via Commit All", async () => {
    vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
    useDbViewerStore.getState().openTab("public", "users");
    useDbViewerStore.getState().openTab("public", "posts", true);
    useDbViewerStore.getState().addChange({ type: "drop_table", schema: "public", table: "users", description: "Drop Table: public.users" } as any);
    render(<ChangesQueuePanel />);
    fireEvent.click(screen.getByRole("button", { name: /commit all/i }));
    await waitFor(() => {
      const tabs = useDbViewerStore.getState().tabs;
      expect(tabs.some((t) => t.table === "users")).toBe(false);
      expect(tabs.some((t) => t.table === "posts")).toBe(true);
    });
  });

  it("renders a rebuild_table change with an amber REBUILD badge and SQL preview", () => {
    useDbViewerStore.getState().addChange({
      type: "rebuild_table",
      schema: "public",
      table: "users",
      sql: "BEGIN; ALTER TABLE \"public\".\"users\" ...; COMMIT;",
      description: "Rebuild public.users",
    } as any);
    render(<ChangesQueuePanel />);
    expect(screen.getByText("REBUILD")).toBeInTheDocument();
    expect(screen.getByText(/rebuild public\.users/i)).toBeInTheDocument();
    expect(screen.getByText(/BEGIN;/)).toBeInTheDocument();
  });
});