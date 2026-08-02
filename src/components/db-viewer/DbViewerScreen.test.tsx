import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import {
    DbViewerScreen,
    deriveStagedValues,
    pickDisplayColumn,
} from "./DbViewerScreen";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useUiStore } from "../../stores/uiStore";
import * as commands from "../../lib/commands";

vi.mock("../../hooks/useDbConnection", () => ({
    useDbConnection: (_connectionId: string) => ({
        connectionError: null,
        connect: vi.fn(),
    }),
}));

vi.mock("@tanstack/react-virtual", () => ({
    useVirtualizer: () => ({
        getVirtualItems: () => [],
        getTotalSize: () => 0,
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
            .spyOn(commands, "executeQuery")
            .mockResolvedValue(mockQueryResult as any);
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
            .spyOn(commands, "executeQuery")
            .mockResolvedValue({
                columns: [],
                rows: [],
                total_rows: 0,
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

    it("refreshes the schema tree after a DDL query runs", async () => {
        vi.spyOn(commands, "executeQuery").mockResolvedValue(
            mockQueryResult as any,
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
        vi.spyOn(commands, "executeQuery").mockResolvedValue(
            mockQueryResult as any,
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
        await waitFor(() => expect(commands.executeQuery).toHaveBeenCalled());
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
            .spyOn(commands, "executeQuery")
            .mockResolvedValue(mockQueryResult as any);
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
        vi.spyOn(commands, "executeQuery").mockReturnValue(pending as any);
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
        resolveRun(mockQueryResult);
        await waitFor(() =>
            expect(screen.queryByTestId("query-run-pulse")).toBeNull(),
        );
    });

    it("collapses and re-expands the query results via the caret", async () => {
        const executeQuery = vi
            .spyOn(commands, "executeQuery")
            .mockResolvedValue(mockQueryResult as any);
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
        vi.spyOn(commands, "executeQuery").mockResolvedValue(
            mockQueryResult as any,
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

    it("fetches enum labels and FK reference rows for the active table tab", async () => {
        const getEnums = vi
            .spyOn(commands, "getEnums")
            .mockResolvedValue([
                {
                    name: "user_role",
                    schema: "public",
                    labels: ["admin", "user"],
                },
            ]);
        const getTableData = vi
            .spyOn(commands, "getTableData")
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
                ],
                rows: [[1], [2]],
                total_rows: 2,
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
                                fk_ref: ["users", "id"],
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
                        rows: [[1, 2, "admin"]],
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
        // FK reference rows are fetched from the referenced table (page 1, 50).
        await waitFor(() =>
            expect(getTableData).toHaveBeenCalledWith(
                "c1",
                "public",
                "users",
                1,
                50,
            ),
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
});