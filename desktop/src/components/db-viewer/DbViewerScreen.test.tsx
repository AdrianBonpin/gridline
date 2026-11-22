import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import {
    DbViewerScreen,
    deriveStagedValues,
    derivePendingCellKeys,
    pickDisplayColumn,
} from "./DbViewerScreen";
import { useDbViewerStore, currentChangeOrigin } from "../../stores/dbViewerStore";
import { useUiStore } from "../../stores/uiStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useQueryStore } from "../../stores/queryStore";
import { useSettingsStore } from "../../stores/settingsStore";
import * as commands from "../../lib/commands";
import { rowSelectionKey } from "../../lib/rowSelection";
import type { Connection } from "../../lib/types";

vi.mock("../../hooks/useDbConnection", () => ({
    useDbConnection: (_connectionId: string) => ({
        connectionError: null,
        connect: vi.fn(),
        passwordPromptOpen: false,
        submitPassword: vi.fn(),
        cancelPassword: vi.fn(),
    }),
}));

vi.mock("@tanstack/react-virtual", () => ({
    useVirtualizer: ({ count }: any) => ({
        getVirtualItems: () =>
            count > 0
                ? Array.from({ length: count }, (_, i) => ({
                      key: i,
                      index: i,
                      start: i * 36,
                      size: 36,
                  }))
                : [],
        getTotalSize: () => count * 36,
        measureElement: () => {},
    }),
}));

const { registeredActions } = vi.hoisted(() => ({
    registeredActions: [] as Array<{ run: () => void }>,
}));

// monaco-editor's global font re-measure — stub so jsdom stays light
vi.mock("monaco-editor", () => ({
    editor: { remeasureFonts: vi.fn() },
}));

vi.mock("@monaco-editor/react", async () => {
    const { useEffect } = await import("react");
    return {
        default: ({ value, onChange, onMount }: any) => {
            useEffect(() => {
                onMount?.({
                    addAction: (action: any) => registeredActions.push(action),
                    getValue: () => value,
                    setValue: (v: string) => onChange?.(v),
                    focus: () => {},
                });
                // eslint-disable-next-line react-hooks/exhaustive-deps
            }, []);
            return (
                <div data-testid="monaco-editor">
                    <textarea
                        data-testid="monaco-textarea"
                        value={value}
                        onChange={(e) => onChange?.(e.target.value)}
                    />
                </div>
            );
        },
    };
});

const mockQueryResult = {
    columns: [
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
    ],
    rows: [[1]],
    total_rows: 1,
    page: 1,
    page_size: 50,
    execution_time_ms: 42,
};

