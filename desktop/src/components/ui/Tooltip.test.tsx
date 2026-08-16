import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
});