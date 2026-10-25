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

  it("names the offending statement in a multi-statement script", () => {
    render(
      <DestructiveQueryDialog
        open={true}
        query="SELECT 1; DROP TABLE demo;"
        statementIndex={2}
        statementCount={2}
        reason="schema"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const detail = screen.getByTestId("destructive-statement-detail");
    expect(detail).toHaveTextContent("Statement 2 of 2");
    expect(detail).toHaveTextContent(/schema-modifying/i);
  });

  it("explains an unverifiable statement", () => {
    render(
      <DestructiveQueryDialog
        open={true}
        query="CALL refresh_all();"
        statementIndex={1}
        statementCount={1}
        reason="unknown"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const detail = screen.getByTestId("destructive-statement-detail");
    expect(detail).toHaveTextContent(/could not be verified as read-only/i);
    // A single-statement script has no "statement N of M" prefix.
    expect(detail).not.toHaveTextContent(/Statement 1 of 1/);
  });

  it("renders no detail row when no analysis is supplied (backwards compatible)", () => {
    render(
      <DestructiveQueryDialog
        open={true}
        query="DROP TABLE users"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByTestId("destructive-statement-detail")).toBeNull();
  });
});