describe("DbViewerScreen", () => {
    beforeEach(() => {
        useDbViewerStore.getState().reset();
        // A saved connection record is what gives staged work its Change
        // Origin, so every test starts with "c1" active and resolved.
        useConnectionStore.setState({
            connections: [
                { id: "c1", name: "local", db_type: "postgresql", host: "localhost", port: 5432, username: "dev", database: "mydb", folder_id: null, keychain_ref: null, tag_ids: [], favorite: false, created_at: "", updated_at: "" },
            ] as Connection[],
        });
        useUiStore.setState({ activeConnectionId: "c1" });
        useDbViewerStore.setState({
            databases: ["mydb"],
            schemas: ["public"],
            tables: [
                { name: "users", schema: "public", table_type: "TABLE" },
            ],
            currentDatabase: "mydb",
            currentSchema: "public",
        });
        vi.resetAllMocks();
    });

    it("renders the sidebar", () => {
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        expect(screen.getByLabelText(/home/i)).toBeInTheDocument();
    });

    it("full flow: editing a cell shows the staged value + pending dot in the grid", async () => {
        const store = useDbViewerStore.getState();
        store.openTab("public", "users");
        const tabId = useDbViewerStore.getState().activeTabId!;
        store.setTabData(tabId, {
            columns: [
                { name: "id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: false, is_generated: false },
                { name: "name", data_type: "text", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
            ],
            rows: [[1, "Alice"]],
            total_rows: 1,
            page: 1,
            page_size: 50,
        } as any);
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        const cell = await waitFor(() => screen.getByText("Alice"));
        fireEvent.click(cell);
        fireEvent.keyDown(cell, { key: "Enter" });
        // the editor's textarea is the last textbox (toolbar filter input is first)
        const textboxes = screen.getAllByRole("textbox");
        const input = textboxes[textboxes.length - 1]!;
        fireEvent.change(input, { target: { value: "Alicia" } });
        fireEvent.keyDown(input, { key: "Enter" });
        // staged change carries the correct table (was the root-cause bug)
        const staged = useDbViewerStore.getState().changesQueue[0];
        expect(staged?.table).toBe("users");
        expect(staged?.schema).toBe("public");
        // grid cell shows the optimistic value + the pending outline (2nd match is the queue panel diff)
        await waitFor(() => {
            expect(screen.getAllByText("Alicia").length).toBeGreaterThanOrEqual(2);
        });
        expect(screen.getByTestId("pending-cell")).toBeInTheDocument();
        // committing the change clears the pending outline but keeps the value until refetch
        act(() => {
            useDbViewerStore
                .getState()
                .markChangeCommitted(
                    useDbViewerStore.getState().changesQueue[0].id,
                );
        });
        await waitFor(() => {
            expect(screen.queryByTestId("pending-cell")).toBeNull();
        });
        expect(screen.getAllByText("Alicia").length).toBeGreaterThanOrEqual(2);
        // clearing the queue clears the optimistic display
        act(() => {
            useDbViewerStore.getState().clearChanges();
        });
        await waitFor(() => {
            expect(screen.getByText("Alice")).toBeInTheDocument();
        });
        expect(screen.queryByText("Alicia")).toBeNull();
    });

    it("does not show another Change Origin's staged value in the grid", async () => {
        const store = useDbViewerStore.getState();
        store.openTab("public", "users");
        const tabId = useDbViewerStore.getState().activeTabId!;
        store.setTabData(tabId, {
            columns: [
                { name: "id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: false, is_generated: false },
                { name: "name", data_type: "text", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
            ],
            rows: [[1, "Alice"]],
            total_rows: 1,
            page: 1,
            page_size: 50,
        } as any);

        // Stage the edit while a *different* saved connection is active.
        useConnectionStore.setState({
            connections: [
                { id: "c1", name: "local", db_type: "postgresql", host: "localhost", port: 5432, username: "dev", database: "mydb", folder_id: null, keychain_ref: null, tag_ids: [], favorite: false, created_at: "", updated_at: "" },
                { id: "c2", name: "other", db_type: "postgresql", host: "other.example.com", port: 5432, username: "dev", database: "mydb", folder_id: null, keychain_ref: null, tag_ids: [], favorite: false, created_at: "", updated_at: "" },
            ] as Connection[],
        });
        useUiStore.setState({ activeConnectionId: "c2" });
        store.stageCellEdit({
            tabId,
            schema: "public",
            table: "users",
            primaryKey: { id: 1 },
            oldData: { name: "Alice" },
            newData: { name: "Alicia" },
        });

        // The c1 viewer renders under its own origin: the other origin's
        // staged value and pending marker must not appear.
        useUiStore.setState({ activeConnectionId: "c1" });
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
        expect(screen.queryByText("Alicia")).toBeNull();
        expect(screen.queryByTestId("pending-cell")).toBeNull();
    });

    it("stages a composite-key edit with every key column, not just the first", async () => {
        // order_items — the demo composite-PK table: two rows share order_id and
        // differ by product_id, so a single-column key would hit both.
        const store = useDbViewerStore.getState();
        store.openTab("main", "order_items");
        const tabId = useDbViewerStore.getState().activeTabId!;
        store.setTabData(tabId, {
            columns: [
                { name: "order_id", data_type: "INTEGER", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: false, is_generated: false },
                { name: "product_id", data_type: "INTEGER", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: false, is_generated: false },
                { name: "quantity", data_type: "INTEGER", is_nullable: false, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
            ],
            rows: [
                [1, 1, 2],
                [1, 3, 1],
            ],
            total_rows: 2,
            page: 1,
            page_size: 50,
        } as any);
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        const cells = await waitFor(() => screen.getAllByText("1"));
        // The second row's quantity cell (order 1, product 3).
        const target = cells[cells.length - 1]!;
        fireEvent.click(target);
        fireEvent.keyDown(target, { key: "Enter" });
        // quantity is an INTEGER cell: the editor renders a number input, which
        // has no "textbox" role — read the editor's own control.
        const editor = await waitFor(() => screen.getByTestId("cell-editor"));
        const input = editor.querySelector("input, textarea") as HTMLElement;
        fireEvent.change(input, { target: { value: "9" } });
        fireEvent.keyDown(input, { key: "Enter" });

        const staged = useDbViewerStore.getState().changesQueue[0];
        expect(staged?.type).toBe("update");
        expect(staged?.primaryKey).toEqual({ order_id: 1, product_id: 3 });
        // the sibling row (order 1, product 1) is not addressed by this change
        expect(staged?.primaryKey).not.toEqual({ order_id: 1 });
    });

    it("stages a no-PK edit against the backend row locator, never a displayed cell", async () => {
        useConnectionStore.setState({
            connections: [
                { id: "c1", name: "demo", db_type: "sqlite", host: "", port: null, username: null, folder_id: null, keychain_ref: null, tag_ids: [], favorite: false, created_at: "", updated_at: "" },
            ] as Connection[],
        });
        const store = useDbViewerStore.getState();
        store.openTab("main", "page_views");
        const tabId = useDbViewerStore.getState().activeTabId!;
        store.setTabData(tabId, {
            columns: [
                { name: "url", data_type: "TEXT", is_nullable: false, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
                { name: "session_id", data_type: "TEXT", is_nullable: false, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
            ],
            // page_views has no primary key: the backend appends `rowid` as a
            // trailing cell that is not a declared column.
            rows: [["/products", "sess-001", 17]],
            total_rows: 1,
            page: 1,
            page_size: 50,
        } as any);
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        const cell = await waitFor(() => screen.getByText("/products"));
        // The locator is never a rendered column…
        expect(screen.queryByText("rowid")).toBeNull();
        expect(screen.queryByText("17")).toBeNull();
        fireEvent.click(cell);
        fireEvent.keyDown(cell, { key: "Enter" });
        const editor = await waitFor(() => screen.getByTestId("cell-editor"));
        const input = editor.querySelector("input, textarea") as HTMLElement;
        fireEvent.change(input, { target: { value: "/products/2" } });
        fireEvent.keyDown(input, { key: "Enter" });

        const staged = useDbViewerStore.getState().changesQueue[0];
        expect(staged?.primaryKey).toEqual({ rowid: 17 });
    });

    it("deriveStagedValues maps queue updates to optimistic cell values", () => {
        const queue = [
            {
                id: "ch-1", type: "update" as const, sql: "", schema: "public", table: "users",
                primaryKey: { id: 1 }, oldData: { name: "Alice" }, newData: { name: "Alicia" },
                status: "pending" as const, createdAt: 0,
            },
        ];
        const rows: unknown[][] = [[1, "Alice"], [2, "Bob"]];
        const loc = (r: unknown[]) => ({ id: r[0] });
        expect(deriveStagedValues(queue as any, "public", "users", rows, loc)).toEqual({
            "0:name": "Alicia",
        });
    });

    it("deriveStagedValues ignores failed/other-table changes and handles NULL", () => {
        const queue = [
            {
                id: "ch-1", type: "update" as const, sql: "", schema: "public", table: "users",
                primaryKey: { id: 1 }, oldData: { name: "Alice" }, newData: { name: null },
                status: "pending" as const, createdAt: 0,
            },
            {
                id: "ch-2", type: "update" as const, sql: "", schema: "public", table: "orders",
                primaryKey: { id: 1 }, oldData: { x: 1 }, newData: { x: 2 },
                status: "pending" as const, createdAt: 0,
            },
            {
                id: "ch-3", type: "update" as const, sql: "", schema: "public", table: "users",
                primaryKey: { id: 1 }, oldData: { name: "Alice" }, newData: { name: "X" },
                status: "failed" as const, error: "boom", createdAt: 0,
            },
        ];
        const rows: unknown[][] = [[1, "Alice"]];
        const loc = (r: unknown[]) => ({ id: r[0] });
        expect(deriveStagedValues(queue as any, "public", "users", rows, loc)).toEqual({
            "0:name": null,
        });
    });

    it("derivePendingCellKeys only includes pending updates (dot clears on commit)", () => {
        const queue = [
            {
                id: "ch-1", type: "update" as const, sql: "", schema: "public", table: "users",
                primaryKey: { id: 1 }, oldData: { name: "Alice" }, newData: { name: "Alicia" },
                status: "pending" as const, createdAt: 0,
            },
            {
                id: "ch-2", type: "update" as const, sql: "", schema: "public", table: "users",
                primaryKey: { id: 2 }, oldData: { name: "Bob" }, newData: { name: "Bobby" },
                status: "committed" as const, createdAt: 0,
            },
        ];
        const rows: unknown[][] = [[1, "Alice"], [2, "Bob"]];
        const loc = (r: unknown[]) => ({ id: r[0] });
        expect(derivePendingCellKeys(queue as any, "public", "users", rows, loc)).toEqual({
            "0:name": true,
        });
    });

    it("renders the New Query button", () => {
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        expect(screen.getByRole("button", { name: /new query/i })).toBeInTheDocument();
    });

    it("opens a query tab when New Query is clicked", () => {
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
        expect(screen.getByRole("tab", { name: "Query" })).toBeInTheDocument();
    });

    it("renders the query editor inside a query tab", async () => {
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
        await waitFor(() => {
            expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
        });
        expect(screen.getByRole("button", { name: /run query/i })).toBeInTheDocument();
    });

    it("executes a non-destructive query when Run is clicked", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue({ result_sets: [mockQueryResult], notices: [], execution_time_ms: 42 } as any);
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
        const textarea = await waitFor(() =>
            screen.getByTestId("monaco-textarea"),
        );
        fireEvent.change(textarea, { target: { value: "SELECT 1" } });
        fireEvent.click(screen.getByRole("button", { name: /run query/i }));
        await waitFor(() =>
            expect(executeQuery).toHaveBeenCalledWith("c1", "SELECT 1", 1, 50),
        );
        // query variant toolbar shows the execution time from the result
        await waitFor(() => expect(screen.getByText("42.00ms")).toBeInTheDocument());
        expect(screen.getByLabelText(/execution time/i)).toBeInTheDocument();
    });

    it("shows a destructive-query confirmation dialog and executes on confirm", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue({
                result_sets: [{ columns: [], rows: [], total_rows: 0, page: 1, page_size: 50 }],
                notices: [],
                execution_time_ms: 42,
            } as any);
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
        const textarea = await waitFor(() =>
            screen.getByTestId("monaco-textarea"),
        );
        fireEvent.change(textarea, {
            target: { value: "DELETE FROM users" },
        });
        fireEvent.click(screen.getByRole("button", { name: /run query/i }));
        await waitFor(() => {
            expect(screen.getByText("Destructive Query")).toBeInTheDocument();
        });
        expect(executeQuery).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText("Execute"));
        await waitFor(() =>
            expect(executeQuery).toHaveBeenCalledWith(
                "c1",
                "DELETE FROM users",
                1,
                50,
            ),
        );
    });

    it("prompts when a later statement in the script is destructive (#50)", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue({
                result_sets: [{ columns: [], rows: [], total_rows: 0, page: 1, page_size: 50 }],
                notices: [],
                execution_time_ms: 42,
            } as any);
        render(
            <DbViewerScreen connectionId="c1" onHome={() => {}} onSettings={() => {}} />,
        );
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
        const textarea = await waitFor(() => screen.getByTestId("monaco-textarea"));
        fireEvent.change(textarea, {
            target: { value: "SELECT 1; DROP TABLE demo;" },
        });
        fireEvent.click(screen.getByRole("button", { name: /run query/i }));

        await waitFor(() => {
            expect(screen.getByText("Destructive Query")).toBeInTheDocument();
        });
        expect(executeQuery).not.toHaveBeenCalled();
        expect(screen.getByTestId("destructive-statement-detail")).toHaveTextContent(
            "Statement 2 of 2",
        );

        fireEvent.click(screen.getByText("Execute"));
        await waitFor(() =>
            expect(executeQuery).toHaveBeenCalledWith(
                "c1",
                "SELECT 1; DROP TABLE demo;",
                1,
                50,
            ),
        );
    });

    it("does not prompt for a read-only script with several statements", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue({
                result_sets: [{ columns: [], rows: [], total_rows: 0, page: 1, page_size: 50 }],
                notices: [],
                execution_time_ms: 42,
            } as any);
        render(
            <DbViewerScreen connectionId="c1" onHome={() => {}} onSettings={() => {}} />,
        );
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
        const textarea = await waitFor(() => screen.getByTestId("monaco-textarea"));
        fireEvent.change(textarea, {
            target: { value: "SELECT 1; SELECT 'DROP TABLE t';" },
        });
        fireEvent.click(screen.getByRole("button", { name: /run query/i }));

        await waitFor(() => expect(executeQuery).toHaveBeenCalled());
        expect(screen.queryByText("Destructive Query")).toBeNull();
    });

    it("refreshes the schema tree after a DDL query runs", async () => {
        vi.spyOn(commands, "executeQueryMulti").mockResolvedValue(
            { result_sets: [mockQueryResult], notices: [], execution_time_ms: 42 } as any,
        );
        const getSchemas = vi
            .spyOn(commands, "getSchemas")
            .mockResolvedValue(["public"]);
        vi.spyOn(commands, "getDatabases").mockResolvedValue(["mydb"]);
        vi.spyOn(commands, "getTables").mockResolvedValue([] as any);
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
        const textarea = await waitFor(() =>
            screen.getByTestId("monaco-textarea"),
        );
        fireEvent.change(textarea, {
            target: { value: "CREATE TABLE users_new (id INTEGER)" },
        });
        fireEvent.click(screen.getByRole("button", { name: /run query/i }));
        // CREATE is destructive -> confirm dialog appears -> click Execute
        await waitFor(() =>
            screen.getByRole("button", { name: /execute/i }),
        );
        fireEvent.click(screen.getByRole("button", { name: /execute/i }));
        await waitFor(() => expect(getSchemas).toHaveBeenCalledWith("c1"));
    });

    it("does not refresh the schema tree after a SELECT", async () => {
        vi.spyOn(commands, "executeQueryMulti").mockResolvedValue(
            { result_sets: [mockQueryResult], notices: [], execution_time_ms: 42 } as any,
        );
        const getSchemas = vi
            .spyOn(commands, "getSchemas")
            .mockResolvedValue(["public"]);
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
        const textarea = await waitFor(() =>
            screen.getByTestId("monaco-textarea"),
        );
        fireEvent.change(textarea, { target: { value: "SELECT 1" } });
        fireEvent.click(screen.getByRole("button", { name: /run query/i }));
        await waitFor(() => expect(commands.executeQueryMulti).toHaveBeenCalled());
        expect(getSchemas).not.toHaveBeenCalled();
    });

    it("formats the query SQL when Auto format is clicked", async () => {
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
        const textarea = await waitFor(() =>
            screen.getByTestId("monaco-textarea"),
        );
        fireEvent.change(textarea, {
            target: { value: "select * from users where id = 1" },
        });
        fireEvent.click(screen.getByRole("button", { name: /auto format/i }));
        await waitFor(() => {
            expect((textarea as HTMLTextAreaElement).value).toMatch(/\n/);
        });
    });

    it("runs the current query when the Cmd+Enter action fires", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue({ result_sets: [mockQueryResult], notices: [], execution_time_ms: 42 } as any);
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        registeredActions.length = 0;
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
        const textarea = await waitFor(() =>
            screen.getByTestId("monaco-textarea"),
        );
        fireEvent.change(textarea, {
            target: { value: "SELECT 42" },
        });
        expect(registeredActions).toHaveLength(1);
        registeredActions[0].run();
        await waitFor(() =>
            expect(executeQuery).toHaveBeenCalledWith("c1", "SELECT 42", 1, 50),
        );
    });

    it("shows the pulse while a query is running and hides it after", async () => {
        let resolveRun!: (v: unknown) => void;
        const pending = new Promise<unknown>((r) => {
            resolveRun = r;
        });
        vi.spyOn(commands, "executeQueryMulti").mockReturnValue(pending as any);
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
        const textarea = await waitFor(() =>
            screen.getByTestId("monaco-textarea"),
        );
        fireEvent.change(textarea, { target: { value: "SELECT 1" } });
        fireEvent.click(screen.getByRole("button", { name: /run query/i }));
        await waitFor(() =>
            expect(screen.getByTestId("query-run-pulse")).toBeInTheDocument(),
        );
        resolveRun({ result_sets: [mockQueryResult], notices: [], execution_time_ms: 42 });
        await waitFor(() =>
            expect(screen.queryByTestId("query-run-pulse")).toBeNull(),
        );
    });

    it("collapses and re-expands the query results via the caret", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue({ result_sets: [mockQueryResult], notices: [], execution_time_ms: 42 } as any);
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
        const textarea = await waitFor(() =>
            screen.getByTestId("monaco-textarea"),
        );
        fireEvent.change(textarea, { target: { value: "SELECT 1" } });
        fireEvent.click(screen.getByRole("button", { name: /run query/i }));
        await waitFor(() => expect(screen.getByText("42.00ms")).toBeInTheDocument());
        expect(screen.getByTestId("query-results")).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText(/hide results/i));
        expect(screen.queryByTestId("query-results")).toBeNull();
        expect(screen.queryByText("42.00ms")).toBeNull();

        fireEvent.click(screen.getByLabelText(/show results/i));
        expect(screen.getByTestId("query-results")).toBeInTheDocument();
        expect(executeQuery).toHaveBeenCalledTimes(1);
    });

    it("resizes the results panel with a drag handle, clamped to min/max", async () => {
        vi.spyOn(commands, "executeQueryMulti").mockResolvedValue(
            { result_sets: [mockQueryResult], notices: [], execution_time_ms: 42 } as any,
        );
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
        const textarea = await waitFor(() =>
            screen.getByTestId("monaco-textarea"),
        );
        fireEvent.change(textarea, { target: { value: "SELECT 1" } });
        fireEvent.click(screen.getByRole("button", { name: /run query/i }));
        await waitFor(() => expect(screen.getByText("42.00ms")).toBeInTheDocument());

        const results = screen.getByTestId("query-results");
        const initial = parseFloat(results.style.height);
        const handle = screen.getByTestId("query-results-resize");

        // Drag up: results grow
        fireEvent.mouseDown(handle, { clientY: 200 });
        fireEvent.mouseMove(document, { clientY: 100 });
        fireEvent.mouseUp(document);
        await waitFor(() =>
            expect(parseFloat(results.style.height)).toBeGreaterThan(initial),
        );

        // Drag far down: clamps to the 120px minimum
        fireEvent.mouseDown(handle, { clientY: 200 });
        fireEvent.mouseMove(document, { clientY: 5000 });
        fireEvent.mouseUp(document);
        await waitFor(() => expect(parseFloat(results.style.height)).toBe(120));
    });

    it("re-fetches the active table and shows the refresh indicator when refresh is clicked", async () => {
        let resolveFetch!: (v: unknown) => void;
        const pendingFetch = new Promise<unknown>((r) => {
            resolveFetch = r;
        });
        const getTableData = vi
            .spyOn(commands, "getTableData")
            .mockReturnValue(pendingFetch as any);

        useDbViewerStore.setState({
            tabs: [
                {
                    id: "tab-1",
                    schema: "public",
                    table: "users",
                    page: 1,
                    pageSize: 50,
                    loading: false,
                    error: null,
                    data: mockQueryResult,
                    filterRules: [],
                    sortRules: [],
                    hiddenColumns: [],
                    smartSortApplied: true,
                    tabType: "table",
                },
            ],
            activeTabId: "tab-1",
        });

        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );

        // Tab already has data and is not loading → no fetch on mount
        expect(getTableData).not.toHaveBeenCalled();

        fireEvent.click(screen.getByLabelText(/refresh table/i));

        // Refetch triggered for the active tab
        await waitFor(() => expect(getTableData).toHaveBeenCalledTimes(1));
        // Indicator visible while the fetch is in flight
        await waitFor(() =>
            expect(screen.getByTestId("refresh-pulse")).toBeInTheDocument(),
        );

        act(() => {
            resolveFetch({ ...mockQueryResult });
        });
        await waitFor(() =>
            expect(
                screen.queryByTestId("refresh-pulse"),
            ).not.toBeInTheDocument(),
        );
    });

    it("shows the table toolbar while a table tab is still loading its first data", () => {
        useDbViewerStore.setState({
            tabs: [
                {
                    id: "tab-loading",
                    schema: "public",
                    table: "users",
                    page: 1,
                    pageSize: 50,
                    loading: true,
                    error: null,
                    data: null, // first fetch still in flight
                    filterRules: [],
                    sortRules: [],
                    hiddenColumns: [],
                    smartSortApplied: false,
                    tabType: "table",
                },
            ],
            activeTabId: "tab-loading",
        });

        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );

        // Toolbar must be visible immediately while data is still loading,
        // so the user sees the loading state instead of an empty pane.
        expect(
            screen.getByLabelText(/refresh table/i),
        ).toBeInTheDocument();
        expect(
            screen.getByLabelText(/column filters/i),
        ).toBeInTheDocument();
    });

    it("disables Insert Row for a materialized-view tab", async () => {
        useDbViewerStore.setState({
            tables: [
                { name: "mat_users", schema: "public", table_type: "MATERIALIZED VIEW" },
            ],
            tabs: [
                {
                    id: "tab-mv",
                    schema: "public",
                    table: "mat_users",
                    page: 1,
                    pageSize: 50,
                    loading: false,
                    error: null,
                    data: mockQueryResult,
                    filterRules: [],
                    sortRules: [],
                    hiddenColumns: [],
                    smartSortApplied: true,
                    tabType: "table",
                },
            ],
            activeTabId: "tab-mv",
        });

        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );

        await waitFor(() =>
            expect(screen.queryByLabelText(/insert row/i)).toBeNull(),
        );
    });

    it("keeps a view's columns read-only", async () => {
        const viewResult = {
            columns: [
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
                {
                    name: "customer",
                    data_type: "text",
                    is_nullable: true,
                    is_pk: false,
                    is_fk: false,
                    fk_ref: null,
                    default_value: null,
                    editable: true,
                    is_generated: false,
                },
            ],
            rows: [[1, "Alice"]],
            total_rows: 1,
            page: 1,
            page_size: 50,
        };
        vi.spyOn(commands, "getTableData").mockResolvedValue(
            viewResult as any,
        );
        useDbViewerStore.setState({
            tables: [
                {
                    name: "order_summary",
                    schema: "public",
                    table_type: "VIEW",
                },
            ],
            tabs: [
                {
                    id: "tab-view",
                    schema: "public",
                    table: "order_summary",
                    page: 1,
                    pageSize: 50,
                    loading: false,
                    error: null,
                    data: viewResult,
                    filterRules: [],
                    sortRules: [],
                    hiddenColumns: [],
                    smartSortApplied: true,
                    tabType: "table",
                },
            ],
            activeTabId: "tab-view",
        });

        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );

        // A view's rows cannot be grown…
        await waitFor(() =>
            expect(screen.queryByLabelText(/insert row/i)).toBeNull(),
        );
        // …nor edited: an editable-by-metadata column stays non-editable here.
        const cell = await screen.findByText("Alice");
        fireEvent.click(cell);
        fireEvent.keyDown(cell, { key: "Enter" });
        expect(screen.queryByTestId("cell-editor")).toBeNull();
        expect(useDbViewerStore.getState().changesQueue).toHaveLength(0);
    });

    it("refetches the active tab after a successful Commit All", async () => {
        useUiStore.setState({ activeConnectionId: "c1" });
        vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
        const getTableData = vi
            .spyOn(commands, "getTableData")
            .mockResolvedValue({
                columns: mockQueryResult.columns,
                rows: [[2]],
                total_rows: 1,
                page: 1,
                page_size: 50,
            } as any);

        useDbViewerStore.setState({
            tabs: [
                {
                    id: "tab-1",
                    schema: "public",
                    table: "users",
                    page: 1,
                    pageSize: 50,
                    loading: false,
                    error: null,
                    data: mockQueryResult,
                    filterRules: [],
                    sortRules: [],
                    hiddenColumns: [],
                    smartSortApplied: true,
                    tabType: "table",
                    // a real tab always carries the origin it was opened on
                    origin: currentChangeOrigin(),
                },
            ],
            activeTabId: "tab-1",
            changesQueue: [],
            changesPanelExpanded: true,
        });
        useDbViewerStore.getState().addChange({
            type: "insert",
            schema: "public",
            table: "users",
            newData: { id: 2, name: "Alice" },
            description: "Insert row into users",
        });

        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: /commit all/i }));

        await waitFor(() => expect(getTableData).toHaveBeenCalledTimes(1));
    });

    it("fetches FK options for the referenced relation instead of a same-named local table", async () => {
        const getEnums = vi
            .spyOn(commands, "getEnums")
            .mockResolvedValue([
                {
                    name: "user_role",
                    schema: "public",
                    labels: ["admin", "user"],
                },
            ]);
        // The option source: rows of the *referenced* table, keyed by its own
        // key column. Never a page of the browsing schema's table.
        const searchFkOptions = vi
            .spyOn(commands, "searchFkOptions")
            .mockResolvedValue({
                columns: [
                    {
                        name: "id",
                        data_type: "integer",
                        is_nullable: false,
                        is_pk: true,
                        is_fk: false,
                        fk_ref: null,
                        default_value: null,
                        editable: false,
                        is_generated: false,
                    },
                    {
                        name: "name",
                        data_type: "text",
                        is_nullable: true,
                        is_pk: false,
                        is_fk: false,
                        fk_ref: null,
                        default_value: null,
                        editable: true,
                        is_generated: false,
                    },
                ],
                rows: [[7, "Reporting Alice"]],
                total_rows: 1,
                page: 1,
                page_size: 50,
            } as any);
        const getTableData = vi.spyOn(commands, "getTableData");

        useDbViewerStore.setState({
            tabs: [
                {
                    id: "tab-1",
                    schema: "public",
                    // The FK from public.orders points at reporting.users.
                    table: "orders",
                    page: 1,
                    pageSize: 50,
                    loading: false,
                    error: null,
                    data: {
                        columns: [
                            {
                                name: "id",
                                data_type: "integer",
                                is_nullable: false,
                                is_pk: true,
                                is_fk: false,
                                fk_ref: null,
                                default_value: null,
                                editable: false,
                                is_generated: false,
                            },
                            {
                                name: "user_id",
                                data_type: "integer",
                                is_nullable: true,
                                is_pk: false,
                                is_fk: true,
                                fk_ref: ["reporting", "users", "id"],
                                default_value: null,
                                editable: true,
                                is_generated: false,
                            },
                            {
                                name: "role",
                                data_type: "user_role",
                                is_nullable: true,
                                is_pk: false,
                                is_fk: false,
                                fk_ref: null,
                                default_value: null,
                                editable: true,
                                is_generated: false,
                            },
                        ],
                        rows: [[1, 7, "admin"]],
                        total_rows: 1,
                        page: 1,
                        page_size: 50,
                    } as any,
                    filterRules: [],
                    sortRules: [],
                    hiddenColumns: [],
                    smartSortApplied: true,
                    tabType: "table",
                },
            ],
            activeTabId: "tab-1",
        });

        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );

        // Enum labels are fetched for the tab's schema (cached per schema).
        await waitFor(() =>
            expect(getEnums).toHaveBeenCalledWith("c1", "public"),
        );
        // The FK source column is what gets searched; the backend resolves the
        // referenced relation from engine metadata.
        await waitFor(() =>
            expect(searchFkOptions).toHaveBeenCalledWith(
                "c1",
                "public",
                "orders",
                "user_id",
                "",
                1,
                50,
            ),
        );
        // The bug: options were fetched with getTableData under the browsing
        // schema, so a same-named local table supplied the rows.
        expect(getTableData).not.toHaveBeenCalledWith(
            "c1",
            "public",
            "users",
            1,
            50,
        );
    });

    it("pickDisplayColumn prefers name-like columns over the ref column", () => {
        const cols = [
            { name: "id", data_type: "integer" },
            { name: "email", data_type: "text" },
            { name: "name", data_type: "text" },
        ];
        expect(pickDisplayColumn(cols, "id")).toBe("name");
        expect(pickDisplayColumn(cols, "id", "email")).toBe("email");
    });

    it("pickDisplayColumn falls back to the ref column when nothing is name-like", () => {
        const cols = [{ name: "id", data_type: "integer" }];
        expect(pickDisplayColumn(cols, "id")).toBe("id");
    });

    it("shows a Redis unsupported state when a redis connection is active", () => {
        useConnectionStore.setState({
            connections: [
                {
                    id: "redis-1",
                    name: "Redis",
                    db_type: "redis",
                    host: "localhost",
                    port: 6379,
                    username: null,
                    folder_id: null,
                    keychain_ref: null,
                    tag_ids: [],
                    favorite: false,
                    created_at: "2024-01-01T00:00:00Z",
                    updated_at: "2024-01-01T00:00:00Z",
                } as Connection,
            ],
        });
        render(
            <DbViewerScreen
                connectionId="redis-1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        expect(
            screen.getByText(/redis browsing isn't supported/i),
        ).toBeInTheDocument();
    });

    it("objects view renders the sidebar + the tabbed workspace (New query + Changes)", () => {
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: /objects/i }));
        expect(
            screen.getByRole("button", { name: /new query/i }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Changes queue" }),
        ).toBeInTheDocument();
    });

    it("objects view renders ObjectDetail for an open object tab", () => {
        useDbViewerStore.getState().openObjectTab("enums", "public", "role", { name: "role", schema: "public", labels: ["admin"] });
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: /objects/i }));
        expect(screen.getByText("admin")).toBeInTheDocument();
    });

    it("renders an objectForm tab with the Visual/SQL toggle in the objects view", async () => {
    vi.spyOn(commands, "executeQueryMulti").mockResolvedValue({ result_sets: [{ columns: [], rows: [], total_rows: 0, page: 1, page_size: 50 }], notices: [], execution_time_ms: 42 } as any);
    vi.spyOn(commands, "getSchemas").mockResolvedValue(["public"]);
    vi.spyOn(commands, "getDatabases").mockResolvedValue(["mydb"]);
    vi.spyOn(commands, "getTables").mockResolvedValue([] as any);
    useDbViewerStore.getState().openFormTab({
      kind: "sequence",
      schema: "public",
      name: "",
      title: "Create sequence",
      description: "Create sequence",
      mode: "create",
      params: { schema: "public", name: "", action: { op: "create" } },
    });
    render(
      <DbViewerScreen
        connectionId="c1"
        onHome={() => {}}
        onSettings={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /objects/i }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Sequence name")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Visual" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SQL" })).toBeInTheDocument();
  });

  it("guards the Objects view for MySQL (capability false)", () => {
        useConnectionStore.setState({
            connections: [
                {
                    id: "c1",
                    name: "Postgres",
                    db_type: "postgresql",
                    host: "localhost",
                    port: 5432,
                    username: "user",
                    folder_id: null,
                    keychain_ref: null,
                    tag_ids: [],
                    favorite: false,
                    created_at: "2024-01-01T00:00:00Z",
                    updated_at: "2024-01-01T00:00:00Z",
                } as Connection,
                {
                    id: "mysql-1",
                    name: "MySQL",
                    db_type: "mysql",
                    host: "localhost",
                    port: 3306,
                    username: "user",
                    folder_id: null,
                    keychain_ref: null,
                    tag_ids: [],
                    favorite: false,
                    created_at: "2024-01-01T00:00:00Z",
                    updated_at: "2024-01-01T00:00:00Z",
                } as Connection,
            ],
        });
        const { rerender } = render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        fireEvent.click(screen.getByLabelText(/objects/i));
        rerender(
            <DbViewerScreen
                connectionId="mysql-1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        expect(
            screen.getByText(/objects is unsupported for mysql/i),
        ).toBeInTheDocument();
    });
});
/**
 * Every Execution Entry Point has to reach the same destructive-script
 * confirmation. Each test below is one entry point, so a regression names the
 * path that lost its guard instead of failing anonymously.
 */
