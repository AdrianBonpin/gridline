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

  it("omits bottom border when last is true", () => {
    const { container } = render(
      <SettingsRow title="Last one" last>
        <span />
      </SettingsRow>
    );
    expect(container.firstChild).not.toHaveClass("border-b");
  });
});