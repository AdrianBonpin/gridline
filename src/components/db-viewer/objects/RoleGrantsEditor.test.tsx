import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RoleGrantsEditor } from "./RoleGrantsEditor";
import { useDbViewerStore } from "../../../stores/dbViewerStore";
import * as cmd from "../../../lib/commands";

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

  it("renders current privileges grouped by object class", async () => {
    vi.spyOn(cmd, "getRolePrivileges").mockResolvedValue([
      { object_class: "table", schema: "public", name: "users", privileges: ["SELECT"], grantable: false },
    ]);
    render(<RoleGrantsEditor connectionId="c1" role="app" />);
    expect(await screen.findByText("public.users")).toBeInTheDocument();
    expect((await screen.findAllByText("SELECT")).length).toBeGreaterThanOrEqual(1);
  });
});