describe("execution entry points", () => {
    const emptyResult = {
        result_sets: [{ columns: [], rows: [], total_rows: 0, page: 1, page_size: 50 }],
        notices: [],
        execution_time_ms: 42,
    } as any;

    // Earlier tests in this file leave their renders mounted; unmount them so a
    // timer or a click in one entry-point test cannot be attributed to another.
    beforeEach(() => {
        cleanup();
        vi.resetAllMocks();
        useDbViewerStore.getState().reset();
    });

    function renderScreen() {
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
    }

    /** The lazy Monaco wrapper resolves a tick after mount. */
    function mountEditor() {
        return waitFor(() => screen.getByTestId("monaco-editor"));
    }

    function seedQueryTab(
        query: string,
        overrides: Record<string, unknown> = {},
    ) {
        useDbViewerStore.setState({
            tabs: [
                {
                    id: "q1",
                    schema: "public",
                    table: "Query",
                    page: 1,
                    pageSize: 50,
                    loading: false,
                    error: null,
                    data: { columns: [], rows: [], total_rows: 0, page: 1, page_size: 50 },
                    filterRules: [],
                    sortRules: [],
                    hiddenColumns: [],
                    smartSortApplied: true,
                    tabType: "query",
                    query,
                    ...overrides,
                } as any,
            ],
            activeTabId: "q1",
        });
    }

    function expectDialog() {
        return waitFor(() =>
            expect(screen.getByText("Destructive Query")).toBeInTheDocument(),
        );
    }

    it("prompts from the Run button", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue(emptyResult);
        renderScreen();
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
        const textarea = await waitFor(() => screen.getByTestId("monaco-textarea"));
        fireEvent.change(textarea, { target: { value: "DELETE FROM users" } });

        fireEvent.click(screen.getByRole("button", { name: /run query/i }));
        await expectDialog();
        expect(executeQuery).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText("Execute"));
        await waitFor(() =>
            expect(executeQuery).toHaveBeenCalledWith("c1", "DELETE FROM users", 1, 50),
        );
    });

    it("prompts from the Cmd/Ctrl+Enter editor action", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue(emptyResult);
        renderScreen();
        registeredActions.length = 0;
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
        const textarea = await waitFor(() => screen.getByTestId("monaco-textarea"));
        fireEvent.change(textarea, { target: { value: "DROP TABLE users" } });

        expect(registeredActions).toHaveLength(1);
        act(() => registeredActions[0].run());
        await expectDialog();
        expect(executeQuery).not.toHaveBeenCalled();
    });

    it("prompts from the toolbar re-run control", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue(emptyResult);
        seedQueryTab("DELETE FROM users");
        renderScreen();
        await mountEditor();
        fireEvent.click(screen.getByLabelText(/re-run query/i));
        await expectDialog();
        expect(executeQuery).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText("Execute"));
        await waitFor(() =>
            expect(executeQuery).toHaveBeenCalledWith("c1", "DELETE FROM users", 1, 50),
        );
    });

    it("prompts from the tab refresh control", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue(emptyResult);
        seedQueryTab("UPDATE users SET name = 'x'");
        renderScreen();
        await mountEditor();

        // A query tab's refresh control is the same re-run affordance: it must
        // not fall back to executing the stored text directly.
        fireEvent.click(screen.getByLabelText(/re-run query/i));
        await expectDialog();
        expect(executeQuery).not.toHaveBeenCalled();
    });

    it("prompts when a history entry is run", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue(emptyResult);
        useQueryStore.setState({
            history: [
                {
                    id: "h1",
                    connection_id: "c1",
                    query_text: "TRUNCATE TABLE users",
                    status: "success",
                    execution_time_ms: 5,
                    row_count: 0,
                    created_at: "2026-01-01T00:00:00Z",
                    favorite: false,
                } as any,
            ],
            historyStale: false,
            historyLoading: false,
        });
        renderScreen();
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
        await waitFor(() => screen.getByTestId("monaco-textarea"));

        fireEvent.click(screen.getByLabelText(/query history/i));
        fireEvent.click(
            await waitFor(() =>
                screen.getByLabelText(/run query from history/i),
            ),
        );

        await expectDialog();
        expect(executeQuery).not.toHaveBeenCalled();
    });

    it("prompts when paging a destructive query", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue(emptyResult);
        seedQueryTab("DELETE FROM users", {
            data: { columns: [], rows: [], total_rows: 120, page: 1, page_size: 50 },
        });
        renderScreen();
        await mountEditor();

        fireEvent.click(screen.getByLabelText(/next page/i));
        await expectDialog();
        expect(executeQuery).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText("Execute"));
        await waitFor(() =>
            expect(executeQuery).toHaveBeenCalledWith("c1", "DELETE FROM users", 2, 50),
        );
    });

    it("prompts when the page size changes on a destructive query", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue(emptyResult);
        seedQueryTab("DELETE FROM users", {
            data: { columns: [], rows: [], total_rows: 120, page: 1, page_size: 50 },
        });
        renderScreen();
        await mountEditor();

        fireEvent.change(screen.getByDisplayValue("50"), {
            target: { value: "100" },
        });
        await expectDialog();
        expect(executeQuery).not.toHaveBeenCalled();
    });

    it("re-evaluates edited text on the next entry point", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue(emptyResult);
        seedQueryTab("SELECT 1", {
            data: { columns: [], rows: [], total_rows: 1, page: 1, page_size: 50 },
        });
        renderScreen();
        const textarea = await waitFor(() => screen.getByTestId("monaco-textarea"));

        // Editing the tab to destructive text, then re-running it, must prompt.
        fireEvent.change(textarea, {
            target: { value: "DELETE FROM users" },
        });
        fireEvent.click(screen.getByLabelText(/re-run query/i));
        await expectDialog();
        fireEvent.click(screen.getByText("Cancel"));
        await waitFor(() =>
            expect(screen.queryByText("Destructive Query")).toBeNull(),
        );
        expect(executeQuery).not.toHaveBeenCalled();

        // Editing it back to a read-only script must run the *current* text —
        // never a verdict cached for the text that was just cancelled.
        fireEvent.change(textarea, { target: { value: "SELECT 2" } });
        fireEvent.click(screen.getByLabelText(/re-run query/i));
        await waitFor(() =>
            expect(executeQuery).toHaveBeenCalledWith("c1", "SELECT 2", 1, 50),
        );
        expect(executeQuery).toHaveBeenCalledTimes(1);
        expect(screen.queryByText("Destructive Query")).toBeNull();
    });

    it("prompts for a statement it cannot classify (fail closed)", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue(emptyResult);
        seedQueryTab("CALL refresh_all()");
        renderScreen();
        await mountEditor();

        fireEvent.click(screen.getByLabelText(/re-run query/i));
        await expectDialog();
        expect(executeQuery).not.toHaveBeenCalled();
        expect(screen.getByTestId("destructive-statement-detail")).toHaveTextContent(
            /could not be verified as read-only/i,
        );
    });

    it("never arms an auto-refresh timer on an ad-hoc query tab", async () => {
        // Resolve the lazy editor first. A dynamic import cannot settle while
        // fake timers are installed, so the Suspense boundary that hosts the
        // query workspace (and the toolbar in it) would never commit and this
        // test would assert against an empty tree — passing even with the
        // guards deleted. Preloading keeps the fake clock and real mounting.
        await import("../editor/QueryEditor");
        vi.useFakeTimers();
        try {
            const executeQuery = vi
                .spyOn(commands, "executeQueryMulti")
                .mockResolvedValue(emptyResult);
            useSettingsStore.setState({
                settings: {
                    ...(useSettingsStore.getState().settings ?? ({} as any)),
                    table_refresh_rate: 5000,
                } as any,
            });
            // Seed the tab WITH results. The query-variant toolbar only renders
            // when the tab has data, and it is the toolbar that owns the
            // auto-refresh timer: with `data: null` there is no timer to arm, so
            // the assertion below could not fail whatever the guard did.
            seedQueryTab("SELECT 1", {
                data: {
                    columns: [
                        {
                            name: "id",
                            data_type: "integer",
                            is_pk: true,
                            is_fk: false,
                            is_nullable: false,
                            default_value: null,
                            fk_ref: null,
                            editable: false,
                            is_generated: false,
                        },
                    ],
                    rows: [[1]],
                    total_rows: 1,
                    page: 1,
                    page_size: 50,
                },
            });
            renderScreen();

            // Let the preloaded editor and the workspace commit before the
            // clock moves: a toolbar that mounts after the advance would arm
            // its timer too late to fire, which is exactly how this test could
            // pass with the guard deleted.
            await act(async () => {});
            expect(screen.getByTestId("query-results")).toBeInTheDocument();
            // Pagination is rendered by TableControls only, so this proves the
            // query-variant toolbar (the timer's owner) is really mounted.
            expect(screen.getByLabelText(/next page/i)).toBeInTheDocument();

            // A 5 s auto-refresh rate is in effect for table tabs, so a timer
            // that armed itself here would fire ten times over this window and
            // re-run `SELECT 1` through the execution guard, hitting the spy.
            await act(async () => {
                vi.advanceTimersByTime(60_000);
            });
            // The workspace (and the toolbar in it) must really be mounted,
            // otherwise "no refresh happened" proves nothing.
            expect(screen.getByTestId("query-workspace")).toBeInTheDocument();
            expect(screen.getByTestId("query-results")).toBeInTheDocument();
            expect(executeQuery).not.toHaveBeenCalled();
            // A query tab's toolbar carries no auto-refresh control at all.
            expect(screen.queryByLabelText(/auto-refresh/i)).toBeNull();
        } finally {
            vi.useRealTimers();
            useSettingsStore.setState({ settings: null });
        }
    });
});

