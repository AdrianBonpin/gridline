import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangesQueuePanel } from "./ChangesQueuePanel";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useUiStore } from "../../stores/uiStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import * as commands from "../../lib/commands";
import type { Connection } from "../../lib/types";

function savedConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "c1",
    name: "Local dev",
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    username: "dev",
    database: "appdb",
    folder_id: null,
    keychain_ref: null,
    tag_ids: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    favorite: false,
    ...overrides,
  };
}

/** Make `overrides` the active Change Origin: saved connection + selected database. */
function activateTarget(overrides: Partial<Connection> = {}, database = "appdb") {
  const connection = savedConnection(overrides);
  useConnectionStore.setState({ connections: [connection] });
  useUiStore.setState({ activeConnectionId: connection.id });
  useDbViewerStore.setState({ currentDatabase: database });
}

/** Every message the UI surfaced through the notification store. */
function notifications(): string {
  return useNotificationStore
    .getState()
    .notifications.map((n) => n.message)
    .join(" | ");
}

describe("ChangesQueuePanel", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
    useConnectionStore.setState({ connections: [] });
    useNotificationStore.setState({ notifications: [] });
    activateTarget();
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
    // The backend revalidates the origin itself, so the request must carry it.
    const origin = exec.mock.calls[0][2];
    expect(origin).toEqual(
      expect.objectContaining({
        connectionId: "c1",
        database: "appdb",
        target: expect.any(String),
      }),
    );
    expect(origin.target.length).toBeGreaterThan(0);
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

  it("refreshes the schema tree after committing a schema-modifying ddl change", async () => {
    vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
    const getSchemas = vi.spyOn(commands, "getSchemas").mockResolvedValue(["public"]);
    vi.spyOn(commands, "getDatabases").mockResolvedValue(["mydb"]);
    vi.spyOn(commands, "getTables").mockResolvedValue([] as any);
    useDbViewerStore.getState().addChange({
      type: "ddl",
      schema: "public",
      table: "products",
      sql: 'CREATE TABLE "public"."products" ("id" integer NOT NULL)',
      description: "Create Table",
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

  it("Cmd+S does not commit while a text field is being edited", async () => {
    const exec = vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
    useDbViewerStore.getState().addChange({
      type: "insert",
      schema: "public",
      table: "t",
      newData: { a: 1 },
      description: "Insert row into t",
    } as any);
    render(<ChangesQueuePanel />);

    // The user is typing in a cell editor / filter box: the commit shortcut
    // must not reach a durable write.
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "s", metaKey: true });

    await act(async () => {});
    expect(exec).not.toHaveBeenCalled();
    expect(useDbViewerStore.getState().changesQueue[0].status).toBe("pending");
  });

  it("Cmd+S does not commit while a modal is open", async () => {
    const exec = vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
    useDbViewerStore.getState().addChange({
      type: "insert",
      schema: "public",
      table: "t",
      newData: { a: 1 },
      description: "Insert row into t",
    } as any);
    const { rerender } = render(
      <>
        <ChangesQueuePanel />
        <ConfirmDialog open title="Delete?" message="Are you sure?" onConfirm={vi.fn()} onCancel={vi.fn()} />
      </>,
    );

    fireEvent.keyDown(document, { key: "s", metaKey: true });
    await act(async () => {});
    expect(exec).not.toHaveBeenCalled();

    // Once the modal is gone the shortcut works again.
    rerender(<ChangesQueuePanel />);
    fireEvent.keyDown(document, { key: "s", metaKey: true });
    await waitFor(() => expect(exec).toHaveBeenCalledTimes(1));
  });

  it("registers the commit shortcut once across re-renders", async () => {
    const exec = vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
    useDbViewerStore.getState().addChange({
      type: "insert",
      schema: "public",
      table: "t",
      newData: { a: 1 },
      description: "Insert row into t",
    } as any);
    const { rerender } = render(<ChangesQueuePanel onCommitted={vi.fn()} />);
    // A parent re-render hands down a fresh callback identity; a leaked
    // listener would commit the same change twice.
    for (let tick = 0; tick < 4; tick += 1) {
      rerender(<ChangesQueuePanel onCommitted={vi.fn()} />);
    }

    fireEvent.keyDown(document, { key: "s", metaKey: true });

    await waitFor(() => expect(exec).toHaveBeenCalled());
    await act(async () => {});
    expect(exec).toHaveBeenCalledTimes(1);
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

  it("exposes a stable Commit All anchor for the desktop E2E harness", async () => {
    vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
    useDbViewerStore.getState().addChange({ type: "insert", schema: "public", table: "t", newData: { a: 1 }, description: "Insert row into t" } as any);
    render(<ChangesQueuePanel />);
    const commit = screen.getByTestId("commit-all");
    // The harness clicks exactly this element; it must stay a button.
    expect(commit.tagName).toBe("BUTTON");
    fireEvent.click(commit);
    await waitFor(() => expect(useDbViewerStore.getState().changesQueue[0].status).toBe("committed"));
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

  // ─── Change Origin scoping (ticket 04) ───────────────────────

  it("stamps every staged change with the active Change Origin", () => {
    useDbViewerStore.getState().addChange({
      type: "insert",
      schema: "public",
      table: "t",
      newData: { a: 1 },
      description: "Insert row into t",
    } as any);

    const [change] = useDbViewerStore.getState().changesQueue;
    expect(change.origin).toMatchObject({ connectionId: "c1", database: "appdb" });
    expect(change.origin?.target).toBeTruthy();
  });

  it("hides another origin's pending work from the panel and from Commit All", async () => {
    const exec = vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
    useDbViewerStore.getState().addChange({
      type: "insert",
      schema: "public",
      table: "t",
      newData: { a: 1 },
      description: "Insert row into t",
    } as any);

    // Switch to a different saved connection while the work is pending.
    act(() => activateTarget({ id: "c2", host: "other.example.com" }, "appdb"));
    render(<ChangesQueuePanel />);

    expect(screen.queryByTestId("commit-all")).not.toBeInTheDocument();
    expect(screen.queryByText(/insert row into t/i)).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "s", metaKey: true });
    await waitFor(() => expect(useDbViewerStore.getState().changesQueue[0].status).toBe("pending"));
    expect(exec).not.toHaveBeenCalled();
  });

  it("hides another database's pending work under the same connection", () => {
    useDbViewerStore.getState().addChange({
      type: "insert",
      schema: "public",
      table: "t",
      newData: { a: 1 },
      description: "Insert row into t",
    } as any);

    // Mount control: the panel DOES render this work for its own database, so the
    // absence below is the database filter, not a component that renders nothing.
    render(<ChangesQueuePanel />);
    expect(screen.getByTestId("commit-all")).toHaveTextContent("Commit All (1)");
    expect(screen.getByText("Pending Changes")).toBeInTheDocument();

    act(() => activateTarget({}, "analytics"));
    expect(screen.queryByTestId("commit-all")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending Changes")).not.toBeInTheDocument();
    // Hidden, never dropped: the change stays staged for its own database.
    expect(useDbViewerStore.getState().changesQueue).toHaveLength(1);

    // …and it comes back, unchanged, when the viewer returns to that database.
    act(() => activateTarget({}, "appdb"));
    expect(screen.getByTestId("commit-all")).toHaveTextContent("Commit All (1)");
    expect(screen.getByText("Pending Changes")).toBeInTheDocument();
  });

  it("restores the original connection's pending queue unchanged when returning to it", async () => {
    useDbViewerStore.getState().addChange({
      type: "update",
      schema: "public",
      table: "t",
      primaryKey: { id: 1 },
      oldData: { a: 1 },
      newData: { a: 2 },
      description: "Edit one",
    } as any);
    useDbViewerStore.getState().addChange({
      type: "delete",
      schema: "public",
      table: "t",
      primaryKey: { id: 2 },
      description: "Delete two",
    } as any);
    const staged = useDbViewerStore
      .getState()
      .changesQueue.map((c) => ({ id: c.id, origin: c.origin, status: c.status }));

    render(<ChangesQueuePanel />);
    expect(screen.getByTestId("commit-all")).toHaveTextContent("Commit All (2)");

    act(() => activateTarget({ id: "c2", host: "other.example.com" }));
    await waitFor(() =>
      expect(screen.queryByTestId("commit-all")).not.toBeInTheDocument(),
    );

    act(() => activateTarget());
    await waitFor(() =>
      expect(screen.getByTestId("commit-all")).toHaveTextContent("Commit All (2)"),
    );
    expect(
      useDbViewerStore
        .getState()
        .changesQueue.map((c) => ({ id: c.id, origin: c.origin, status: c.status })),
    ).toEqual(staged);
  });

  it("surfaces a stale-row conflict and reports nothing was committed", async () => {
    // The backend refuses a write whose original value another session already
    // changed. The queue must show that conflict verbatim and never present the
    // change as applied.
    vi.spyOn(commands, "executeChange").mockRejectedValue(
      new Error(
        'row conflict: column "name" changed in another session; nothing was written',
      ),
    );
    const onCommitted = vi.fn();
    useDbViewerStore.getState().addChange({
      type: "update",
      schema: "public",
      table: "users",
      primaryKey: { id: 1 },
      oldData: { name: "Alice" },
      newData: { name: "Alicia" },
      description: "Edit users",
    });

    render(<ChangesQueuePanel onCommitted={onCommitted} />);
    fireEvent.click(screen.getByTestId("commit-all"));

    await waitFor(() =>
      expect(useDbViewerStore.getState().changesQueue[0].status).toBe("failed"),
    );
    expect(useDbViewerStore.getState().changesQueue[0].error).toMatch(/row conflict/);
    // The conflict is visible on the card and in the commit report…
    expect(screen.getByText(/row conflict: column "name" changed/i)).toBeInTheDocument();
    expect(notifications()).toMatch(/row conflict: column "name" changed/i);
    expect(notifications()).toMatch(/nothing was written/i);
    // …and no tab is refreshed as if it had committed.
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it("stops at an ambiguous-match failure instead of committing later changes", async () => {
    const exec = vi
      .spyOn(commands, "executeChange")
      .mockRejectedValueOnce(new Error("ambiguous row match: 2 rows matched the row identity; nothing was written"))
      .mockResolvedValue(undefined);
    for (const label of ["Delete A", "Delete B"]) {
      useDbViewerStore.getState().addChange({
        type: "delete",
        schema: "public",
        table: "t",
        primaryKey: { id: label },
        description: label,
      });
    }

    render(<ChangesQueuePanel />);
    fireEvent.click(screen.getByTestId("commit-all"));

    await waitFor(() =>
      expect(useDbViewerStore.getState().changesQueue.map((c) => c.status)).toEqual([
        "failed",
        "pending",
      ]),
    );
    expect(exec).toHaveBeenCalledTimes(1);
    expect(notifications()).toMatch(/ambiguous row match/i);
    expect(notifications()).toMatch(/committed 0 of 2/i);
  });

  it("refuses Commit All when the saved connection was retargeted after staging", async () => {
    const exec = vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
    useDbViewerStore.getState().addChange({
      type: "insert",
      schema: "public",
      table: "t",
      newData: { a: 1 },
      description: "Insert row into t",
    } as any);

    // Same connection id, same database, different target (host moved).
    act(() => activateTarget({ host: "new.example.com" }));
    render(<ChangesQueuePanel />);
    fireEvent.click(screen.getByTestId("commit-all"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/staged against/i);
    expect(alert.textContent).toMatch(/localhost:5432/);
    expect(alert.textContent).toMatch(/now targets/i);
    expect(alert.textContent).toMatch(/new\.example\.com:5432/);
    expect(notifications()).toMatch(/new\.example\.com:5432/);
    expect(exec).not.toHaveBeenCalled();
    expect(useDbViewerStore.getState().changesQueue[0].status).toBe("pending");
  });

  it("commits each change with the origin recorded at staging time, not one recomputed at commit", async () => {
    const exec = vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
    useDbViewerStore.getState().addChange({
      type: "insert",
      schema: "public",
      table: "t",
      newData: { a: 1 },
      description: "Insert row into t",
    } as any);
    const staged = useDbViewerStore.getState().changesQueue[0].origin;
    expect(staged).not.toBeNull();

    render(<ChangesQueuePanel />);
    fireEvent.click(screen.getByTestId("commit-all"));

    await waitFor(() => expect(exec).toHaveBeenCalledTimes(1));
    // The backend compares the origin it is GIVEN with the saved connection. A
    // freshly computed origin would make that comparison tautological — the
    // renderer would be deciding which target the staged write belongs to. The
    // request must carry the value captured at staging time.
    expect(exec.mock.calls[0][2]).toBe(staged);
    expect(exec.mock.calls[0][2].target).toBe(staged!.target);
  });

  it("applies changes in order, stops at the first failure, and reports the count and the failure", async () => {
    const exec = vi
      .spyOn(commands, "executeChange")
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("duplicate key value violates unique constraint"))
      .mockResolvedValue(undefined);
    for (const label of ["Insert A", "Insert B", "Insert C"]) {
      useDbViewerStore.getState().addChange({
        type: "insert",
        schema: "public",
        table: "t",
        newData: { a: label },
        description: label,
      } as any);
    }

    render(<ChangesQueuePanel />);
    fireEvent.click(screen.getByTestId("commit-all"));

    await waitFor(() =>
      expect(useDbViewerStore.getState().changesQueue.map((c) => c.status)).toEqual([
        "committed",
        "failed",
        "pending",
      ]),
    );
    // Ordered application, and nothing after the failure is attempted.
    expect(exec).toHaveBeenCalledTimes(2);
    expect(
      exec.mock.calls.map(([, payload]) => (payload as { data?: string }).data),
    ).toEqual([
      expect.stringContaining("Insert A"),
      expect.stringContaining("Insert B"),
    ]);

    const report = notifications();
    expect(report).toMatch(/committed 1 of 3/i);
    expect(report).toMatch(/Insert B/);
    expect(report).toMatch(/duplicate key value/i);
    // The failed card itself carries the reason, not just an icon.
    expect(screen.getByText(/duplicate key value/i)).toBeInTheDocument();
  });

  it("never claims an all-or-nothing rollback after a partial commit", async () => {
    vi.spyOn(commands, "executeChange")
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("permission denied for table t"));
    for (const label of ["Insert A", "Insert B"]) {
      useDbViewerStore.getState().addChange({
        type: "insert",
        schema: "public",
        table: "t",
        newData: { a: label },
        description: label,
      } as any);
    }

    render(<ChangesQueuePanel />);
    fireEvent.click(screen.getByTestId("commit-all"));

    await waitFor(() => expect(notifications()).toMatch(/permission denied for table t/));
    expect(document.body.textContent).not.toMatch(/roll(ed)?\s*back/i);
    expect(notifications()).not.toMatch(/roll(ed)?\s*back/i);
    expect(notifications()).toMatch(/committed 1 of 2/i);
  });

  it("Clear All leaves other origins' pending work intact", async () => {
    const user = userEvent.setup();
    useDbViewerStore.getState().addChange({ type: "insert", schema: "public", table: "t", newData: { a: 1 }, description: "Here" } as any);
    act(() => activateTarget({ id: "c2", host: "other.example.com" }));
    useDbViewerStore.getState().addChange({ type: "insert", schema: "public", table: "t", newData: { a: 2 }, description: "Elsewhere" } as any);
    act(() => activateTarget());

    render(<ChangesQueuePanel />);
    await user.click(screen.getByRole("button", { name: /clear all/i }));

    const remaining = useDbViewerStore.getState().changesQueue;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].description).toBe("Elsewhere");
  });
});

describe("ChangesQueuePanel commit contract", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
    useNotificationStore.setState({ notifications: [] });
    activateTarget();
    vi.resetAllMocks();
  });

  it("hands the viewer exactly the committed changes and their origin", async () => {
    vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
    const onCommitted = vi.fn();
    useDbViewerStore.getState().addChange({
      type: "update",
      schema: "public",
      table: "users",
      primaryKey: { id: 1 },
      oldData: { name: "Alice" },
      newData: { name: "Alicia" },
      description: "Edit users",
    });
    useDbViewerStore.getState().addChange({
      type: "update",
      schema: "public",
      table: "posts",
      primaryKey: { id: 2 },
      oldData: { title: "a" },
      newData: { title: "b" },
      description: "Edit posts",
    });

    render(<ChangesQueuePanel onCommitted={onCommitted} />);
    fireEvent.click(screen.getByRole("button", { name: /commit all/i }));

    await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
    const [committed, origin] = onCommitted.mock.calls[0];
    // Every affected table is reported, so the viewer can refresh every tab.
    expect(committed.map((c: { table: string }) => c.table)).toEqual([
      "users",
      "posts",
    ]);
    expect(origin.connectionId).toBe("c1");
    expect(origin.database).toBe("appdb");
  });

  it("reports only the changes that actually committed before a failure", async () => {
    vi.spyOn(commands, "executeChange")
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("boom"));
    const onCommitted = vi.fn();
    useDbViewerStore.getState().addChange({
      type: "update",
      schema: "public",
      table: "users",
      primaryKey: { id: 1 },
      oldData: { name: "Alice" },
      newData: { name: "Alicia" },
    });
    useDbViewerStore.getState().addChange({
      type: "update",
      schema: "public",
      table: "posts",
      primaryKey: { id: 2 },
      oldData: { title: "a" },
      newData: { title: "b" },
    });

    render(<ChangesQueuePanel onCommitted={onCommitted} />);
    fireEvent.click(screen.getByRole("button", { name: /commit all/i }));

    await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
    const [committed] = onCommitted.mock.calls[0];
    // The failed table is not refreshed as if it committed.
    expect(committed.map((c: { table: string }) => c.table)).toEqual(["users"]);
  });

  it("invalidates metadata caches after a schema-modifying commit", async () => {
    vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
    vi.spyOn(commands, "getDatabases").mockResolvedValue(["appdb"]);
    vi.spyOn(commands, "getSchemas").mockResolvedValue(["public"]);
    vi.spyOn(commands, "getTables").mockResolvedValue([] as any);
    useDbViewerStore.getState().addChange({
      type: "ddl",
      sql: "CREATE TABLE audit (id integer)",
      schema: "public",
      table: "audit",
      description: "Create table audit",
    });
    const before = useDbViewerStore.getState().metadataRev;

    render(<ChangesQueuePanel />);
    fireEvent.click(screen.getByRole("button", { name: /commit all/i }));

    await waitFor(() =>
      expect(useDbViewerStore.getState().metadataRev).toBeGreaterThan(before),
    );
  });
});
