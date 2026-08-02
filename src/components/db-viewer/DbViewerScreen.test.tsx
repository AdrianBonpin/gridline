import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { DbViewerScreen } from "./DbViewerScreen";
import { useDbViewerStore } from "../../stores/dbViewerStore";
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
});