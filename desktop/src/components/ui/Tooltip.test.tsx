import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tooltip, TooltipProvider } from "./Tooltip";

describe("Tooltip", () => {
  it("renders children", () => {
    render(
      <TooltipProvider>
        <Tooltip content="Help text">
          <button>Hover me</button>
        </Tooltip>
      </TooltipProvider>
    );
    expect(screen.getByText("Hover me")).toBeInTheDocument();
  });

  it("shows tooltip on hover", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Tooltip content="Help text">
          <button>Hover me</button>
        </Tooltip>
      </TooltipProvider>
    );
    await user.hover(screen.getByText("Hover me"));
    expect(await screen.findByText("Help text")).toBeInTheDocument();
  });

  it("hides tooltip on unhover", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Tooltip content="Help text">
          <button>Hover me</button>
        </Tooltip>
      </TooltipProvider>
    );
    await user.hover(screen.getByText("Hover me"));
    expect(await screen.findByText("Help text")).toBeInTheDocument();
    await user.unhover(screen.getByText("Hover me"));
    expect(screen.queryByText("Help text")).not.toBeInTheDocument();
  });

  // Leak regression: the 300 ms show-timer used to survive unmount, so it fired
  // `setActiveId` on a torn-down tree — React then reached for `window`, which a
  // finished test environment has deleted. That surfaced as an unhandled
  // "ReferenceError: window is not defined" (seen in CI while
  // QueryHistoryDropdown.test.tsx was running).
  it("clears the pending show-timer on unmount", () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(
        <TooltipProvider>
          <Tooltip content="Help text">
            <button>Hover me</button>
          </Tooltip>
        </TooltipProvider>,
      );

      fireEvent.mouseEnter(screen.getByText("Hover me"));
      expect(vi.getTimerCount()).toBe(1);

      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});