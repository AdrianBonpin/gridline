import { describe, it, expect, vi } from "vitest";
import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnimatedModal } from "./AnimatedModal";

describe("AnimatedModal", () => {
  it("renders content when open", () => {
    render(
      <AnimatedModal open={true} onClose={vi.fn()}>
        <p>Modal body</p>
      </AnimatedModal>
    );
    expect(screen.getByText("Modal body")).toBeInTheDocument();
  });

  it("calls onClose when backdrop is clicked", async () => {
    const onClose = vi.fn();
    render(
      <AnimatedModal open={true} onClose={onClose}>
        <div data-testid="panel">Panel</div>
      </AnimatedModal>
    );
    await userEvent.click(screen.getByTestId("animated-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });

  it("removes content from DOM after exit animation", async () => {
    const { rerender } = render(
      <AnimatedModal open={true} onClose={vi.fn()}>
        <p>Modal body</p>
      </AnimatedModal>
    );
    rerender(
      <AnimatedModal open={false} onClose={vi.fn()}>
        <p>Modal body</p>
      </AnimatedModal>
    );
    await waitForElementToBeRemoved(() => screen.queryByText("Modal body"));
    expect(screen.queryByText("Modal body")).not.toBeInTheDocument();
  });
});