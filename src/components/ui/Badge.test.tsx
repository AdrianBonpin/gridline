import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders label and color", () => {
    render(<Badge label="production" color="#ef4444" />);
    const el = screen.getByText("production");
    expect(el).toBeInTheDocument();
    expect(el).toHaveStyle({ color: "#ef4444", backgroundColor: "#ef444433" });
  });
  it("fires onClick when provided", async () => {
    const fn = vi.fn();
    render(<Badge label="x" color="#fff" onClick={fn} />);
    await userEvent.click(screen.getByText("x"));
    expect(fn).toHaveBeenCalledOnce();
  });
});