import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "./Input";

describe("Input", () => {
  it("renders placeholder", () => {
    render(<Input placeholder="Search..." />);
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
  });
  it("fires onChange with value", async () => {
    const fn = vi.fn();
    render(<Input onChange={fn} placeholder="x" />);
    await userEvent.type(screen.getByPlaceholderText("x"), "hi");
    expect(fn).toHaveBeenLastCalledWith("hi");
  });

  it("uses the shared rounded (non-pill) radius", () => {
    const { container } = render(<Input value="" onChange={() => {}} aria-label="x" />);
    const input = container.querySelector("input")!;
    expect(input.className).toContain("rounded-lg");
    expect(input.className).not.toContain("rounded-full");
  });
});