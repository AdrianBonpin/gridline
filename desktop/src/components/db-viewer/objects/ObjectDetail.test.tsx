import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
    ObjectDetail,
    OBJECT_ICONS,
    SINGULAR_LABELS,
    TYPE_LABELS,
} from "./ObjectDetail";
import * as commands from "../../../lib/commands";

describe("ObjectDetail", () => {
  it("renders an enum's labels as list items", () => {
    render(
      <ObjectDetail
        connectionId="c1"
        type="enums"
        item={{ name: "role", schema: "public", labels: ["admin", "user"] }}
      />,
    );
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("user")).toBeInTheDocument();
  });

  it("renders a function's return type and language", () => {
    render(
      <ObjectDetail
        connectionId="c1"
        type="functions"
        item={{
          name: "add",
          schema: "public",
          return_type: "int",
          argument_types: ["integer", "text"],
          argument_names: ["a", "b"],
          argument_modes: ["IN", "IN"],
          language: "plpgsql",
          source: "BEGIN RETURN a+b; END",
          kind: "f",
        }}
      />,
    );
    expect(screen.getByText("int")).toBeInTheDocument();
    expect(screen.getAllByText(/plpgsql/i).length).toBeGreaterThanOrEqual(1);
  });

  it("roles detail renders RoleDetail", () => {
    vi.spyOn(commands, "getRolePrivileges").mockResolvedValue([]);
    render(
      <ObjectDetail
        connectionId="c1"
        type="roles"
        item={{
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
        }}
      />,
    );
    expect(screen.getByText("app")).toBeInTheDocument();
  });

  it("registries include roles", () => {
    expect(TYPE_LABELS.roles).toBe("Roles");
    expect(SINGULAR_LABELS.roles).toBe("role");
    expect(OBJECT_ICONS.roles).toBeTruthy();
  });
});