import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TableOverflowMenu } from "./TableOverflowMenu";

describe("TableOverflowMenu", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn() },
      configurable: true,
      writable: true,
    });
  });

  it("renders menu trigger button", () => {
    render(<TableOverflowMenu schema="public" table="users" onOpenTab={() => "tab-1"} />);
    expect(screen.getByLabelText(/table options/i)).toBeInTheDocument();
  });

  it("shows menu options on click", async () => {
    const user = userEvent.setup();
    render(<TableOverflowMenu schema="public" table="users" onOpenTab={() => "tab-1"} />);
    await user.click(screen.getByLabelText(/table options/i));
    expect(screen.getByText("Open in new tab")).toBeInTheDocument();
    expect(screen.getByText("Copy table schema")).toBeInTheDocument();
    expect(screen.getByText("Export data (CSV)")).toBeInTheDocument();
  });

  it("fires onOpenTab when menu item clicked", async () => {
    const user = userEvent.setup();
    const onOpenTab = vi.fn().mockReturnValue("tab-1");
    render(<TableOverflowMenu schema="public" table="users" onOpenTab={onOpenTab} />);
    await user.click(screen.getByLabelText(/table options/i));
    await user.click(screen.getByText("Open in new tab"));
    expect(onOpenTab).toHaveBeenCalledWith("public", "users", true);
  });
});