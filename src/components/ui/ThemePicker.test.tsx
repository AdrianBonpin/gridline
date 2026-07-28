import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemePicker } from "./ThemePicker";

describe("ThemePicker", () => {
  it("renders three options and emits selected theme", async () => {
    const onChange = vi.fn();
    render(<ThemePicker value="dark" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(onChange).toHaveBeenCalledWith("system");
  });
});