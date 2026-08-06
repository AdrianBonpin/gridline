import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RoleDetail } from "./RoleDetail";
import { useDbViewerStore } from "../../../stores/dbViewerStore";
import * as cmd from "../../../lib/commands";
import type { RoleInfo } from "../../../lib/types";

beforeEach(() => {
  useDbViewerStore.getState().reset();
  vi.spyOn(cmd, "getRolePrivileges").mockReset().mockResolvedValue([
    { object_class: "table", schema: "public", name: "users", privileges: ["SELECT"], grantable: false },
  ]);
});

const baseRole: RoleInfo = {
  name: "app",
  superuser: false,
  inherit: true,
  create_db: false,
  create_role: false,
  can_login: true,
  replication: false,
  bypass_rls: false,
  connection_limit: -1,
  valid_until: null,
  memberships: [],
};

describe("RoleDetail", () => {
  it("renders role attributes + memberships + grants editor", async () => {
    render(<RoleDetail connectionId="c1" item={baseRole} />);
    expect(screen.getByText("app")).toBeInTheDocument();
    expect(screen.getByText("Can login")).toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("button", { name: /toggle table privileges/i }),
    );
    expect(await screen.findByText("public.users")).toBeInTheDocument();
  });

  it("renders memberships when present", () => {
    render(
      <RoleDetail
        connectionId="c1"
        item={{
          ...baseRole,
          memberships: [{ role: "app", member: "other", grantor: "postgres", admin_option: true }],
        }}
      />,
    );
    expect(screen.getByText("other")).toBeInTheDocument();
  });
});