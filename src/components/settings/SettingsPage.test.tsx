import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage";

describe("SettingsPage", () => {
  it("renders settings title and back button", () => {
    render(<SettingsPage />);
    expect(screen.getByText(/settings/i)).toBeInTheDocument();
    expect(screen.getByText(/back/i)).toBeInTheDocument();
  });

  it("renders tag management section by default", () => {
    render(<SettingsPage />);
    expect(screen.getByText(/manage tags/i)).toBeInTheDocument();
    expect(screen.getByText(/create tag/i)).toBeInTheDocument();
  });
});