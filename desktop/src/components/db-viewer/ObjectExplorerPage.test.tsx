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
    fireEvent.click(screen.getAllByLabelText(/actions/i)[0]);
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
    fireEvent.click(screen.getAllByLabelText(/actions/i)[0]);
    fireEvent.click(screen.getByText(/dependencies/i));
    await waitFor(() => expect(commands.getObjectDependencies).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("v")).toBeTruthy());
  });

  it("per-item menu offers Create…/Edit…/Drop… and Edit opens an objectForm tab", async () => {
    vi.spyOn(commands, "getEnums").mockResolvedValue([
      { name: "role", schema: "public", labels: ["admin"] },
    ]);
    render(<ObjectExplorerPage connectionId="c1" />);
    fireEvent.click(screen.getByLabelText("Object type"));
    fireEvent.click(screen.getByText("Enums"));
    await waitFor(() => screen.getByText("role"));
    fireEvent.click(screen.getAllByLabelText(/actions/i)[0]);
    expect(screen.getByText("Create…")).toBeInTheDocument();
    expect(screen.getByText("Edit…")).toBeInTheDocument();
    expect(screen.getByText("Drop…")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Edit…"));
    const st = useDbViewerStore.getState();
    expect(st.tabs).toHaveLength(1);
    expect(st.tabs[0].tabType).toBe("objectForm");
    expect(st.tabs[0].form?.mode).toBe("edit");
  });

  it("right-click on a list row opens the context menu", async () => {
    vi.spyOn(commands, "getEnums").mockResolvedValue([
      { name: "role", schema: "public", labels: ["admin"] },
    ]);
    render(<ObjectExplorerPage connectionId="c1" />);
    fireEvent.click(screen.getByLabelText("Object type"));
    fireEvent.click(screen.getByText("Enums"));
    const row = await screen.findByText("role");
    fireEvent.contextMenu(row);
    expect(screen.getByText("Create…")).toBeInTheDocument();
    expect(screen.getByText("Edit…")).toBeInTheDocument();
  });

  it("header + create button opens an objectForm create tab for the current type", async () => {
    vi.spyOn(commands, "getEnums").mockResolvedValue([
      { name: "role", schema: "public", labels: ["admin"] },
    ]);
    render(<ObjectExplorerPage connectionId="c1" />);
    fireEvent.click(screen.getByLabelText("Object type"));
    fireEvent.click(screen.getByText("Enums"));
    await waitFor(() => screen.getByText("role"));
    fireEvent.click(screen.getByRole("button", { name: /create enum/i }));
    const st = useDbViewerStore.getState();
    expect(st.tabs).toHaveLength(1);
    expect(st.tabs[0].tabType).toBe("objectForm");
    expect(st.tabs[0].form?.mode).toBe("create");
    expect(st.tabs[0].form?.kind).toBe("enum");
    expect(st.tabs[0].form?.params?.schema).toBe("public");
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

  it("sidebarMode: clicking a list row opens an object tab instead of an inline detail", async () => {
    vi.spyOn(commands, "getFunctions").mockResolvedValue([
      {
        name: "add",
        schema: "public",
        return_type: "int",
        argument_types: [],
        argument_names: [],
        argument_modes: [],
        language: "plpgsql",
        source: "BEGIN RETURN 1; END",
        kind: "f",
      },
    ]);
    render(<ObjectExplorerPage connectionId="c1" sidebarMode />);
    await waitFor(() =>
      expect(screen.getByText("add")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("add"));
    const st = useDbViewerStore.getState();
    expect(
      st.tabs.some(
        (t) => t.tabType === "object" && t.table === "add",
      ),
    ).toBe(true);
  });

  it("sidebarMode: does not render the inline detail pane", async () => {
    vi.spyOn(commands, "getEnums").mockResolvedValue([
      { name: "role", schema: "public", labels: ["admin"] },
    ]);
    render(<ObjectExplorerPage connectionId="c1" sidebarMode />);
    fireEvent.click(screen.getByLabelText("Object type"));
    fireEvent.click(screen.getByText("Enums"));
    await waitFor(() =>
      expect(screen.getByText("role")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("role"));
    // clicking opened an object tab (no inline detail selected)
    expect(
      useDbViewerStore
        .getState()
        .tabs.some((t) => t.tabType === "object"),
    ).toBe(true);
    // detail pane is gone; only the list remains
    expect(
      screen.queryByText("Select an enum to view details"),
    ).not.toBeInTheDocument();
  });

  it("roles fetch ignores the schema filter", async () => {
    const user = userEvent.setup();
    const getRoles = vi.spyOn(commands, "getRoles").mockResolvedValue([
      {
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
      },
    ]);
    render(<ObjectExplorerPage connectionId="c1" />);
    await user.click(screen.getByLabelText("Object type"));
    await user.click(screen.getByText("Roles"));
    await waitFor(() =>
      expect(screen.getByText("app")).toBeInTheDocument(),
    );
    // Roles are cluster-scoped: no schema argument is ever passed, even when
    // the schema changes (no schema-change refetch for roles).
    expect(getRoles).toHaveBeenCalledTimes(1);
    expect(getRoles).toHaveBeenCalledWith("c1");
    expect(getRoles).not.toHaveBeenCalledWith("c1", "public");
    useDbViewerStore.setState({ currentSchema: "analytics" });
    await waitFor(() => expect(getRoles).toHaveBeenCalledTimes(1));
    expect(getRoles).toHaveBeenCalledWith("c1");
  });

  it("preselects type from store on mount", () => {
    useDbViewerStore.setState({ selectedObjectType: "sequences" });
    render(<ObjectExplorerPage connectionId="c1" />);
    expect(screen.getByText("Sequences")).toBeTruthy();
  });
});