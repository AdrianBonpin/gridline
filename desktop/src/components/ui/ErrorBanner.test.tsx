import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBanner } from "./ErrorBanner";

describe("ErrorBanner", () => {
  it("renders nothing when no error", () => {
    const { container } = render(<ErrorBanner error={null} onRetry={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
  it("renders message and retry button when error", () => {
    const fn = vi.fn();
    render(<ErrorBanner error="Storage error" onRetry={fn} />);
    expect(screen.getByText(/storage error/i)).toBeInTheDocument();
    expect(screen.getByText(/retry/i)).toBeInTheDocument();
  });
  it("fires onRetry", async () => {
    const fn = vi.fn();
    render(<ErrorBanner error="x" onRetry={fn} />);
    await userEvent.click(screen.getByText(/retry/i));
    expect(fn).toHaveBeenCalledOnce();
  });
});