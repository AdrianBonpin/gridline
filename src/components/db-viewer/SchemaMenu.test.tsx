import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as cmd from "../../lib/commands";
import { SchemaMenu } from "./SchemaMenu";

vi.mock("../../lib/commands");

describe("SchemaMenu", () => {
  beforeEach(() => {
    vi.mocked(cmd.createSchema).mockReset();
    vi.mocked(cmd.renameSchema).mockReset();
    vi.mocked(cmd.dropSchema).mockReset();
    vi.mocked(cmd.getObjectDependencies).mockReset();
  });

  it("create happy path calls createSchema then refreshTree", async () => {
    vi.mocked(cmd.createSchema).mockResolvedValue(undefined);
    const refresh = vi.fn();
    render(<SchemaMenu connectionId="c1" onRefresh={refresh} />);
    fireEvent.click(screen.getByLabelText(/new schema/i));
    fireEvent.change(screen.getByPlaceholderText(/schema name/i), { target: { value: "myschema" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(cmd.createSchema).toHaveBeenCalledWith("c1", "myschema"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("drop non-empty requires cascade checkbox + typed confirm", async () => {
    vi.mocked(cmd.getObjectDependencies).mockResolvedValue([{ deptype: "n", class: "pg_class", name: "users" }]);
    vi.mocked(cmd.dropSchema).mockResolvedValue(undefined);
    const refresh = vi.fn();
    render(<SchemaMenu connectionId="c1" schema="s" onRefresh={refresh} />);
    fireEvent.click(screen.getByLabelText(/schema menu/i));
    fireEvent.click(screen.getByText(/drop/i));
    await waitFor(() => expect(cmd.getObjectDependencies).toHaveBeenCalledWith("c1", "s", "schema", "s"));
    await waitFor(() => expect(screen.getByText("users")).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByPlaceholderText(/type the schema name/i), { target: { value: "s" } });
    fireEvent.click(screen.getByRole("button", { name: /drop schema/i }));
    await waitFor(() => expect(cmd.dropSchema).toHaveBeenCalledWith("c1", "s", true));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});