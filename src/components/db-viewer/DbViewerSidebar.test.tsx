import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DbViewerSidebar } from "./DbViewerSidebar";
import { TooltipProvider } from "../ui/Tooltip";

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

  it("renders Objects nav item", () => {
    render(
      <TooltipProvider>
        <DbViewerSidebar currentView="db-viewer" onNavigate={() => {}} />
      </TooltipProvider>
    );
    expect(screen.getByLabelText("Objects")).toBeInTheDocument();
  });
});