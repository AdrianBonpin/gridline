import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsRow } from "./SettingsRow";

describe("SettingsRow", () => {
  it("renders title, description, and control", () => {
    render(
      <SettingsRow title="Font size" description="Adjust text size.">
        <button>Control</button>
      </SettingsRow>
    );
    expect(screen.getByText("Font size")).toBeInTheDocument();
    expect(screen.getByText("Adjust text size.")).toBeInTheDocument();
    expect(screen.getByText("Control")).toBeInTheDocument();
  });

  it("has a bottom border by default", () => {
    const { container } = render(
      <SettingsRow title="Item">
        <span />
      </SettingsRow>
    );
    expect(container.firstChild).toHaveClass("border-b");
  });

  it("removes the bottom border on the last row", () => {
    const { container } = render(
      <>
        <SettingsRow title="First">
          <span />
        </SettingsRow>
        <SettingsRow title="Last">
          <span />
        </SettingsRow>
      </>
    );
    const rows = container.querySelectorAll(".border-b");
    expect(rows).toHaveLength(2);
    const lastRow = rows[rows.length - 1];
    expect(lastRow).toHaveClass("last:border-b-0");
  });
});