describe("query workspace truth", () => {
    const idColumn = {
        name: "id",
        data_type: "integer",
        is_pk: true,
        is_fk: false,
        is_nullable: false,
        default_value: null,
        fk_ref: null,
        editable: false,
        is_generated: false,
    };

    beforeEach(() => {
        cleanup();
        vi.resetAllMocks();
        useDbViewerStore.getState().reset();
    });

    function renderScreen() {
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
    }

    function mountEditor() {
        return waitFor(() => screen.getByTestId("monaco-editor"));
    }

    function seedQueryTab(
        query: string,
        overrides: Record<string, unknown> = {},
    ) {
        useDbViewerStore.setState({
            tabs: [
                {
                    id: "q1",
                    schema: "public",
                    table: "Query",
                    page: 1,
                    pageSize: 50,
                    loading: false,
                    error: null,
                    requestSeq: 0,
                    stale: false,
                    data: null,
                    filterRules: [],
                    sortRules: [],
                    hiddenColumns: [],
                    smartSortApplied: true,
                    tabType: "query",
                    query,
                    ...overrides,
                } as any,
            ],
            activeTabId: "q1",
        });
    }

    const pageResult = (page: number, value: number) =>
        ({
            result_sets: [
                {
                    columns: [idColumn],
                    rows: [[value]],
                    total_rows: 200,
                    page,
                    page_size: 50,
                },
            ],
            notices: [],
            execution_time_ms: 5,
        }) as any;

    it("surfaces a thrown execution error inside the query workspace", async () => {
        vi.spyOn(commands, "executeQueryMulti").mockRejectedValue(
            new Error("statement budget exceeded"),
        );
        seedQueryTab("SELECT * FROM users", {
            data: {
                columns: [idColumn],
                rows: [[1]],
                total_rows: 1,
                page: 1,
                page_size: 50,
            },
        });
        renderScreen();
        await mountEditor();

        fireEvent.click(screen.getByLabelText(/re-run query/i));

        const workspace = screen.getByTestId("query-workspace");
        const alert = await waitFor(() => {
            const node = screen.getByTestId("tab-error");
            expect(node).toHaveTextContent("statement budget exceeded");
            return node;
        });
        // The failure is rendered by the tab itself, not only a toast that
        // disappears: it stays put for as long as the tab shows the failure.
        expect(workspace.contains(alert)).toBe(true);
        // ...and the run is over, so no spinner is left behind.
        await waitFor(() =>
            expect(screen.queryByLabelText(/cancel query/i)).toBeNull(),
        );
    });

    it("marks the previous results stale after a failed run and clears it on success", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockRejectedValueOnce(new Error("connection reset"));
        seedQueryTab("SELECT * FROM users", {
            data: {
                columns: [idColumn],
                rows: [[7]],
                total_rows: 1,
                page: 1,
                page_size: 50,
            },
        });
        renderScreen();
        await mountEditor();

        fireEvent.click(screen.getByLabelText(/re-run query/i));

        await waitFor(() =>
            expect(screen.getByTestId("stale-results")).toBeInTheDocument(),
        );
        // The old rows are still visible, but explicitly not current.
        expect(screen.getByText("7")).toBeInTheDocument();

        executeQuery.mockResolvedValueOnce(pageResult(1, 8));
        fireEvent.click(screen.getByLabelText(/re-run query/i));

        await waitFor(() =>
            expect(screen.queryByTestId("stale-results")).toBeNull(),
        );
        expect(screen.queryByTestId("tab-error")).toBeNull();
        await waitFor(() => expect(screen.getByText("8")).toBeInTheDocument());
    });

    it("shows the newest page when a superseded response lands last", async () => {
        const pending: Array<{
            resolve: (v: unknown) => void;
            reject: (e: unknown) => void;
        }> = [];
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockImplementation(
                () =>
                    new Promise((resolve, reject) => {
                        pending.push({ resolve, reject });
                    }) as any,
            );
        // Distinct row sentinels per page so a page-size <option> cannot be
        // mistaken for a rendered row.
        const rowsResult = (page: number, value: string) =>
            ({
                result_sets: [
                    {
                        columns: [idColumn],
                        rows: [[value]],
                        total_rows: 200,
                        page,
                        page_size: 50,
                    },
                ],
                notices: [],
                execution_time_ms: 5,
            }) as any;
        seedQueryTab("SELECT * FROM users", {
            data: {
                columns: [idColumn],
                rows: [["page-1-rows"]],
                total_rows: 200,
                page: 1,
                page_size: 50,
            },
        });
        renderScreen();
        await mountEditor();

        // Page 2 is requested, then page 3 before page 2 has returned.
        fireEvent.click(screen.getByLabelText(/next page/i));
        await waitFor(() => expect(pending).toHaveLength(1));
        fireEvent.click(screen.getByLabelText(/next page/i));
        await waitFor(() => expect(pending).toHaveLength(2));
        expect(executeQuery).toHaveBeenNthCalledWith(1, "c1", "SELECT * FROM users", 2, 50);
        expect(executeQuery).toHaveBeenNthCalledWith(2, "c1", "SELECT * FROM users", 3, 50);

        // The newer response arrives first, then the older one: the older one
        // must never be rendered under the newer page controls.
        await act(async () => {
            pending[1].resolve(rowsResult(3, "page-3-rows"));
        });
        await waitFor(() =>
            expect(screen.getByText("page-3-rows")).toBeInTheDocument(),
        );
        await act(async () => {
            pending[0].resolve(rowsResult(2, "page-2-rows"));
        });
        await act(async () => {});

        expect(screen.getByText("page-3-rows")).toBeInTheDocument();
        expect(screen.queryByText("page-2-rows")).toBeNull();
        const tab = useDbViewerStore
            .getState()
            .tabs.find((t) => t.id === "q1")!;
        expect(tab.page).toBe(3);
        expect(tab.loading).toBe(false);
    });

    it("applies the newest table page intent even when an older fetch lands last", async () => {
        const pending: Array<(v: unknown) => void> = [];
        const getTableData = vi
            .spyOn(commands, "getTableData")
            .mockImplementation(
                () =>
                    new Promise((resolve) => {
                        pending.push(resolve);
                    }) as any,
            );
        useDbViewerStore.setState({
            tabs: [
                {
                    id: "t1",
                    schema: "public",
                    table: "users",
                    page: 1,
                    pageSize: 50,
                    loading: false,
                    error: null,
                    requestSeq: 0,
                    stale: false,
                    data: {
                        columns: [idColumn],
                        rows: [["page-1-rows"]],
                        total_rows: 200,
                        page: 1,
                        page_size: 50,
                    },
                    filterRules: [],
                    sortRules: [],
                    hiddenColumns: [],
                    smartSortApplied: true,
                    tabType: "table",
                } as any,
            ],
            activeTabId: "t1",
        });
        renderScreen();

        // A refresh for page 1 is in flight when the user pages to page 2.
        fireEvent.click(screen.getByLabelText(/refresh table/i));
        await waitFor(() => expect(pending).toHaveLength(1));

        fireEvent.click(screen.getByLabelText(/next page/i));
        await waitFor(() => expect(pending).toHaveLength(2));
        expect(getTableData).toHaveBeenNthCalledWith(
            2,
            "c1",
            "public",
            "users",
            2,
            50,
            [],
            [],
        );

        // The page-2 response lands first, then the superseded page-1 response.
        await act(async () => {
            pending[1]({
                columns: [idColumn],
                rows: [["page-2-rows"]],
                total_rows: 200,
                page: 2,
                page_size: 50,
            });
        });
        await waitFor(() =>
            expect(screen.getByText("page-2-rows")).toBeInTheDocument(),
        );
        await act(async () => {
            pending[0]({
                columns: [idColumn],
                rows: [["page-1-rows"]],
                total_rows: 200,
                page: 1,
                page_size: 50,
            });
        });
        await act(async () => {});

        expect(screen.getByText("page-2-rows")).toBeInTheDocument();
        expect(screen.queryByText("page-1-rows")).toBeNull();
        const tab = useDbViewerStore.getState().tabs.find((t) => t.id === "t1")!;
        expect(tab.page).toBe(2);
        expect(tab.loading).toBe(false);
        expect(screen.queryByTestId("refresh-pulse")).toBeNull();
    });

    it("leaves the page controls describing the shown rows when a guarded page change is cancelled", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue(pageResult(1, 1));
        seedQueryTab("DELETE FROM users", {
            data: {
                columns: [idColumn],
                rows: [[1]],
                total_rows: 200,
                page: 1,
                page_size: 50,
            },
        });
        renderScreen();
        await mountEditor();

        fireEvent.click(screen.getByLabelText(/next page/i));
        await waitFor(() =>
            expect(screen.getByText("Destructive Query")).toBeInTheDocument(),
        );
        fireEvent.click(screen.getByText("Cancel"));
        await waitFor(() =>
            expect(screen.queryByText("Destructive Query")).toBeNull(),
        );

        // Nothing ran, nothing is loading, and the controls still describe the
        // rows on screen (page 1) instead of promising page 2.
        expect(executeQuery).not.toHaveBeenCalled();
        const tab = useDbViewerStore
            .getState()
            .tabs.find((t) => t.id === "q1")!;
        expect(tab.page).toBe(1);
        expect(tab.loading).toBe(false);
        expect(screen.queryByLabelText(/cancel query/i)).toBeNull();
        expect(screen.getByText(/^1\/4$/)).toBeInTheDocument();
    });

    it("treats cancellation as final: no fallback re-run and no wedged spinner", async () => {
        let rejectRun!: (e: unknown) => void;
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockImplementation(
                () =>
                    new Promise((_resolve, reject) => {
                        rejectRun = reject;
                    }) as any,
            );
        const cancelQuery = vi
            .spyOn(commands, "cancelQuery")
            .mockResolvedValue(undefined as any);
        seedQueryTab("SELECT pg_sleep(60)", {
            data: {
                columns: [idColumn],
                rows: [[1]],
                total_rows: 1,
                page: 1,
                page_size: 50,
            },
        });
        renderScreen();
        await mountEditor();

        fireEvent.click(screen.getByLabelText(/re-run query/i));
        await waitFor(() =>
            expect(screen.getByLabelText(/cancel query/i)).toBeInTheDocument(),
        );

        fireEvent.click(screen.getByLabelText(/cancel query/i));

        await waitFor(() => expect(cancelQuery).toHaveBeenCalledWith("c1"));
        await waitFor(() =>
            expect(screen.getByTestId("tab-error")).toHaveTextContent(
                /cancelled/i,
            ),
        );
        expect(screen.getByTestId("stale-results")).toBeInTheDocument();
        await waitFor(() =>
            expect(screen.queryByLabelText(/cancel query/i)).toBeNull(),
        );

        // The cancelled execution settling afterwards must not restart it or
        // overwrite the cancellation the user can see.
        await act(async () => {
            rejectRun(new Error("Query cancelled"));
        });
        await act(async () => {});

        expect(executeQuery).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("tab-error")).toHaveTextContent(/cancelled/i);
    });

    it("surfaces a failed cancellation in the query workspace", async () => {
        vi.spyOn(commands, "executeQueryMulti").mockImplementation(
            () => new Promise(() => {}) as any,
        );
        vi.spyOn(commands, "cancelQuery").mockRejectedValue(
            new Error("no active cancel handle for this connection"),
        );
        seedQueryTab("SELECT pg_sleep(60)", {
            data: {
                columns: [idColumn],
                rows: [[1]],
                total_rows: 1,
                page: 1,
                page_size: 50,
            },
        });
        renderScreen();
        await mountEditor();

        fireEvent.click(screen.getByLabelText(/re-run query/i));
        await waitFor(() =>
            expect(screen.getByLabelText(/cancel query/i)).toBeInTheDocument(),
        );
        fireEvent.click(screen.getByLabelText(/cancel query/i));

        await waitFor(() =>
            expect(screen.getByTestId("tab-error")).toHaveTextContent(
                /cancel handle/i,
            ),
        );
    });
});

