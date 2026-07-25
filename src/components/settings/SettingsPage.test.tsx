import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage";

describe("SettingsPage", () => {
  it("renders all section headings", () => {
    render(<SettingsPage />);
    expect(screen.getByText(/general/i)).toBeInTheDocument();
    expect(screen.getByText(/appearance/i)).toBeInTheDocument();
    expect(screen.getByText(/connections/i)).toBeInTheDocument();
    expect(screen.getByText(/keyboard shortcuts/i)).toBeInTheDocument();
    expect(screen.getByText(/^tags$/i)).toBeInTheDocument();
    expect(screen.getByText(/about/i)).toBeInTheDocument();
  });

  it("renders a back button", () => {
    render(<SettingsPage />);
    expect(screen.getByText(/back/i)).toBeInTheDocument();
  });
});