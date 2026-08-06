import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ObjectExplorerPage } from "./ObjectExplorerPage";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import * as commands from "../../lib/commands";

describe("ObjectExplorerPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useDbViewerStore.getState().reset();
    useDbViewerStore.setState({
      schemas: ["public"],
      currentSchema: "public",
    });
    vi.spyOn(commands, "getFunctions").mockResolvedValue([]);
    vi.spyOn(commands, "getIndexes").mockResolvedValue([]);
    vi.spyOn(commands, "getConstraints").mockResolvedValue([]);
    vi.spyOn(commands, "getTriggers").mockResolvedValue([]);
    vi.spyOn(commands, "getSequences").mockResolvedValue([]);
    vi.spyOn(commands, "getEnums").mockResolvedValue([]);
    vi.spyOn(commands, "getExtensions").mockResolvedValue([]);
  });

  

  it("renders functions by default", async () => {
    vi.spyOn(commands, "getFunctions").mockResolvedValue([
      {
        name: "add_one",
        schema: "public",
        return_type: "int",
        argument_types: ["int"],
        argument_names: ["x"],
        argument_modes: ["IN"],
        language: "sql",
        source: "SELECT $1 + 1",
        kind: "f",
      },
    ]);
    render(<ObjectExplorerPage connectionId="c1" />);
    await waitFor(() =>
      expect(screen.getByText("add_one(int)")).toBeInTheDocument(),
    );
  });

  it("functions type filters to kind === 'f'", async () => {
    vi.spyOn(commands, "getFunctions").mockResolvedValue([
      {
        name: "do_thing",
        schema: "public",
        return_type: "void",
        argument_types: [],
        argument_names: [],
        argument_modes: [],
        language: "plpgsql",
        source: "BEGIN END",
        kind: "p",
      },
      {
        name: "calc",
        schema: "public",
        return_type: "int",
        argument_types: [],
        argument_names: [],
        argument_modes: [],
        language: "sql",
        source: "SELECT 1",
        kind: "f",
      },
    ]);
    render(<ObjectExplorerPage connectionId="c1" />);
    await waitFor(() => expect(screen.getByText("calc")).toBeInTheDocument());
    expect(screen.queryByText("do_thing")).not.toBeInTheDocument();
  });

  it("indexes type fetches getIndexes and renders the index name + detail", async () => {
    const user = userEvent.setup();
    const getIndexes = vi.spyOn(commands, "getIndexes").mockResolvedValue([
      {
        name: "idx_users_email",
        schema: "public",
        table: "users",
        definition: "CREATE INDEX idx_users_email ON users USING btree (email);",
        is_unique: true,
        method: "btree",
        columns: ["email"],
        size_bytes: 8192,
        tablespace: null,
      },
    ]);
    render(<ObjectExplorerPage connectionId="c1" />);
    await user.click(screen.getByLabelText("Object type"));
    await user.click(screen.getByText("Indexes"));
    await waitFor(() =>
      expect(screen.getByText("idx_users_email")).toBeInTheDocument(),
    );
    expect(getIndexes).toHaveBeenCalledWith("c1", "public");
    await user.click(screen.getByText("idx_users_email"));
    await waitFor(() => {
      expect(screen.getByText("Index")).toBeInTheDocument();
      expect(screen.getAllByText("btree").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("8192")).toBeInTheDocument();
    });
  });

  it("constraints type fetches getConstraints and renders the constraint name + detail", async () => {
    const user = userEvent.setup();
    const getConstraints = vi.spyOn(commands, "getConstraints").mockResolvedValue([
      {
        name: "chk_users_positive",
        schema: "public",
        table: "users",
        contype: "CHECK",
        definition: "CHECK (age > 0)",
        deferrable: false,
        validated: true,
        columns: ["age"],
      },
    ]);
    render(<ObjectExplorerPage connectionId="c1" />);
    await user.click(screen.getByLabelText("Object type"));
    await user.click(screen.getByText("Constraints"));
    await waitFor(() =>
      expect(screen.getByText("chk_users_positive")).toBeInTheDocument(),
    );
    expect(getConstraints).toHaveBeenCalledWith("c1", "public");
    await user.click(screen.getByText("chk_users_positive"));
    await waitFor(() => {
      expect(screen.getByText("Constraint")).toBeInTheDocument();
      expect(screen.getAllByText("CHECK").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Deferrable")).toBeInTheDocument();
    });
  });

  it("shows 'No indexes found' when getIndexes returns []", async () => {
    const user = userEvent.setup();
    vi.spyOn(commands, "getIndexes").mockResolvedValue([]);
    render(<ObjectExplorerPage connectionId="c1" />);
    await user.click(screen.getByLabelText("Object type"));
    await user.click(screen.getByText("Indexes"));
    await waitFor(() =>
      expect(screen.getByText("No indexes found")).toBeInTheDocument(),
    );
  });

  it("shows an error message when getIndexes rejects", async () => {
    const user = userEvent.setup();
    vi.spyOn(commands, "getIndexes").mockRejectedValue(new Error("boom"));
    render(<ObjectExplorerPage connectionId="c1" />);
    await user.click(screen.getByLabelText("Object type"));
    await user.click(screen.getByText("Indexes"));
    await waitFor(() =>
      expect(screen.getByText("boom")).toBeInTheDocument(),
    );
  });

  it("procedures type filters getFunctions to kind === 'p'", async () => {
    const user = userEvent.setup();
    vi.spyOn(commands, "getFunctions").mockResolvedValue([
      {
        name: "do_thing",
        schema: "public",
        return_type: "void",
        argument_types: [],
        argument_names: [],
        argument_modes: [],
        language: "plpgsql",
        source: "BEGIN END",
        kind: "p",
      },
      {
        name: "calc",
        schema: "public",
        return_type: "int",
        argument_types: [],
        argument_names: [],
        argument_modes: [],
        language: "sql",
        source: "SELECT 1",
        kind: "f",
      },
    ]);
    render(<ObjectExplorerPage connectionId="c1" />);
    await user.click(screen.getByLabelText("Object type"));
    await user.click(screen.getByText("Procedures"));
    await waitFor(() =>
      expect(screen.getByText("do_thing")).toBeInTheDocument(),
    );
    expect(screen.queryByText("calc")).not.toBeInTheDocument();
  });

  it("Copy DDL calls getObjectDdl and writes to clipboard", async () => {
    vi.spyOn(commands, "getEnums").mockResolvedValue([
      { name: "role", schema: "public", labels: ["a"] },
    ]);
    vi.spyOn(commands, "getObjectDdl").mockResolvedValue("CREATE TYPE ...");
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<ObjectExplorerPage connectionId="c1" />);
    fireEvent.click(screen.getByLabelText("Object type"));
    fireEvent.click(screen.getByText("Enums"));
    await waitFor(() => screen.getByText("role"));
    fireEvent.click(screen.getAllByLabelText(/options/i)[0]);
    fireEvent.click(screen.getByText(/copy ddl/i));
    await waitFor(() =>
      expect(commands.getObjectDdl).toHaveBeenCalledWith("c1", "public", "enum", "role"),
    );
    expect(writeText).toHaveBeenCalledWith("CREATE TYPE ...");
  });

  it("View dependencies opens DependencyDialog", async () => {
    vi.spyOn(commands, "getFunctions").mockResolvedValue([
      {
        name: "add_one",
        schema: "public",
        return_type: "int",
        argument_types: ["int"],
        argument_names: ["x"],
        argument_modes: ["IN"],
        language: "sql",
        source: "SELECT $1 + 1",
        kind: "f",
      },
    ]);
    vi.spyOn(commands, "getObjectDependencies").mockResolvedValue([
      { deptype: "n", class: "pg_class", name: "v" },
    ]);
    render(<ObjectExplorerPage connectionId="c1" />);
    await waitFor(() => screen.getByText("add_one(int)"));
    fireEvent.click(screen.getAllByLabelText(/options/i)[0]);
    fireEvent.click(screen.getByText(/dependencies/i));
    await waitFor(() => expect(commands.getObjectDependencies).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("v")).toBeTruthy());
  });

  it("refetches the current object list after a ddl commit succeeds", async () => {
    const getFunctions = vi
      .spyOn(commands, "getFunctions")
      .mockResolvedValue([]);
    render(<ObjectExplorerPage connectionId="c1" />);
    await waitFor(() => expect(getFunctions).toHaveBeenCalledTimes(1));
    useDbViewerStore.getState().addChange({
      type: "ddl",
      sql: "DROP INDEX public.i",
      description: "Drop index i",
    } as any);
    useDbViewerStore.getState().markChangeCommitted("ch-1");
    await waitFor(() => expect(getFunctions).toHaveBeenCalledTimes(2));
  });

  it("preselects type from store on mount", () => {
    useDbViewerStore.setState({ selectedObjectType: "sequences" });
    render(<ObjectExplorerPage connectionId="c1" />);
    expect(screen.getByText("Sequences")).toBeTruthy();
  });
});