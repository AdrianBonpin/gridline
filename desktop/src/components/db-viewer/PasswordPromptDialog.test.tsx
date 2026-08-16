import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PasswordPromptDialog } from "./PasswordPromptDialog";

describe("PasswordPromptDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <PasswordPromptDialog
        open={false}
        connectionName="n"
        onConnect={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the connection name and a password field when open", () => {
    render(
      <PasswordPromptDialog
        open={true}
        connectionName="Prod DB"
        onConnect={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/Prod DB/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/password/i)).toBeInTheDocument();
  });

  it("calls onConnect with the typed value", () => {
    const onConnect = vi.fn();
    render(
      <PasswordPromptDialog
        open={true}
        connectionName="X"
        onConnect={onConnect}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/password/i), {
      target: { value: "p@ss" },
    });
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));
    expect(onConnect).toHaveBeenCalledWith("p@ss");
  });

  it("calls onCancel on cancel", () => {
    const onCancel = vi.fn();
    render(
      <PasswordPromptDialog
        open={true}
        connectionName="X"
        onConnect={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});