import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProviderSetupGuide } from "./ProviderSetupGuide";

describe("ProviderSetupGuide", () => {
  it("renders Supabase SSL note immediately and steps after expanding", async () => {
    const user = userEvent.setup();
    render(<ProviderSetupGuide provider="supabase" />);
    expect(screen.getByText(/SSL is required by Supabase/i)).toBeInTheDocument();
    expect(screen.queryByText(/Open the Supabase Dashboard/i)).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /how to connect/i });
    await user.click(toggle);
    expect(screen.getByText(/Open the Supabase Dashboard/i)).toBeInTheDocument();
  });

  it("renders Neon SSL note immediately and steps after expanding", async () => {
    const user = userEvent.setup();
    render(<ProviderSetupGuide provider="neon" />);
    expect(screen.getByText(/Neon requires SSL/i)).toBeInTheDocument();
    expect(screen.queryByText(/Open the Neon Console/i)).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /how to connect/i });
    await user.click(toggle);
    expect(screen.getByText(/Open the Neon Console/i)).toBeInTheDocument();
  });

  it("starts collapsed and expands on toggle", async () => {
    const user = userEvent.setup();
    render(<ProviderSetupGuide provider="supabase" />);
    const toggle = screen.getByRole("button", { name: /how to connect/i });
    expect(screen.queryByText(/Open the Supabase Dashboard/i)).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText(/Open the Supabase Dashboard/i)).toBeInTheDocument();
  });
});