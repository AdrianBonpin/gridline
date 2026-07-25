import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewConnectionForm } from "./NewConnectionForm";

describe("NewConnectionForm", () => {
  it("shows validation error when name empty on submit", async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<NewConnectionForm onCreate={fn} onCancel={() => {}} />);
    await user.click(screen.getByText(/save/i));
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls onCreate with valid input", async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<NewConnectionForm onCreate={fn} onCancel={() => {}} />);
    await user.type(screen.getByPlaceholderText(/connection name/i), "Prod");
    await user.type(screen.getByPlaceholderText(/hostname/i), "prod.example.com");
    await user.type(screen.getByPlaceholderText(/port/i), "5432");
    await user.click(screen.getByText(/save/i));
    expect(fn).toHaveBeenCalled();
    const arg = fn.mock.calls[0][0];
    expect(arg.name).toBe("Prod");
    expect(arg.db_type).toBe("postgresql");
    expect(arg.host).toBe("prod.example.com");
    expect(arg.port).toBe(5432);
  });
});