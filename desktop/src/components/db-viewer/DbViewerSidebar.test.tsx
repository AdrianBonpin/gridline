import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DbViewerSidebar } from "./DbViewerSidebar";
import { TooltipProvider } from "../ui/Tooltip";
import { DB_CAPABILITIES } from "../../lib/dbCapabilities";

describe("DbViewerSidebar", () => {
  it("renders all navigation icons", () => {
    render(
      <TooltipProvider>
        <DbViewerSidebar currentView="db-viewer" onNavigate={() => {}} />
      </TooltipProvider>
    );
    expect(screen.getByLabelText(/home/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/settings/i)).toBeInTheDocument();
  });

  it("calls onNavigate when home is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <TooltipProvider>
        <DbViewerSidebar currentView="db-viewer" onNavigate={onNavigate} />
      </TooltipProvider>
    );
    await user.click(screen.getByLabelText(/home/i));
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  it("calls onNavigate when settings is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <TooltipProvider>
        <DbViewerSidebar currentView="db-viewer" onNavigate={onNavigate} />
      </TooltipProvider>
    );
    await user.click(screen.getByLabelText(/settings/i));
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  it("renders Schema Visualizer nav item (not coming soon)", () => {
    render(
      <TooltipProvider>
        <DbViewerSidebar currentView="db-viewer" onNavigate={() => {}} />
      </TooltipProvider>
    );
    // Should find the label WITHOUT "coming soon"
    const btn = screen.getByLabelText(/schema visualizer/i);
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it("renders Queries nav item", () => {
    render(
      <TooltipProvider>
        <DbViewerSidebar currentView="db-viewer" onNavigate={() => {}} />
      </TooltipProvider>
    );
    expect(screen.getByLabelText("Queries")).toBeInTheDocument();
  });

  it("renders Tools nav item", () => {
    render(
      <TooltipProvider>
        <DbViewerSidebar currentView="db-viewer" onNavigate={() => {}} />
      </TooltipProvider>
    );
    expect(screen.getByLabelText("Tools")).toBeInTheDocument();
  });

  it("shows all 5 tools for PostgreSQL (default capabilities)", () => {
    render(
      <TooltipProvider>
        <DbViewerSidebar currentView="db-viewer" onNavigate={() => {}} />
      </TooltipProvider>
    );
    expect(screen.getByLabelText(/explorer/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Queries")).toBeInTheDocument();
    expect(screen.getByLabelText(/schema visualizer/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/objects/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tools/i)).toBeInTheDocument();
  });

  it("shows Tools but hides Objects for SQLite", () => {
    render(
      <TooltipProvider>
        <DbViewerSidebar currentView="db-viewer" onNavigate={() => {}} capabilities={DB_CAPABILITIES.sqlite} />
      </TooltipProvider>
    );
    expect(screen.getByLabelText(/explorer/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Queries")).toBeInTheDocument();
    expect(screen.getByLabelText(/schema visualizer/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tools/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/objects/i)).not.toBeInTheDocument();
  });

  it("shows Tools but hides Objects and Visualizer for MySQL", () => {
    render(
      <TooltipProvider>
        <DbViewerSidebar currentView="db-viewer" onNavigate={() => {}} capabilities={DB_CAPABILITIES.mysql} />
      </TooltipProvider>
    );
    expect(screen.getByLabelText(/explorer/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Queries")).toBeInTheDocument();
    expect(screen.getByLabelText(/tools/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/schema visualizer/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/objects/i)).not.toBeInTheDocument();
  });

  it("shows no top nav items for Redis (unsupported browsing)", () => {
    render(
      <TooltipProvider>
        <DbViewerSidebar currentView="db-viewer" onNavigate={() => {}} capabilities={DB_CAPABILITIES.redis} />
      </TooltipProvider>
    );
    expect(screen.queryByLabelText(/explorer/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Queries")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/schema visualizer/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/home/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/settings/i)).toBeInTheDocument();
  });
});