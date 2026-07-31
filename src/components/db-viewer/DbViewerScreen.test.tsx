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

vi.mock("@monaco-editor/react", () => ({
    default: ({ value, onChange, onMount }: any) => {
        if (onMount) {
            onMount({
                addAction: vi.fn(),
                getValue: () => value,
                setValue: (v: string) => onChange?.(v),
                focus: vi.fn(),
            });
        }
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
}));

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
        },
    ],
    rows: [[1]],
    total_rows: 1,
    page: 1,
    page_size: 50,
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
        expect(screen.getByText("Run")).toBeInTheDocument();
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
        fireEvent.click(screen.getByText("Run"));
        await waitFor(() =>
            expect(executeQuery).toHaveBeenCalledWith("c1", "SELECT 1", 1, 50),
        );
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
        fireEvent.click(screen.getByText("Run"));
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