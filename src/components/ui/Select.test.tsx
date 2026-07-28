import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select } from "./Select";

describe("Select", () => {
  it("renders options and calls onChange", async () => {
    const onChange = vi.fn();
    render(
      <Select
        value="medium"
        onChange={onChange}
        options={[
          { value: "small", label: "Small" },
          { value: "medium", label: "Medium" },
          { value: "large", label: "Large" },
        ]}
        label="Font size"
      />,
    );
    const select = screen.getByLabelText("Font size");
    expect(select).toHaveValue("medium");
    await userEvent.selectOptions(select, "large");
    expect(onChange).toHaveBeenCalledWith("large");
  });
});