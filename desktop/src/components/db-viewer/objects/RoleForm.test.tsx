import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RoleForm } from "./RoleForm";
import { useDbViewerStore } from "../../../stores/dbViewerStore";
import * as cmd from "../../../lib/commands";

beforeEach(() => {
  useDbViewerStore.getState().reset();
  vi.spyOn(cmd, "buildObjectDdl").mockReset().mockResolvedValue(["CREATE ROLE app;"]);
  vi.spyOn(cmd, "getRoles").mockReset().mockResolvedValue([]);
});

function baseParams(mode: "create" | "edit") {
  return {
    schema: "",
    name: mode === "edit" ? "app" : "",
    action: {
      op: mode === "edit" ? "edit" : "create",
      login: mode === "edit",
      superuser: false,
      createdb: false,
      createrole: false,
      inherit: true,
      replication: false,
      bypassrls: false,
      connection_limit: -1,
      valid_until: "",
      password: "",
      members: [],
    },
  } as any;
}

describe("RoleForm", () => {
  it("create role with options writes params", () => {
    const onChange = vi.fn();
    render(
      <RoleForm
        connectionId="c1"
        params={baseParams("create")}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Role name"), { target: { value: "app" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: "app" }));

    fireEvent.click(screen.getByLabelText("LOGIN"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: expect.objectContaining({ login: true }) }),
    );
  });

  it("edit mode password field is blank with keep hint", () => {
    render(
      <RoleForm
        connectionId="c1"
        mode="edit"
        params={baseParams("edit")}
        onChange={() => {}}
      />,
    );
    expect(screen.getByPlaceholderText(/leave blank to keep/i)).toBeInTheDocument();
  });

  it("stages a create role ddl via the queue", async () => {
    render(
      <RoleForm
        connectionId="c1"
        params={{
          schema: "",
          name: "app",
          action: {
            op: "create",
            login: true,
            superuser: false,
            createdb: false,
            createrole: false,
            inherit: true,
            replication: false,
            bypassrls: false,
            connection_limit: -1,
            valid_until: "",
            password: "secret",
            members: [],
          },
        }}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));
    await waitFor(() => {
      const q = useDbViewerStore.getState().changesQueue;
      expect(q).toHaveLength(1);
      expect(q[0].type).toBe("ddl");
      expect(q[0].sql).toBe("CREATE ROLE app;");
    });
  });
});