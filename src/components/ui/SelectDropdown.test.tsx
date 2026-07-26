import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SelectDropdown } from "./SelectDropdown";

describe("SelectDropdown", () => {
  it("renders the selected label and opens a popover menu", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SelectDropdown
        value="staging"
        onChange={onChange}
        options={[
          { value: "", label: "None" },
          { value: "production", label: "Production" },
          { value: "staging", label: "Staging" },
          { value: "development", label: "Development" },
        ]}
        placeholder="None"
      />,
    );

    const trigger = screen.getByRole("button", { name: /Staging/i });
    expect(trigger).toBeInTheDocument();

    await user.click(trigger);
    expect(screen.getByRole("button", { name: /Production/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Development/i }));
    expect(onChange).toHaveBeenCalledWith("development");
  });
});