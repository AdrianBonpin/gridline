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
describe("DependencyDialog as the whole drop acknowledgement", () => {
  const deps = [{ deptype: "n", class: "pg_class", name: "v_orders" }];

  it("uses the caller's heading, notice, acknowledgement and confirm label", () => {
    render(
      <DependencyDialog
        open
        deps={deps}
        title="Delete Table: orders"
        dependencyNotice="These objects depend on it:"
        message="Deleting it loses all of its data."
        acknowledgementLabel="I understand they may block the drop."
        confirmLabel="Delete Table"
        onProceed={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Delete Table: orders")).toBeTruthy();
    expect(screen.getByText("These objects depend on it:")).toBeTruthy();
    expect(
      screen.getByText("Deleting it loses all of its data."),
    ).toBeTruthy();
    expect(
      screen.getByText("I understand they may block the drop."),
    ).toBeTruthy();
    // One dialog, one confirming action.
    const confirm = screen.getByRole("button", { name: /^delete table$/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirm).toBeEnabled();
    expect(screen.getAllByRole("button")).toHaveLength(2); // cancel + confirm
  });

  it("keeps the existing defaults when no copy is supplied", () => {
    render(
      <DependencyDialog
        open
        deps={deps}
        onProceed={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Dependencies")).toBeTruthy();
    expect(
      screen.getByText(/will be removed with CASCADE/i),
    ).toBeTruthy();
    expect(
      screen.getByText("I understand these will be dropped."),
    ).toBeTruthy();
  });
});
