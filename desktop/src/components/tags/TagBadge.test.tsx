import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagBadge } from "./TagBadge";
import type { Tag } from "../../lib/types";

const tag: Tag = { id: "t1", name: "production", color: "#ef4444", created_at: "" };

describe("TagBadge", () => {
  it("renders tag name", () => {
    render(<TagBadge tag={tag} />);
    expect(screen.getByText("production")).toBeInTheDocument();
  });
  it("toggles active state on click", async () => {
    const fn = vi.fn();
    render(<TagBadge tag={tag} active={false} onToggle={fn} />);
    await userEvent.click(screen.getByText("production"));
    expect(fn).toHaveBeenCalledWith("t1");
  });
  it("shows active styling when active", () => {
    render(<TagBadge tag={tag} active={true} onToggle={() => {}} />);
    expect(screen.getByText("production").className).toContain("brightness");
  });
});