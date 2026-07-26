import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsSection } from "./SettingsSection";

describe("SettingsSection", () => {
  it("renders the title and children", () => {
    render(
      <SettingsSection title="Appearance">
        <div>Content</div>
      </SettingsSection>
    );
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("uses the surface background on the inner card", () => {
    const { container } = render(
      <SettingsSection title="Appearance">
        <div />
      </SettingsSection>
    );
    const card = container.querySelector(".bg-surface");
    expect(card).toBeInTheDocument();
  });
});