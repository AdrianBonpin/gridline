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
});