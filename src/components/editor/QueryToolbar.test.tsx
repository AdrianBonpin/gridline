import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryToolbar, queryShortcut } from "./QueryToolbar";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { TooltipProvider } from "../ui/Tooltip";

function renderToolbar(props: {
  onRun?: () => void;
  onFormat?: () => void;
  dbType?: "postgresql" | "mysql" | "sqlite" | "redis";
  resultsCollapsed?: boolean;
  onToggleResults?: () => void;
}) {
  return render(
    <TooltipProvider>
      <QueryToolbar
        onRun={props.onRun ?? (() => {})}
        onFormat={props.onFormat ?? (() => {})}
        dbType={props.dbType}
        resultsCollapsed={props.resultsCollapsed ?? false}
        onToggleResults={props.onToggleResults ?? (() => {})}
      />
    </TooltipProvider>,
  );
}

describe("queryShortcut", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "platform", {
      value: "",
      configurable: true,
    });
  });

  it("uses the command symbol and enter glyph on mac", () => {
    expect(queryShortcut("MacIntel")).toEqual({ mod: "⌘", enter: "⏎" });
  });

  it("uses Ctrl + Enter on other platforms", () => {
    expect(queryShortcut("Win32")).toEqual({ mod: "Ctrl", enter: "Enter" });
    expect(queryShortcut("Linux x86_64")).toEqual({
      mod: "Ctrl",
      enter: "Enter",
    });
  });

  it("renders the mac shortcut in the run tooltip", async () => {
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
    renderToolbar({});
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: /run query/i }).parentElement!,
    );
    await waitFor(() => expect(screen.getByText("⌘")).toBeInTheDocument());
    expect(screen.getByText("⏎")).toBeInTheDocument();
  });

  it("renders Ctrl + Enter in the run tooltip on non-mac", async () => {
    Object.defineProperty(navigator, "platform", {
      value: "Linux x86_64",
      configurable: true,
    });
    renderToolbar({});
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: /run query/i }).parentElement!,
    );
    await waitFor(() => expect(screen.getByText("Ctrl")).toBeInTheDocument());
    expect(screen.getByText("Enter")).toBeInTheDocument();
  });
});

describe("QueryToolbar", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
  });

  it("renders Run Query and the format icon button", () => {
    renderToolbar({});
    expect(
      screen.getByRole("button", { name: /run query/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /auto format/i }),
    ).toBeInTheDocument();
  });

  it("shows the SQL dialect on the right", () => {
    renderToolbar({ dbType: "postgresql" });
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    renderToolbar({ dbType: "mysql" });
    expect(screen.getByText("MySQL")).toBeInTheDocument();
  });

  it("hides the dialect badge when no db type is known", () => {
    renderToolbar({});
    expect(screen.queryByText(/postgresql|mysql|sqlite|redis/i)).toBeNull();
  });

  it("runs the query when Run Query is clicked", () => {
    const onRun = vi.fn();
    renderToolbar({ onRun });
    fireEvent.click(screen.getByRole("button", { name: /run query/i }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("calls onFormat when the format icon is clicked", () => {
    const onFormat = vi.fn();
    renderToolbar({ onFormat });
    fireEvent.click(screen.getByRole("button", { name: /auto format/i }));
    expect(onFormat).toHaveBeenCalledTimes(1);
  });

  it("starts with an unfilled play icon", () => {
    renderToolbar({});
    const playSvg = screen
      .getByRole("button", { name: /run query/i })
      .querySelector("svg");
    expect(playSvg).toHaveAttribute("fill", "none");
  });

  it("shows the pulse while the active query tab is loading", () => {
    useDbViewerStore.getState().openQueryTab();
    useDbViewerStore.setState((s) => ({
      tabs: s.tabs.map((t) => ({ ...t, loading: true })),
    }));
    renderToolbar({});
    expect(screen.getByTestId("query-run-pulse")).toBeInTheDocument();
  });

  it("hides the pulse when the query is idle", () => {
    useDbViewerStore.getState().openQueryTab();
    renderToolbar({});
    expect(screen.queryByTestId("query-run-pulse")).toBeNull();
  });

  it("renders the format action as an icon only (no text label)", () => {
    renderToolbar({});
    const button = screen.getByRole("button", { name: /auto format/i });
    expect(button.textContent?.trim()).toBe("");
  });

  it("toggles the results panel via the caret", () => {
    const onToggleResults = vi.fn();
    renderToolbar({ onToggleResults });
    fireEvent.click(screen.getByLabelText(/hide results/i));
    expect(onToggleResults).toHaveBeenCalledTimes(1);
  });

  it("shows an expand caret when results are collapsed", () => {
    renderToolbar({ resultsCollapsed: true, onToggleResults: () => {} });
    expect(screen.getByLabelText(/show results/i)).toBeInTheDocument();
  });
});