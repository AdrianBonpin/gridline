import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProviderTabsGrid } from "./ProviderTabsGrid";

describe("ProviderTabsGrid", () => {
  it("renders exactly 6 provider cards in order", () => {
    render(<ProviderTabsGrid onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /PostgreSQL/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /MySQL/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SQLite/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Redis/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Supabase/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /NeonDB/i })).toBeInTheDocument();
  });

  it("applies the 2-column grid layout class", () => {
    const { container } = render(<ProviderTabsGrid onSelect={() => {}} />);
    const grid = container.querySelector('[data-testid="provider-grid"]');
    expect(grid?.className).toContain("grid-cols-2");
  });

  it("calls onSelect with the provider id when a card is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ProviderTabsGrid onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: /MySQL/i }));
    expect(onSelect).toHaveBeenCalledWith("mysql");
  });

  it("highlights the selected provider", () => {
    render(<ProviderTabsGrid onSelect={() => {}} selectedId="mysql" />);
    const mysqlBtn = screen.getByRole("button", { name: /MySQL/i });
    expect(mysqlBtn.className).toContain("border-accent");
  });

  it("renders setup-guide content on Supabase and NeonDB cards", () => {
    render(<ProviderTabsGrid onSelect={() => {}} />);
    expect(screen.getByText(/managed postgresql/i)).toBeInTheDocument();
    expect(screen.getByText(/serverless postgres/i)).toBeInTheDocument();
  });
});