import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectionCardMenu } from "./ConnectionCardMenu";
import { useConnectionStore } from "../../stores/connectionStore";
import * as commands from "../../lib/commands";
import type { Connection } from "../../lib/types";

vi.mock("../../lib/commands", () => ({
  getConnectionPassword: vi.fn(),
  testConnection: vi.fn(),
}));

const conn: Connection = {
  id: "c1",
  name: "Prod DB",
  db_type: "postgresql",
  host: "prod.example.com",
  port: 5432,
  username: null,
  folder_id: null,
  keychain_ref: null,
  tag_ids: [],
  favorite: false,
  created_at: "",
  updated_at: "",
};

function renderMenu() {
  const onEdit = vi.fn();
  const onDuplicate = vi.fn();
  const onDelete = vi.fn();
  const utils = render(
    <ConnectionCardMenu
      connection={conn}
      onEdit={onEdit}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
    />,
  );
  return { ...utils, onEdit, onDuplicate, onDelete };
}

async function openMenu() {
  await userEvent.click(screen.getByLabelText("Connection actions"));
}

describe("ConnectionCardMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a kebab trigger and opens the menu on click", async () => {
    renderMenu();
    expect(screen.getByLabelText("Connection actions")).toBeInTheDocument();
    expect(screen.queryByText("Manage")).not.toBeInTheDocument();

    await openMenu();
    expect(screen.getByText("Add to favorites")).toBeInTheDocument();
    expect(screen.getByText("Test connection")).toBeInTheDocument();
    expect(screen.getByText("Manage")).toBeInTheDocument();
  });

  it("favorite label reflects connection.favorite", async () => {
    const { unmount } = renderMenu();
    await openMenu();
    expect(screen.getByText("Add to favorites")).toBeInTheDocument();
    unmount();

    render(
      <ConnectionCardMenu
        connection={{ ...conn, favorite: true }}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    await openMenu();
    expect(screen.getByText("Remove from favorites")).toBeInTheDocument();
  });

  it("clicking favorite calls toggleFavorite and closes the menu", async () => {
    const spy = vi
      .spyOn(useConnectionStore.getState(), "toggleFavorite")
      .mockResolvedValue(undefined);
    renderMenu();
    await openMenu();
    await userEvent.click(screen.getByText("Add to favorites"));
    expect(spy).toHaveBeenCalledWith("c1");
    expect(screen.queryByText("Manage")).not.toBeInTheDocument();
  });

  it("test connection keeps the menu open and shows online status", async () => {
    vi.mocked(commands.getConnectionPassword).mockResolvedValue("pw");
    vi.mocked(commands.testConnection).mockResolvedValue({
      ok: true,
      server_version: "15.2",
      latency_ms: 12,
    } as any);
    renderMenu();
    await openMenu();

    await userEvent.click(screen.getByText("Test connection"));

    // Menu stays open while the check runs
    expect(screen.getByText("Manage")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/online/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/15\.2/)).toBeInTheDocument();
    expect(screen.getByText(/12ms/)).toBeInTheDocument();
  });

  it("test connection shows the offline error text", async () => {
    vi.mocked(commands.getConnectionPassword).mockResolvedValue("pw");
    vi.mocked(commands.testConnection).mockResolvedValue({
      ok: false,
      error: "connection refused",
    } as any);
    renderMenu();
    await openMenu();

    await userEvent.click(screen.getByText("Test connection"));

    await waitFor(() =>
      expect(screen.getByText(/connection refused/i)).toBeInTheDocument(),
    );
  });

  it("Manage expands to reveal Edit/Duplicate/Delete and Edit calls onEdit + closes", async () => {
    const { onEdit } = renderMenu();
    await openMenu();
    await userEvent.click(screen.getByText("Manage"));

    expect(screen.getByText("Edit…")).toBeInTheDocument();
    expect(screen.getByText("Duplicate")).toBeInTheDocument();
    expect(screen.getByText("Delete…")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Edit…"));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Edit…")).not.toBeInTheDocument();
  });

  it("Duplicate calls onDuplicate + closes the menu", async () => {
    const { onDuplicate } = renderMenu();
    await openMenu();
    await userEvent.click(screen.getByText("Manage"));
    await userEvent.click(screen.getByText("Duplicate"));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Manage")).not.toBeInTheDocument();
  });

  it("Delete is rendered in red, calls onDelete + closes the menu", async () => {
    const { onDelete } = renderMenu();
    await openMenu();
    await userEvent.click(screen.getByText("Manage"));

    const deleteItem = screen.getByText("Delete…");
    expect(deleteItem.className).toContain("text-red");

    await userEvent.click(deleteItem);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Manage")).not.toBeInTheDocument();
  });

  it("closes on outside mousedown", async () => {
    renderMenu();
    await openMenu();
    expect(screen.getByText("Manage")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Manage")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    renderMenu();
    await openMenu();
    expect(screen.getByText("Manage")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText("Manage")).not.toBeInTheDocument();
  });
});