describe("viewer identity and freshness", () => {
    const usersResult = (rows: unknown[][] = [["appdb row"]]) => ({
        columns: [
            { name: "id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
            { name: "name", data_type: "text", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
        ],
        rows,
        total_rows: rows.length,
        page: 1,
        page_size: 50,
    });

    function mockTableData() {
        const calls: unknown[][] = [];
        const spy = vi
            .spyOn(commands, "getTableData")
            .mockImplementation((( ...args: unknown[]) => {
                calls.push(args);
                if (args[2] === "posts") return Promise.resolve({ ...usersResult([["post row"]]), rows: [["post row"]] });
                return Promise.resolve(usersResult());
            }) as never);
        return { spy, calls };
    }

    function renderScreen() {
        return render(
            <DbViewerScreen connectionId="c1" onHome={() => {}} onSettings={() => {}} />,
        );
    }

    beforeEach(() => {
        useDbViewerStore.getState().reset();
        useConnectionStore.setState({
            connections: [
                { id: "c1", name: "local", db_type: "postgresql", host: "localhost", port: 5432, username: "dev", database: "mydb", folder_id: null, keychain_ref: null, tag_ids: [], favorite: false, created_at: "", updated_at: "" },
            ] as Connection[],
        });
        useUiStore.setState({ activeConnectionId: "c1" });
        useDbViewerStore.setState({
            databases: ["mydb", "archive"],
            schemas: ["public"],
            tables: [
                { name: "users", schema: "public", table_type: "TABLE" },
                { name: "posts", schema: "public", table_type: "TABLE" },
            ],
            currentDatabase: "mydb",
            currentSchema: "public",
        });
        vi.resetAllMocks();
    });

    it("never queries a tab against a newly selected database, and re-queries its own when it comes back", async () => {
        const { calls } = mockTableData();
        useDbViewerStore.getState().openTab("public", "users");
        renderScreen();

        // The first load (plus the smart default sort it applies) settles.
        const tabId = useDbViewerStore.getState().activeTabId!;
        await waitFor(() =>
            expect(useDbViewerStore.getState().tabs.find((t) => t.id === tabId)?.loading).toBe(false),
        );
        const settled = calls.length;
        expect(settled).toBeGreaterThan(0);
        expect(calls[0].slice(0, 3)).toEqual(["c1", "public", "users"]);

        // The database selector moves: the pool is somewhere else now, so the
        // tab's rows must not be re-queried (or silently read as current).
        act(() => useDbViewerStore.getState().setCurrentDatabase("archive"));
        await waitFor(() =>
            expect(screen.getByTestId("stale-results")).toHaveTextContent(/mydb/),
        );
        expect(calls).toHaveLength(settled);

        // Switching back re-queries the database the tab belongs to.
        act(() => useDbViewerStore.getState().setCurrentDatabase("mydb"));
        await waitFor(() => expect(calls.length).toBeGreaterThan(settled));
        expect(calls[calls.length - 1].slice(0, 3)).toEqual(["c1", "public", "users"]);
        await waitFor(() => expect(screen.queryByTestId("stale-results")).toBeNull());
    });

    it("refuses to run a query tab outside the database it was opened on", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue({ result_sets: [mockQueryResult], notices: [], execution_time_ms: 42 } as any);
        useDbViewerStore.getState().openQueryTab({ sql: "SELECT 1" });
        renderScreen();
        const tabId = useDbViewerStore.getState().activeTabId!;

        // Mount control: the tab runs normally while the viewer is on the
        // database it belongs to, so the assertions below are about the refusal
        // and not about a screen that never worked.
        const runButton = await screen.findByRole("button", { name: /run query/i });
        fireEvent.click(runButton);
        await waitFor(() => expect(executeQuery).toHaveBeenCalledTimes(1));
        const rowsBefore = useDbViewerStore
            .getState()
            .tabs.find((t) => t.id === tabId)!.data?.rows;

        act(() => useDbViewerStore.getState().setCurrentDatabase("archive"));
        await waitFor(() =>
            expect(screen.getByTestId("stale-results")).toHaveTextContent(/mydb/),
        );

        // Clear the marker the switch itself set, so nothing below can pass on
        // the switch's account: only RUNNING can put it back.
        act(() =>
            useDbViewerStore.setState((s) => ({
                tabs: s.tabs.map((t) =>
                    t.id === tabId
                        ? { ...t, stale: false, staleReason: null, outOfOrigin: false }
                        : t,
                ),
            })),
        );
        expect(screen.queryByTestId("stale-results")).toBeNull();

        fireEvent.click(runButton);

        // The refusal is a visible state tied to the tab's own origin…
        const banner = await screen.findByTestId("stale-results");
        expect(banner).toHaveTextContent(/mydb/);
        expect(banner).toHaveTextContent(/not current/i);
        // …the forbidden outcome never happens (no second execution)…
        expect(executeQuery).toHaveBeenCalledTimes(1);
        // …and the tab keeps its rows and its identity instead of silently
        // being re-run against the new database.
        const tab = useDbViewerStore.getState().tabs.find((t) => t.id === tabId)!;
        expect(tab.outOfOrigin).toBe(true);
        expect(tab.loading).toBe(false);
        expect(tab.data?.rows).toEqual(rowsBefore);
    });

    it("refreshes every affected tab after Commit All and clears its optimistic markers", async () => {
        vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
        const { calls } = mockTableData();
        const store = useDbViewerStore.getState();
        store.openTab("public", "users");
        const usersTab = useDbViewerStore.getState().activeTabId!;
        store.setTabData(usersTab, usersResult() as any);
        store.openTab("public", "posts", true);
        const postsTab = useDbViewerStore.getState().activeTabId!;
        store.setTabData(postsTab, usersResult([["post row"]]) as any);
        // An untouched table: opening no tab means nothing to refresh
        store.addChange({
            type: "update",
            schema: "public",
            table: "users",
            primaryKey: { id: 1 },
            oldData: { name: "appdb row" },
            newData: { name: "edited row" },
        });
        store.addChange({
            type: "update",
            schema: "public",
            table: "posts",
            primaryKey: { id: 1 },
            oldData: { name: "post row" },
            newData: { name: "edited post" },
        });

        renderScreen();
        fireEvent.click(await screen.findByTestId("commit-all"));

        // EVERY affected tab is refreshed, not only the active one.
        await waitFor(() => {
            const tables = calls.map((c) => c[2]);
            expect(tables).toContain("users");
            expect(tables).toContain("posts");
        });
        // …and their committed optimistic markers are cleared once refreshed.
        await waitFor(() => expect(useDbViewerStore.getState().changesQueue).toHaveLength(0));
    });

    it("visibly marks a tab stale when its post-commit refresh fails", async () => {
        vi.spyOn(commands, "executeChange").mockResolvedValue(undefined);
        vi.spyOn(commands, "getTableData").mockImplementation((( ...args: unknown[]) => {
            if (args[2] === "posts") return Promise.reject(new Error("refresh failed"));
            return Promise.resolve(usersResult());
        }) as never);
        const store = useDbViewerStore.getState();
        store.openTab("public", "users");
        store.setTabData(useDbViewerStore.getState().activeTabId!, usersResult() as any);
        store.openTab("public", "posts", true);
        const postsTab = useDbViewerStore.getState().activeTabId!;
        store.setTabData(postsTab, usersResult([["post row"]]) as any);
        store.addChange({
            type: "update",
            schema: "public",
            table: "users",
            primaryKey: { id: 1 },
            oldData: { name: "appdb row" },
            newData: { name: "edited row" },
        });
        store.addChange({
            type: "update",
            schema: "public",
            table: "posts",
            primaryKey: { id: 1 },
            oldData: { name: "post row" },
            newData: { name: "edited post" },
        });

        renderScreen();
        fireEvent.click(await screen.findByTestId("commit-all"));

        await waitFor(() =>
            expect(useDbViewerStore.getState().tabs.find((t) => t.id === postsTab)?.stale).toBe(true),
        );
        act(() => useDbViewerStore.getState().setActiveTab(postsTab));
        await waitFor(() =>
            expect(screen.getByTestId("stale-results")).toBeInTheDocument(),
        );
        expect(screen.getByTestId("tab-error")).toHaveTextContent(/refresh failed/);
        // The failed table keeps its optimistic marker; only refreshed ones clear.
        const remaining = useDbViewerStore.getState().changesQueue.map((c) => c.table);
        expect(remaining).toEqual(["posts"]);
    });
});

describe("selection follows Row Identity", () => {
    // orders — a composite-PK table: two rows share order_id and differ by
    // product_id, so a positional selection or a single-column key collides.
    const orderColumns = [
        { name: "order_id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: false, is_generated: false },
        { name: "product_id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: false, is_generated: false },
        { name: "quantity", data_type: "integer", is_nullable: false, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
    ];
    const page1 = [
        [1, 1, 2],
        [1, 3, 1],
    ];
    const page2 = [
        [2, 1, 5],
        [2, 3, 4],
    ];

    const ordersPage = (page: number) => ({
        columns: orderColumns,
        rows: page === 2 ? page2 : page1,
        total_rows: 100,
        page,
        page_size: 50,
    });

    function mockOrders() {
        return vi.spyOn(commands, "getTableData").mockImplementation(((...
            args: unknown[]
        ) => {
            const page = args[3] as number;
            return Promise.resolve(ordersPage(page));
        }) as never);
    }

    function seedOrders() {
        const store = useDbViewerStore.getState();
        store.openTab("public", "orders");
        const tabId = useDbViewerStore.getState().activeTabId!;
        store.setTabData(tabId, ordersPage(1) as any);
        return tabId;
    }

    function tabState(tabId: string) {
        return useDbViewerStore.getState().tabs.find((t) => t.id === tabId)!;
    }

    // Every checkbox in the grid: [0] is select-all, the rest are the rows.
    const rowCheckboxes = () => screen.getAllByRole("checkbox").slice(1);

    function renderScreen() {
        return render(
            <DbViewerScreen connectionId="c1" onHome={() => {}} onSettings={() => {}} />,
        );
    }

    const selectedLabel = () => screen.queryByText(/^\d+ selected$/);
    const actionsButton = () => screen.queryByText("Actions");

    beforeEach(() => {
        useDbViewerStore.getState().reset();
        useConnectionStore.setState({
            connections: [
                { id: "c1", name: "local", db_type: "postgresql", host: "localhost", port: 5432, username: "dev", database: "mydb", folder_id: null, keychain_ref: null, tag_ids: [], favorite: false, created_at: "", updated_at: "" },
            ] as Connection[],
        });
        useUiStore.setState({ activeConnectionId: "c1" });
        useDbViewerStore.setState({
            databases: ["mydb"],
            schemas: ["public"],
            tables: [
                { name: "orders", schema: "public", table_type: "TABLE" },
                { name: "users", schema: "public", table_type: "TABLE" },
            ],
            currentDatabase: "mydb",
            currentSchema: "public",
        });
        vi.resetAllMocks();
    });

    it("stages only currently visible rows when bulk delete follows a page change", async () => {
        mockOrders();
        const tabId = seedOrders();
        renderScreen();

        // Select the second row of page 1 (order 1, product 3).
        await waitFor(() => expect(rowCheckboxes()).toHaveLength(2));
        fireEvent.click(rowCheckboxes()[1]!);
        expect(await screen.findByText("1 selected")).toBeInTheDocument();

        // Page 2 has the same positions but entirely different rows.
        fireEvent.click(screen.getByLabelText("Next page"));
        await waitFor(() => expect(tabState(tabId).data?.rows).toEqual(page2));

        // Nothing page 1 selected is on screen now, so nothing is selected:
        // no count, no bulk actions, and no staged delete to run.
        expect(selectedLabel()).toBeNull();
        expect(actionsButton()).toBeNull();
        expect(useDbViewerStore.getState().changesQueue).toEqual([]);

        // Selecting a page-2 row deletes exactly that row.
        fireEvent.click(rowCheckboxes()[1]!);
        fireEvent.click(await screen.findByText("Actions"));
        fireEvent.click(screen.getByText("Delete selected rows"));

        const staged = useDbViewerStore.getState().changesQueue;
        expect(staged).toHaveLength(1);
        expect(staged[0]!.type).toBe("delete");
        expect(staged[0]!.primaryKey).toEqual({ order_id: 2, product_id: 3 });
    });

    it("clears the selection on a filter change, a sort change, and a tab change", async () => {
        mockOrders();
        const tabId = seedOrders();
        renderScreen();
        await waitFor(() => expect(rowCheckboxes()).toHaveLength(2));

        const selectFirstRow = async () => {
            fireEvent.click(rowCheckboxes()[0]!);
            expect(await screen.findByText("1 selected")).toBeInTheDocument();
        };

        await selectFirstRow();
        act(() =>
            useDbViewerStore
                .getState()
                .setSortRules(tabId, [{ id: "s1", column: "quantity", order: "desc" }]),
        );
        await waitFor(() => expect(selectedLabel()).toBeNull());

        await waitFor(() => expect(rowCheckboxes()).toHaveLength(2));
        await selectFirstRow();
        act(() =>
            useDbViewerStore
                .getState()
                .setFilterRules(tabId, [
                    { id: "f1", column: "quantity", operator: "gt", value: "1" },
                ]),
        );
        await waitFor(() => expect(selectedLabel()).toBeNull());

        await waitFor(() => expect(rowCheckboxes()).toHaveLength(2));
        await selectFirstRow();
        act(() => useDbViewerStore.getState().openTab("public", "users"));
        await waitFor(() => expect(selectedLabel()).toBeNull());

        // Coming back to the original tab does not restore the selection.
        act(() => useDbViewerStore.getState().setActiveTab(tabId));
        await waitFor(() => expect(rowCheckboxes()).toHaveLength(2));
        expect(selectedLabel()).toBeNull();
    });

    it("never counts a selected key whose row is no longer on screen", async () => {
        mockOrders();
        const tabId = seedOrders();
        renderScreen();
        await waitFor(() => expect(rowCheckboxes()).toHaveLength(2));

        // The selection lifecycle clears on every dataset change; this simulates
        // the case where the rows are replaced out of band. The selected key
        // must still resolve against the rows on screen — page 1's selection is
        // not page 2's rows.
        const page1Key = rowSelectionKey(orderColumns, page1[1]!, "postgresql")!;
        act(() => {
            useDbViewerStore.getState().setRowSelection(tabId, [page1Key]);
            useDbViewerStore.setState((s) => ({
                tabs: s.tabs.map((t) =>
                    t.id === tabId ? { ...t, data: ordersPage(2) as any } : t,
                ),
            }));
        });

        await waitFor(() => expect(screen.queryByText("1 selected")).toBeNull());
        expect(actionsButton()).toBeNull();
        // …and no checkbox claims a selection either.
        expect(rowCheckboxes().every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    });

    it("copies the selected row by identity, not by its position", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        mockOrders();
        const tabId = seedOrders();
        renderScreen();
        await waitFor(() => expect(rowCheckboxes()).toHaveLength(2));

        // Select the SECOND row (order 1, product 3, quantity 1).
        fireEvent.click(rowCheckboxes()[1]!);
        fireEvent.click(await screen.findByText("Actions"));
        fireEvent.click(screen.getByText("Copy as SQL INSERT"));

        const sql = writeText.mock.calls[0]![0] as string;
        expect(sql).toContain("(1, 3, 1)");
        expect(sql).not.toContain("(1, 1, 2)");

        // The same selected row, now displayed first: its key still follows the
        // row, and the copy still contains that row — never the old position.
        act(() => {
            useDbViewerStore.setState((s) => ({
                tabs: s.tabs.map((t) =>
                    t.id === tabId
                        ? {
                              ...t,
                              data: {
                                  ...ordersPage(1),
                                  rows: [page1[1]!, page1[0]!],
                              } as any,
                          }
                        : t,
                ),
            }));
        });
        expect(await screen.findByText("1 selected")).toBeInTheDocument();

        writeText.mockClear();
        fireEvent.click(await screen.findByText("Actions"));
        fireEvent.click(screen.getByText("Copy as SQL INSERT"));
        const reordered = writeText.mock.calls[0]![0] as string;
        expect(reordered).toContain("(1, 3, 1)");
        expect(reordered).not.toContain("(1, 1, 2)");
    });
});

/**
 * Ticket 17: a destructive confirmation answers exactly one request.
 *
 * Every test below raises a real confirmation through an Execution Entry Point
 * and then changes one part of the request identity — the tab, the reviewed SQL,
 * the Change Origin, or the tab's existence. The dialog must disappear and
 * nothing may execute, because the request it was raised for is gone.
 */
describe("request-bound confirmation", () => {
    const emptyResult = {
        result_sets: [{ columns: [], rows: [], total_rows: 0, page: 1, page_size: 50 }],
        notices: [],
        execution_time_ms: 42,
    } as any;

    beforeEach(() => {
        cleanup();
        vi.resetAllMocks();
        useDbViewerStore.getState().reset();
        useConnectionStore.setState({
            connections: [
                { id: "c1", name: "local", db_type: "postgresql", host: "localhost", port: 5432, username: "dev", database: "mydb", folder_id: null, keychain_ref: null, tag_ids: [], favorite: false, created_at: "", updated_at: "" },
            ] as Connection[],
        });
        useUiStore.setState({ activeConnectionId: "c1" });
        useDbViewerStore.setState({
            databases: ["mydb", "analytics"],
            schemas: ["public"],
            tables: [{ name: "users", schema: "public", table_type: "TABLE" }],
            currentDatabase: "mydb",
            currentSchema: "public",
        });
    });

    function renderScreen() {
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
    }

    function queryTab(id: string, query: string, overrides: Record<string, unknown> = {}) {
        return {
            id,
            schema: "public",
            table: id === "q1" ? "Query" : "Query 2",
            page: 1,
            pageSize: 50,
            loading: false,
            error: null,
            data: { columns: [], rows: [], total_rows: 0, page: 1, page_size: 50 },
            filterRules: [],
            sortRules: [],
            hiddenColumns: [],
            smartSortApplied: true,
            tabType: "query",
            query,
            origin: currentChangeOrigin(),
            ...overrides,
        } as any;
    }

    function seedTabs(tabs: any[], activeTabId = tabs[0]?.id ?? null) {
        useDbViewerStore.setState({ tabs, activeTabId });
    }

    function mountEditor() {
        return waitFor(() => screen.getByTestId("monaco-editor"));
    }

    /** Raise a confirmation for the active query tab via the toolbar re-run. */
    async function raiseConfirmation() {
        renderScreen();
        await mountEditor();
        fireEvent.click(screen.getByLabelText(/re-run query/i));
        await waitFor(() =>
            expect(screen.getByText("Destructive Query")).toBeInTheDocument(),
        );
    }

    it("cancels the pending confirmation when another tab becomes active", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue(emptyResult);
        seedTabs([
            queryTab("q1", "DELETE FROM users"),
            queryTab("q2", "DELETE FROM posts"),
        ]);
        await raiseConfirmation();

        act(() => useDbViewerStore.getState().setActiveTab("q2"));

        await waitFor(() =>
            expect(screen.queryByText("Destructive Query")).toBeNull(),
        );
        expect(executeQuery).not.toHaveBeenCalled();
        expect(screen.queryByTestId("destructive-query-confirm")).toBeNull();
    });

    it("cancels the pending confirmation when the reviewed SQL is edited", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue(emptyResult);
        seedTabs([queryTab("q1", "DELETE FROM users")]);
        await raiseConfirmation();

        fireEvent.change(screen.getByTestId("monaco-textarea"), {
            target: { value: "DELETE FROM users WHERE id = 1" },
        });

        await waitFor(() =>
            expect(screen.queryByText("Destructive Query")).toBeNull(),
        );
        // The reviewed text was never sent; the new text was never confirmed.
        expect(executeQuery).not.toHaveBeenCalled();
    });

    it("cancels the pending confirmation when the tab is closed", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue(emptyResult);
        seedTabs([queryTab("q1", "DELETE FROM users")]);
        await raiseConfirmation();

        act(() => useDbViewerStore.getState().closeTab("q1"));

        await waitFor(() =>
            expect(screen.queryByText("Destructive Query")).toBeNull(),
        );
        expect(executeQuery).not.toHaveBeenCalled();
    });

    it("cancels the pending confirmation when the Change Origin changes", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue(emptyResult);
        seedTabs([queryTab("q1", "DELETE FROM users")]);
        await raiseConfirmation();

        act(() =>
            useDbViewerStore.setState({ currentDatabase: "analytics" }),
        );

        await waitFor(() =>
            expect(screen.queryByText("Destructive Query")).toBeNull(),
        );
        expect(executeQuery).not.toHaveBeenCalled();
    });

    it("cancels when the saved connection is retargeted while a confirmation is pending", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue(emptyResult);
        seedTabs([queryTab("q1", "DELETE FROM users")]);
        await raiseConfirmation();

        act(() => {
            useConnectionStore.setState((state) => ({
                connections: state.connections.map((c) =>
                    c.id === "c1" ? { ...c, host: "other-host" } : c,
                ),
            }));
        });

        await waitFor(() =>
            expect(screen.queryByText("Destructive Query")).toBeNull(),
        );
        expect(executeQuery).not.toHaveBeenCalled();
    });

    it("does not execute or move a pending confirmation from a keyboard shortcut", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue(emptyResult);
        seedTabs([queryTab("q1", "DELETE FROM users")]);
        registeredActions.length = 0;
        renderScreen();
        await mountEditor();
        fireEvent.click(screen.getByLabelText(/re-run query/i));
        await waitFor(() =>
            expect(screen.getByText("Destructive Query")).toBeInTheDocument(),
        );
        expect(registeredActions).toHaveLength(1);

        // Cmd/Ctrl+Enter (the editor's own run action) while the confirmation is
        // pending must not execute it, and must not replace it either.
        act(() => registeredActions[0].run());
        act(() => registeredActions[0].run());
        // …and neither does a page key or the paging control's request path.
        fireEvent.keyDown(document.body, { key: "Enter", metaKey: true });

        await waitFor(() =>
            expect(screen.getByText("Destructive Query")).toBeInTheDocument(),
        );
        expect(executeQuery).not.toHaveBeenCalled();
        // Still the originally reviewed request.
        expect(screen.getByTestId("destructive-offending-statement")).toHaveTextContent(
            "DELETE FROM users",
        );

        // Confirming now executes exactly the reviewed text, once.
        fireEvent.click(screen.getByTestId("destructive-query-confirm"));
        await waitFor(() =>
            expect(executeQuery).toHaveBeenCalledWith(
                "c1",
                "DELETE FROM users",
                1,
                50,
            ),
        );
        expect(executeQuery).toHaveBeenCalledTimes(1);
    });

    it("executes exactly the reviewed text once when the confirmation is confirmed", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQueryMulti")
            .mockResolvedValue(emptyResult);
        const reviewed = "SELECT 1;\nDROP TABLE demo;";
        seedTabs([queryTab("q1", reviewed)]);
        await raiseConfirmation();

        // Hold the button, then click twice: the confirmation is consumed by
        // the first click, so the impatient second one has nothing to confirm.
        const confirmButton = screen.getByTestId("destructive-query-confirm");
        fireEvent.click(confirmButton);
        fireEvent.click(confirmButton);

        await waitFor(() =>
            expect(executeQuery).toHaveBeenCalledWith(
                "c1",
                reviewed,
                1,
                50,
            ),
        );
        expect(executeQuery).toHaveBeenCalledTimes(1);
    });

    it("names the offending statement and its position in the script", async () => {
        vi.spyOn(commands, "executeQueryMulti").mockResolvedValue(emptyResult);
        seedTabs([queryTab("q1", "SELECT 1;\nDROP TABLE demo;\nSELECT 2;")]);
        await raiseConfirmation();

        const offending = screen.getByTestId("destructive-offending-statement");
        expect(offending).toHaveTextContent("DROP TABLE demo");
        expect(offending).toHaveTextContent("Statement 2 of 3");
        expect(screen.getByTestId("destructive-statement-detail")).toHaveTextContent(
            "Statement 2 of 3",
        );
    });

    it("behaves as a modal: the editor behind cannot receive typing", async () => {
        vi.spyOn(commands, "executeQueryMulti").mockResolvedValue(emptyResult);
        seedTabs([queryTab("q1", "DELETE FROM users")]);
        await raiseConfirmation();

        const dialog = screen.getByTestId("destructive-query-dialog");
        expect(dialog).toHaveAttribute("aria-modal", "true");
        // Focus left the editor for the dialog…
        expect(dialog.contains(document.activeElement)).toBe(true);
        expect(screen.getByTestId("monaco-textarea")).not.toBe(document.activeElement);
        // …and the workspace behind the modal is inert, so it cannot be focused
        // or typed into at all while the confirmation is pending.
        expect(screen.getByTestId("query-workspace").closest("[inert]")).not.toBeNull();

        // Typing now goes to the dialog, not to the editor.
        const before = (screen.getByTestId("monaco-textarea") as HTMLTextAreaElement)
            .value;
        fireEvent.keyDown(document.activeElement!, { key: "X" });
        expect(
            (screen.getByTestId("monaco-textarea") as HTMLTextAreaElement).value,
        ).toBe(before);

        // Escape cancels, and the workspace becomes interactive again.
        fireEvent.keyDown(document.activeElement!, { key: "Escape" });
        await waitFor(() =>
            expect(screen.queryByText("Destructive Query")).toBeNull(),
        );
        expect(screen.getByTestId("query-workspace").closest("[inert]")).toBeNull();
    });

});

