import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ObjectFormTab } from "./ObjectFormTab";
import * as objectCrud from "../../../lib/objectCrud";
import {
  useDbViewerStore,
  type ViewerTab,
} from "../../../stores/dbViewerStore";

vi.mock("../../../lib/objectCrud", () => ({
  buildObjectDdl: vi.fn(),
}));

describe("ObjectFormTab", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    useDbViewerStore.getState().reset();
  });

  const connectionId = "c1";
  const baseTab: ViewerTab = {
    id: "form-tab-1",
    schema: "public",
    table: "Create sequence",
    page: 1,
    pageSize: 50,
    loading: false,
    error: null,
    data: null,
    filterRules: [],
    sortRules: [],
    hiddenColumns: [],
    smartSortApplied: false,
    tabType: "objectForm",
    objectType: null,
    form: {
      kind: "sequence",
      title: "Create sequence",
      description: "Create my_seq",
      mode: "create",
      params: { schema: "public", name: "my_seq", action: { op: "create" } },
    },
  };

  it("renders the form for a sequence kind in Visual view", () => {
    vi.mocked(objectCrud.buildObjectDdl).mockResolvedValue([
      "CREATE SEQUENCE \"public\".\"my_seq\" START WITH 1;",
    ]);
    render(<ObjectFormTab connectionId={connectionId} tab={baseTab} />);
    expect(screen.getByPlaceholderText("Sequence name")).toBeInTheDocument();
  });

  it("toggles to SQL and shows the generated SQL, then back to Visual", async () => {
    vi.mocked(objectCrud.buildObjectDdl).mockResolvedValue([
      "CREATE SEQUENCE \"public\".\"my_seq\" START WITH 1;",
    ]);
    render(<ObjectFormTab connectionId={connectionId} tab={baseTab} />);

    fireEvent.click(screen.getByRole("button", { name: "SQL" }));
    await waitFor(() =>
      expect(
        screen.getByText(/CREATE SEQUENCE "public"."my_seq"/),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Visual" }));
    expect(screen.getByPlaceholderText("Sequence name")).toBeInTheDocument();
  });

  it("stages one ddl change and closes the tab", async () => {
    vi.mocked(objectCrud.buildObjectDdl).mockResolvedValue([
      "CREATE SEQUENCE \"public\".\"my_seq\" START WITH 1;",
    ]);
    useDbViewerStore.setState({
      tabs: [baseTab],
      activeTabId: baseTab.id,
    });
    const addChange = vi.spyOn(useDbViewerStore.getState(), "addChange");

    render(<ObjectFormTab connectionId={connectionId} tab={baseTab} />);
    fireEvent.click(screen.getByRole("button", { name: /stage/i }));

    await waitFor(() =>
      expect(addChange).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ddl",
          sql: 'CREATE SEQUENCE "public"."my_seq" START WITH 1;',
          description: "Create my_seq",
        }),
      ),
    );
    expect(useDbViewerStore.getState().tabs).toHaveLength(0);
  });

  it("stages multiple statements with (n/total) descriptions", async () => {
    vi.mocked(objectCrud.buildObjectDdl).mockResolvedValue([
      "DROP SEQUENCE \"public\".\"my_seq\";",
      "CREATE SEQUENCE \"public\".\"my_seq\" START WITH 1;",
    ]);
    useDbViewerStore.setState({
      tabs: [baseTab],
      activeTabId: baseTab.id,
    });
    const addChange = vi.spyOn(useDbViewerStore.getState(), "addChange");

    render(<ObjectFormTab connectionId={connectionId} tab={baseTab} />);
    fireEvent.click(screen.getByRole("button", { name: /stage/i }));

    await waitFor(() => {
      expect(addChange).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ description: "Create my_seq (1/2)" }),
      );
      expect(addChange).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ description: "Create my_seq (2/2)" }),
      );
    });
    expect(useDbViewerStore.getState().tabs).toHaveLength(0);
  });

  it("shows a builder error and disables Stage", async () => {
    vi.mocked(objectCrud.buildObjectDdl).mockRejectedValueOnce(
      "Name is required",
    );
    render(<ObjectFormTab connectionId={connectionId} tab={baseTab} />);

    await waitFor(() =>
      expect(screen.getByText(/Name is required/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /stage/i })).toBeDisabled();
  });

  it("renders only the uppercase kicker, not a duplicate title heading", () => {
    vi.mocked(objectCrud.buildObjectDdl).mockResolvedValue([]);
    render(
      <ObjectFormTab
        connectionId={connectionId}
        tab={{
          ...baseTab,
          table: "Create Function",
          form: {
            ...baseTab.form!,
            kind: "function",
            title: "Create Function",
          },
        }}
      />,
    );
    // Kicker: lowercase DOM text uppercased by CSS
    expect(screen.getByText("create function")).toBeInTheDocument();
    expect(screen.queryByText("Create Function")).toBeNull();
  });
});