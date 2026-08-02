import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StatusDot } from "./StatusDot";
import * as commands from "../../lib/commands";

describe("StatusDot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("starts idle and becomes online after a successful check", async () => {
    vi.spyOn(commands, "getConnectionPassword").mockResolvedValue("pw");
    vi.spyOn(commands, "testConnection").mockResolvedValue({ ok: true, server_version: "15.2", latency_ms: 12 } as any);
    render(<StatusDot connectionId="c1" buildConfig={() => ({ name: "P", db_type: "postgresql", host: "h", port: 5432, username: "u", password: "pw" } as any)} />);
    const dot = screen.getByRole("button", { name: /check connection/i });
    expect(dot).toHaveAttribute("data-state", "idle");
    fireEvent.click(dot);
    await waitFor(() => expect(dot).toHaveAttribute("data-state", "online"));
    expect(screen.getByText(/15\.2/)).toBeInTheDocument();
  });
  it("becomes offline on a failed check and shows the error", async () => {
    vi.spyOn(commands, "getConnectionPassword").mockResolvedValue("pw");
    vi.spyOn(commands, "testConnection").mockResolvedValue({ ok: false, error: "timeout" } as any);
    render(<StatusDot connectionId="c1" buildConfig={() => ({ name: "P", db_type: "postgresql", host: "h", port: 5432, username: "u" } as any)} />);
    const dot = screen.getByRole("button", { name: /check connection/i });
    fireEvent.click(dot);
    await waitFor(() => expect(dot).toHaveAttribute("data-state", "offline"));
    expect(screen.getByText(/timeout/)).toBeInTheDocument();
  });
  it("debounces: a second click within 2s is ignored", async () => {
    const pw = vi.spyOn(commands, "getConnectionPassword").mockResolvedValue("pw");
    vi.spyOn(commands, "testConnection").mockResolvedValue({ ok: true } as any);
    render(<StatusDot connectionId="c1" buildConfig={() => ({ name: "P", db_type: "postgresql", host: "h", port: 5432 } as any)} />);
    const dot = screen.getByRole("button", { name: /check connection/i });
    fireEvent.click(dot);
    fireEvent.click(dot);
    await waitFor(() => expect(pw).toHaveBeenCalledTimes(1));
  });
});