/**
 * Row detail lifecycle (ticket 39).
 *
 * The drawer is keyed by the row's Row Identity, resolved against the rows the
 * active tab is displaying right now. Leaving that context closes it, so it can
 * never show another row's or another table's content.
 */
const rowDetailUsersColumns = [
    { name: "id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: false, is_generated: false },
    { name: "name", data_type: "text", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
];
const rowDetailOrdersColumns = [
    { name: "id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: false, is_generated: false },
    { name: "total", data_type: "integer", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
];

describe("row detail lifecycle", () => {
    beforeEach(() => {
        useDbViewerStore.getState().reset();
        useConnectionStore.setState({
            connections: [
                { id: "c1", name: "local", db_type: "postgresql", host: "localhost", port: 5432, username: "dev", database: "mydb", folder_id: null, keychain_ref: null, tag_ids: [], favorite: false, created_at: "", updated_at: "" },
            ] as Connection[],
        });
        useUiStore.setState({ activeConnectionId: "c1" });
        useDbViewerStore.setState({
            databases: ["mydb"],
            schemas: ["public"],
            tables: [{ name: "users", schema: "public", table_type: "TABLE" }],
            currentDatabase: "mydb",
            currentSchema: "public",
        });
        vi.resetAllMocks();
    });

    it("row detail shows the displayed row and closes on a tab switch", async () => {
        const usersColumns = rowDetailUsersColumns;
        const ordersColumns = rowDetailOrdersColumns;
        const store = useDbViewerStore.getState();
        store.openTab("public", "users");
        const usersTab = useDbViewerStore.getState().activeTabId!;
        useDbViewerStore.getState().setTabData(usersTab, {
            columns: usersColumns,
            rows: [[1, "Alice"]],
            total_rows: 1,
            page: 1,
            page_size: 50,
        } as any);
        store.openTab("public", "orders");
        const ordersTab = useDbViewerStore.getState().activeTabId!;
        useDbViewerStore.getState().setTabData(ordersTab, {
            columns: ordersColumns,
            rows: [[7, 99]],
            total_rows: 1,
            page: 1,
            page_size: 50,
        } as any);
        useDbViewerStore.getState().setActiveTab(usersTab);

        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );
        const cell = await waitFor(() => screen.getByText("Alice"));
        fireEvent.contextMenu(cell);
        fireEvent.click(screen.getByText("View Row"));

        // The drawer is bound to the clicked row's Row Identity, never to the
        // grid position it happened to sit at.
        expect(await screen.findByText("Row detail")).toBeInTheDocument();
        const key = rowSelectionKey(usersColumns as any, [1, "Alice"], "postgresql")!;
        expect(
            useDbViewerStore.getState().tabs.find((t) => t.id === usersTab)!.rowDetail,
        ).toEqual({ setIndex: 0, key });

        // Switching tabs closes it: another table's rows are never shown inside
        // a drawer opened for a different result set.
        act(() => {
            useDbViewerStore.getState().setActiveTab(ordersTab);
        });
        await waitFor(() => expect(screen.queryByText("Row detail")).toBeNull());
    });

    it("opens the row detail of the result set it was clicked in", async () => {
        const usersColumns = rowDetailUsersColumns;
        const ordersColumns = rowDetailOrdersColumns;
        const usersRows = [[1, "Alice"]];
        const orderRows = [[1, 999]];
        // Two result sets whose rows share the same primary-key value: the
        // drawer must resolve inside the set it was opened from.
        useDbViewerStore.setState({
            tabs: [
                {
                    id: "q1",
                    schema: "public",
                    table: "Query",
                    page: 1,
                    pageSize: 50,
                    loading: false,
                    error: null,
                    data: { columns: usersColumns, rows: usersRows, total_rows: 1, page: 1, page_size: 50 },
                    multi: {
                        result_sets: [
                            { columns: usersColumns, rows: usersRows, total_rows: 1, page: 1, page_size: 50 },
                            { columns: ordersColumns, rows: orderRows, total_rows: 1, page: 1, page_size: 50 },
                        ],
                        notices: [],
                        execution_time_ms: 5,
                    },
                    filterRules: [],
                    sortRules: [],
                    hiddenColumns: [],
                    smartSortApplied: true,
                    tabType: "query",
                    query: "select * from users; select * from orders",
                    origin: currentChangeOrigin(),
                },
            ],
            activeTabId: "q1",
        } as any);
        render(
            <DbViewerScreen
                connectionId="c1"
                onHome={() => {}}
                onSettings={() => {}}
            />,
        );

        const cell = await waitFor(() => screen.getByText("999"));
        fireEvent.contextMenu(cell);
        fireEvent.click(screen.getByText("View Row"));

        expect(await screen.findByText("Row detail")).toBeInTheDocument();
        expect(
            useDbViewerStore.getState().tabs[0].rowDetail,
        ).toEqual({
            setIndex: 1,
            key: rowSelectionKey(ordersColumns as any, [1, 999], "postgresql"),
        });
    });
});
