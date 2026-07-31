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
    expect(screen.getByRole("button", { name: /changes queue/i })).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
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
    const changesButton = screen.getByRole("button", { name: /changes queue/i });
    expect(within(changesButton).getByText("1")).toBeInTheDocument();

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
    const button = screen.getByRole("button", { name: /changes queue/i });
    expect(button.querySelector("svg")).not.toBeNull();
    expect(within(button).getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("Changes")).toBeNull();
  });

  it("hides the count badge when there are no pending changes", () => {
    render(<TabBar />);
    const button = screen.getByRole("button", { name: /changes queue/i });
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
});