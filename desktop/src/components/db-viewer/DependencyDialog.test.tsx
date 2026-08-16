import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DependencyDialog } from "./DependencyDialog";

describe("DependencyDialog", () => {
  it("empty list shows no-dependencies message", () => {
    render(<DependencyDialog open deps={[]} onProceed={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/no dependencies/i)).toBeTruthy();
  });

  it("non-empty lists rows and requires checkbox to proceed", () => {
    const deps = [{ deptype: "n", class: "pg_class", name: "v_orders" }];
    render(<DependencyDialog open deps={deps} onProceed={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("v_orders")).toBeTruthy();
    expect(screen.getByRole("button", { name: /proceed/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: /proceed/i })).toBeEnabled();
  });
});