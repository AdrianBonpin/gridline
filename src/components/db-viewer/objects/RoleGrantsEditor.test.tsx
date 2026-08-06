import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RoleGrantsEditor } from "./RoleGrantsEditor";
import { useDbViewerStore } from "../../../stores/dbViewerStore";
import * as cmd from "../../../lib/commands";
import type { PrivilegeEntry } from "../../../lib/types";

beforeEach(() => {
  useDbViewerStore.getState().reset();
  vi.spyOn(cmd, "getRolePrivileges").mockReset().mockResolvedValue([]);
  vi.spyOn(cmd, "buildObjectDdl").mockReset().mockResolvedValue(["GRANT SELECT ON TABLE public.users TO app;"]);
});

describe("RoleGrantsEditor", () => {
  it("toggling a privilege stages a GRANT ddl change", async () => {
    render(<RoleGrantsEditor connectionId="c1" role="app" />);

    fireEvent.change(screen.getByLabelText("Object class"), { target: { value: "table" } });
    fireEvent.change(screen.getByPlaceholderText("Schema"), { target: { value: "public" } });
    fireEvent.change(screen.getByPlaceholderText("Object name"), { target: { value: "users" } });

    fireEvent.click(screen.getByLabelText("SELECT"));
    fireEvent.click(screen.getByRole("button", { name: /grant/i }));

    await waitFor(() => {
      const q = useDbViewerStore.getState().changesQueue;
      expect(q.some((c) => c.type === "ddl" && c.sql.startsWith("GRANT"))).toBe(true);
    });
  });

  it("shows first 5 privileges while collapsed, expands to show all", async () => {
    vi.spyOn(cmd, "getRolePrivileges").mockResolvedValue([
      { object_class: "table", schema: "public", name: "users", privileges: ["SELECT"], grantable: false },
    ]);
    render(<RoleGrantsEditor connectionId="c1" role="app" />);
    // Fewer than 5 entries — visible immediately without expanding.
    expect(await screen.findByText("public.users")).toBeInTheDocument();
    expect((await screen.findAllByText("SELECT")).length).toBeGreaterThanOrEqual(1);
  });

  it("truncates long sections to 5 entries with a fade and Show more", async () => {
    const entries: PrivilegeEntry[] = Array.from({ length: 7 }, (_, i) => ({
      object_class: "table",
      schema: "public",
      name: `t${i + 1}`,
      privileges: ["SELECT"],
      grantable: false,
    }));
    vi.spyOn(cmd, "getRolePrivileges").mockResolvedValue(entries);
    render(<RoleGrantsEditor connectionId="c1" role="app" />);
    // Collapsed by default: first 5 visible, rest hidden.
    expect(await screen.findByText("public.t1")).toBeInTheDocument();
    expect(screen.getByText("public.t5")).toBeInTheDocument();
    expect(screen.queryByText("public.t6")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show 2 more/i }));
    expect(await screen.findByText("public.t6")).toBeInTheDocument();
    expect(screen.getByText("public.t7")).toBeInTheDocument();
    // Header chevron can collapse it back.
    fireEvent.click(screen.getByRole("button", { name: /toggle table privileges/i }));
    expect(screen.queryByText("public.t6")).not.toBeInTheDocument();
  });
});