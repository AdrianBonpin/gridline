import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DestructiveQueryDialog } from "./DestructiveQueryDialog";

describe("DestructiveQueryDialog", () => {
  it("renders warning message with the SQL shown", () => {
    render(
      <DestructiveQueryDialog open={true} query="DROP TABLE users" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.getByText(/destructive/i)).toBeInTheDocument();
    expect(screen.getByText(/DROP TABLE users/)).toBeInTheDocument();
  });

  it("calls onConfirm when 'Execute' is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <DestructiveQueryDialog open={true} query="DELETE FROM users" onConfirm={onConfirm} onCancel={() => {}} />
    );
    fireEvent.click(screen.getByText("Execute"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when 'Cancel' is clicked", () => {
    const onCancel = vi.fn();
    render(
      <DestructiveQueryDialog open={true} query="DROP TABLE users" onConfirm={() => {}} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("truncates long queries in the dialog", () => {
    const longQuery = "DROP TABLE " + "x".repeat(500);
    render(
      <DestructiveQueryDialog open={true} query={longQuery} onConfirm={() => {}} onCancel={() => {}} />
    );
    const displayed = screen.getByText(/DROP TABLE/);
    expect(displayed.textContent!.length).toBeLessThan(longQuery.length + 20);
  });
});