import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectionDropBanner } from "./ConnectionDropBanner";

describe("ConnectionDropBanner", () => {
  it("shows error message", () => {
    render(
      <ConnectionDropBanner
        error="Connection lost"
        onRetry={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText("Connection lost")).toBeInTheDocument();
  });

  it("shows reconnect button", () => {
    render(
      <ConnectionDropBanner
        error="Connection lost"
        onRetry={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /reconnect/i })).toBeInTheDocument();
  });

  it("calls onRetry when reconnect clicked", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <ConnectionDropBanner
        error="Connection lost"
        onRetry={onRetry}
        onDismiss={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: /reconnect/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("calls onDismiss when close button clicked", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(
      <ConnectionDropBanner
        error="Connection lost"
        onRetry={() => {}}
        onDismiss={onDismiss}
      />,
    );
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});