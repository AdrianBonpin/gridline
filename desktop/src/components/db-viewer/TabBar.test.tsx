import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabBar } from "./TabBar";
import { useDbViewerStore } from "../../stores/dbViewerStore";

const user = userEvent.setup();

describe("TabBar", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
  });

  it("renders the fixed Query and Changes actions when no tabs are open", () => {
    render(<TabBar />);
    expect(screen.getByRole("button", { name: /new query/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Changes queue" })).toBeInTheDocument();
  });

  it("renders open tab names", () => {
    useDbViewerStore.getState().openTab("public", "users");
    useDbViewerStore.getState().openTab("public", "posts", true);

    render(<TabBar />);
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("posts")).toBeInTheDocument();
  });

  it("sets active tab when clicked", async () => {
    const store = useDbViewerStore.getState();
    store.openTab("public", "users");
    store.openTab("public", "posts", true);
    const firstTabId = useDbViewerStore.getState().tabs[0].id;

    render(<TabBar />);
    await user.click(screen.getByText("users"));
    expect(useDbViewerStore.getState().activeTabId).toBe(firstTabId);
  });

  it("opens a new query tab when Query is clicked", async () => {
    const user = userEvent.setup();
    render(<TabBar />);
    await user.click(screen.getByRole("button", { name: /new query/i }));
    const state = useDbViewerStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].tabType).toBe("query");
    expect(state.activeTabId).toBe(state.tabs[0].id);
  });

  it("shows the pending change count and toggles the changes panel", async () => {
    const user = userEvent.setup();
    useDbViewerStore.getState().addChange({
      type: "update",
      schema: "public",
      table: "users",
      primaryKey: { id: 1 },
      oldData: { name: "Bob" },
      newData: { name: "Alice" },
    });
    useDbViewerStore.setState({ changesPanelExpanded: false });

    render(<TabBar />);
    const changesButton = screen.getByRole("button", { name: "Changes queue" });

    await user.click(changesButton);
    expect(useDbViewerStore.getState().changesPanelExpanded).toBe(true);

    await user.click(changesButton);
    expect(useDbViewerStore.getState().changesPanelExpanded).toBe(false);
  });

  it("renders a table icon on table tabs", () => {
    useDbViewerStore.getState().openTab("public", "users");
    render(<TabBar />);
    expect(screen.getByTestId("tab-icon-table")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-icon-query")).not.toBeInTheDocument();
  });

  it("renders a query icon on query tabs", () => {
    useDbViewerStore.getState().openQueryTab();
    render(<TabBar />);
    expect(screen.getByTestId("tab-icon-query")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-icon-table")).not.toBeInTheDocument();
  });

  it("renders the per-type icon on an object tab", () => {
    useDbViewerStore.getState().openObjectTab("functions", "public", "add", { name: "add", schema: "public" });
    render(<TabBar />);
    const icon = screen.getByLabelText(/object icon: functions/i);
    const svg = icon.querySelector("svg");
    expect(svg).toBeTruthy();
    // Regression: the icon must use the SAME handling as the query/table icons —
    // the svg itself is display:inline with the shared optical-centering classes.
    // That defeats preflight svg{display:block} (no stacking) and lets
    // vertical-align:middle center it with the tab name.
    const cls = svg!.getAttribute("class") ?? "";
    expect(cls).toContain("inline");
    expect(cls).toContain("-mt-0.5");
    expect(screen.getByText("add")).toBeInTheDocument();
  });

  it("renders a view icon on view tabs", () => {
    useDbViewerStore.getState().openTab("main", "order_summary");
    useDbViewerStore.setState({
      tables: [
        { name: "order_summary", schema: "main", table_type: "VIEW" },
      ],
    });
    render(<TabBar />);
    expect(screen.getByTestId("tab-icon-view")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-icon-table")).not.toBeInTheDocument();
  });

  it("renders a create icon and title on an objectForm create tab", () => {
    useDbViewerStore.getState().openFormTab({
      kind: "sequence",
      schema: "public",
      name: "",
      title: "Create sequence",
      description: "Create sequence",
      mode: "create",
      params: { schema: "public", name: "", action: { op: "create" } },
    });
    render(<TabBar />);
    expect(screen.getByTestId("tab-icon-form-create")).toBeInTheDocument();
    expect(screen.getByText("Create sequence")).toBeInTheDocument();
  });

  it("renders an edit icon on an objectForm edit tab", () => {
    useDbViewerStore.getState().openFormTab({
      kind: "sequence",
      schema: "public",
      name: "s",
      title: "Edit sequence",
      description: "Edit sequence",
      mode: "edit",
      params: { schema: "public", name: "s", action: { op: "alter" } },
    });
    render(<TabBar />);
    expect(screen.getByTestId("tab-icon-form-edit")).toBeInTheDocument();
  });

  it("renders a layers icon on materialized view tabs", () => {
    useDbViewerStore.getState().openTab("public", "mv_products");
    useDbViewerStore.setState({
      tables: [
        {
          name: "mv_products",
          schema: "public",
          table_type: "MATERIALIZED VIEW" as any,
        },
      ],
    });
    render(<TabBar />);
    expect(screen.getByTestId("tab-icon-matview")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-icon-table")).not.toBeInTheDocument();
  });

  it("shows the changes count as an icon with a badge", () => {
    useDbViewerStore.getState().addChange({
      type: "update",
      schema: "public",
      table: "users",
      primaryKey: { id: 1 },
      oldData: { name: "Bob" },
      newData: { name: "Alice" },
    });
    useDbViewerStore.getState().addChange({
      type: "insert",
      schema: "public",
      table: "posts",
      newData: { title: "hi" },
    });

    render(<TabBar />);
    const button = screen.getByRole("button", { name: "Changes queue" });
    expect(button.querySelector("svg")).not.toBeNull();
    expect(within(button).getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("Changes")).toBeNull();
  });

  it("hides the count badge when there are no pending changes", () => {
    render(<TabBar />);
    const button = screen.getByRole("button", { name: "Changes queue" });
    expect(within(button).queryByText(/\d/)).toBeNull();
  });

  it("closes tab when close button clicked", async () => {
    useDbViewerStore.getState().openTab("public", "users");
    useDbViewerStore.getState().openTab("public", "posts", true);
    const firstTabId = useDbViewerStore.getState().tabs[0].id;

    render(<TabBar />);
    const closeButton = screen.getByRole("button", {
      name: /close users/i,
    });
    await user.click(closeButton);

    expect(useDbViewerStore.getState().tabs).toHaveLength(1);
    expect(
      useDbViewerStore.getState().tabs.find((t) => t.id === firstTabId),
    ).toBeUndefined();
  });

  it("opens the changes popover when the button is clicked", async () => {
    const user = userEvent.setup();
    useDbViewerStore.getState().addChange({
      type: "update",
      schema: "public",
      table: "users",
      primaryKey: { id: 1 },
      oldData: { name: "Bob" },
      newData: { name: "Alice" },
    });
    useDbViewerStore.setState({ changesPanelExpanded: false });
    render(<TabBar />);
    expect(screen.queryByText(/pending changes/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Changes queue" }));
    expect(screen.getByText(/pending changes/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /commit all/i })).toBeInTheDocument();
  });

  it("closes the changes popover on Escape", async () => {
    const user = userEvent.setup();
    useDbViewerStore.getState().addChange({
      type: "insert",
      schema: "public",
      table: "users",
      newData: { id: 1 },
      description: "Insert row into users",
    });
    useDbViewerStore.setState({ changesPanelExpanded: true });
    render(<TabBar />);
    expect(screen.getByText(/pending changes/i)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText(/pending changes/i)).toBeNull();
  });

  it("turns the button border amber when there are pending changes", () => {
    useDbViewerStore.getState().addChange({
      type: "insert",
      schema: "public",
      table: "users",
      newData: { id: 1 },
      description: "Insert row into users",
    });
    render(<TabBar />);
    const button = screen.getByRole("button", { name: "Changes queue" });
    expect(button.className).toContain("border-amber-500");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Drag & drop reorder — keep this test LAST in this file.
  //
  // The vitest config does not enable `globals: true`, so RTL's auto-cleanup
  // never unmounts components between tests. A dnd-kit drag leaves its DndContext
  // (and document-level listeners) mounted, which silently breaks userEvent/fireEvent
  // clicks in any LATER test. The drag itself is fully verified here; placing it
  // last isolates the pollution.
  // ─────────────────────────────────────────────────────────────────────────

  it("reorders tabs via drag and drop (horizontal axis only)", async () => {
    const { act, fireEvent } = await import("@testing-library/react");
    const store = useDbViewerStore.getState();
    store.openTab("public", "users");
    store.openTab("public", "posts", true);
    store.openTab("public", "comments", true);

    // jsdom reports zero-sized rects and non-primary pointers by default,
    // which breaks dnd-kit collision detection + pointer activation.
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const text = this.textContent ?? "";
      const index = text.includes("posts")
        ? 1
        : text.includes("comments")
          ? 2
          : 0;
      const x = index * 100;
      return {
        x,
        y: 0,
        width: 100,
        height: 30,
        left: x,
        right: x + 100,
        top: 0,
        bottom: 30,
        toJSON: () => ({}),
      } as DOMRect;
    };

    try {
      render(<TabBar />);
      const usersTab = screen.getByRole("tab", { name: "users" });

      // pointerDown lifts the tab (distance constraint >= 4px on move), then
      // moves it over the last tab and drops.
      await act(async () => {
        fireEvent.pointerDown(usersTab, {
          pointerId: 1,
          clientX: 50,
          clientY: 15,
          button: 0,
          isPrimary: true,
        });
      });
      await act(async () => {
        fireEvent.pointerMove(usersTab, {
          pointerId: 1,
          clientX: 160,
          clientY: 15,
        });
      });
      await act(async () => {
        fireEvent.pointerMove(usersTab, {
          pointerId: 1,
          clientX: 260,
          clientY: 15,
        });
      });
      await act(async () => {
        fireEvent.pointerUp(usersTab, {
          pointerId: 1,
          clientX: 260,
          clientY: 15,
        });
      });
      // Flush dnd-kit's post-drag rAF focus-restore so it cannot leak into
      // later tests (userEvent clicks are order-sensitive in jsdom).
      await act(async () => {});
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }

    expect(
      useDbViewerStore.getState().tabs.map((t) => t.table),
    ).toEqual(["posts", "comments", "users"]);
  });

});