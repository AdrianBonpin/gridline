import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TableOverflowMenu } from "./TableOverflowMenu";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useUiStore } from "../../stores/uiStore";
import * as commands from "../../lib/commands";
import * as exportData from "../../lib/exportData";

describe("TableOverflowMenu", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn() },
      configurable: true,
      writable: true,
    });
    useDbViewerStore.getState().reset();
    useUiStore.setState({ activeConnectionId: "c1" });
    vi.resetAllMocks();
  });

  it("renders menu trigger button", () => {
    render(<TableOverflowMenu schema="public" table="users" onOpenTab={() => "tab-1"} />);
    expect(screen.getByLabelText(/table options/i)).toBeInTheDocument();
  });

  it("shows menu options on click", async () => {
    const user = userEvent.setup();
    render(<TableOverflowMenu schema="public" table="users" onOpenTab={() => "tab-1"} />);
    await user.click(screen.getByLabelText(/table options/i));
    expect(screen.getByText("Open in new tab")).toBeInTheDocument();
    expect(screen.getByText("Copy table schema")).toBeInTheDocument();
    expect(screen.getByText("Export data (CSV)")).toBeInTheDocument();
  });

  it("fires onOpenTab when menu item clicked", async () => {
    const user = userEvent.setup();
    const onOpenTab = vi.fn().mockReturnValue("tab-1");
    render(<TableOverflowMenu schema="public" table="users" onOpenTab={onOpenTab} />);
    await user.click(screen.getByLabelText(/table options/i));
    await user.click(screen.getByText("Open in new tab"));
    expect(onOpenTab).toHaveBeenCalledWith("public", "users", true);
  });

  it("Copy table schema calls getTableDdl and writes clipboard", async () => {
    vi.spyOn(commands, "getTableDdl").mockResolvedValue("CREATE TABLE t (id int)");
    const writeText = (navigator.clipboard as any).writeText as ReturnType<typeof vi.fn>;
    render(<TableOverflowMenu schema="public" table="t" onOpenTab={() => "tab-1"} />);
    fireEvent.click(screen.getByLabelText(/table options/i));
    fireEvent.click(screen.getByText(/copy table schema/i));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("CREATE TABLE t (id int)"));
  });

  it("Empty Table opens confirm then stages an empty_table change", async () => {
    render(<TableOverflowMenu schema="public" table="t" onOpenTab={() => "tab-1"} />);
    fireEvent.click(screen.getByLabelText(/table options/i));
    fireEvent.click(screen.getByText(/empty table/i));
    fireEvent.click(screen.getByRole("button", { name: /empty table/i }));
    await waitFor(() => {
      const q = useDbViewerStore.getState().changesQueue;
      expect(q[q.length - 1]).toEqual(expect.objectContaining({ type: "empty_table", schema: "public", table: "t" }));
    });
  });

  it("Delete Table opens confirm then stages a drop_table change", async () => {
    vi.spyOn(commands, "getObjectDependencies").mockResolvedValue([]);
    render(<TableOverflowMenu schema="public" table="t" onOpenTab={() => "tab-1"} />);
    fireEvent.click(screen.getByLabelText(/table options/i));
    fireEvent.click(screen.getByText(/delete table/i));
    await waitFor(() => expect(screen.queryByText(/open in new tab/i)).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete table/i }));
    await waitFor(() => {
      const q = useDbViewerStore.getState().changesQueue;
      expect(q[q.length - 1]).toEqual(expect.objectContaining({ type: "drop_table", schema: "public", table: "t" }));
    });
  });

  it("Delete Table fetches dependencies and shows DependencyDialog before confirming", async () => {
    vi.spyOn(commands, "getObjectDependencies").mockResolvedValue([{ deptype: "n", class: "pg_class", name: "v_orders" }]);
    render(<TableOverflowMenu schema="public" table="orders" connectionId="c1" onOpenTab={() => "tab-1"} />);
    fireEvent.click(screen.getByLabelText(/table options/i));
    fireEvent.click(screen.getByText(/delete table/i));
    await waitFor(() => expect(commands.getObjectDependencies).toHaveBeenCalledWith("c1", "public", "table", "orders"));
    await waitFor(() => expect(screen.getByText("v_orders")).toBeInTheDocument());
  });

  it("Export data calls exportData when rows and columns are provided", async () => {
    const spy = vi.spyOn(exportData, "exportData");
    const columns = [{ name: "id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false }];
    render(<TableOverflowMenu schema="public" table="t" onOpenTab={() => "tab-1"} columns={columns} rows={[[1]]} />);
    fireEvent.click(screen.getByLabelText(/table options/i));
    fireEvent.click(screen.getByText(/export data \(csv\)/i));
    await waitFor(() => expect(spy).toHaveBeenCalledWith([[1]], columns, "csv", "public.t"));
  });
});