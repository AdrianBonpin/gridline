import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewConnectionScreen } from "./NewConnectionScreen";
import { useSettingsStore } from "../../stores/settingsStore";

const { createConnection, notify, testConnection } = vi.hoisted(() =>
  ({
    createConnection: vi.fn().mockResolvedValue({}),
    notify: vi.fn(),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
  }));

vi.mock("../../stores/connectionStore", () => ({
  createConnection,
  useConnectionStore: (selector: (s: { createConnection: typeof createConnection }) => unknown) =>
    selector({ createConnection }),
}));

vi.mock("../../stores/notificationStore", () => ({
  notify,
  useNotificationStore: (selector: (s: { notify: typeof notify }) => unknown) =>
    selector({ notify }),
}));

vi.mock("../../lib/commands", () => ({
  testConnection,
}));

describe("NewConnectionScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ settings: null, loading: false, error: null });
  });

  it("entry stage: renders Connection URI input and provider grid, not the full form", () => {
    render(<NewConnectionScreen />);
    expect(screen.getByLabelText(/connection uri/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /PostgreSQL/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /MySQL/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Supabase/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/connection label/i)).not.toBeInTheDocument();
  });

  it("paste a recognized URL reveals the form and fills fields", async () => {
    const user = userEvent.setup();
    render(<NewConnectionScreen />);
    await user.type(screen.getByLabelText(/connection uri/i), "postgresql://u:p@localhost:5432/db");
    expect(screen.getByLabelText(/connection label/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Host")).toHaveValue("localhost");
    expect(screen.getByLabelText("Port")).toHaveValue(5432);
    expect(screen.getByLabelText("User")).toHaveValue("u");
  });

  it("clicking a provider tab reveals the form with that db_type", async () => {
    const user = userEvent.setup();
    render(<NewConnectionScreen />);
    await user.click(screen.getByRole("button", { name: /MySQL/i }));
    expect(screen.getByLabelText(/connection label/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Port")).toHaveValue(3306);
  });

  it("SQLite tab swaps the URI input for a File Path input", async () => {
    const user = userEvent.setup();
    render(<NewConnectionScreen />);
    await user.click(screen.getByRole("button", { name: /SQLite/i }));
    expect(screen.getByLabelText(/file path/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/connection uri/i)).not.toBeInTheDocument();
  });

  it("shows validation error when saving an empty configured form", async () => {
    const user = userEvent.setup();
    render(<NewConnectionScreen />);
    await user.click(screen.getByRole("button", { name: /PostgreSQL/i }));
    await user.click(screen.getByText("Save Connection"));
    expect(notify).toHaveBeenCalledWith("name is required", "error");
    expect(createConnection).not.toHaveBeenCalled();
  });

  it("saves a connection with label + parsed URL", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<NewConnectionScreen onSaved={onSaved} />);
    await user.type(screen.getByLabelText(/connection uri/i), "postgresql://u:p@localhost:5432/db");
    await user.type(screen.getByLabelText(/connection label/i), "Local DB");
    await user.click(screen.getByText("Save Connection"));
    await waitFor(() => expect(createConnection).toHaveBeenCalledTimes(1));
    expect(createConnection).toHaveBeenCalledWith(expect.objectContaining({
      name: "Local DB", db_type: "postgresql", host: "localhost", port: 5432,
      username: "u", password: "p", database: "db",
    }));
    expect(notify).toHaveBeenCalledWith("Connection saved", "success");
    expect(onSaved).toHaveBeenCalled();
  });

  it("calls testConnection when Test Connection is clicked", async () => {
    const user = userEvent.setup();
    render(<NewConnectionScreen />);
    await user.type(screen.getByLabelText(/connection uri/i), "postgresql://u:p@localhost:5432/db");
    await user.type(screen.getByLabelText(/connection label/i), "Local DB");
    await user.click(screen.getByText("Test Connection"));
    await waitFor(() => expect(testConnection).toHaveBeenCalledTimes(1));
    expect(notify).toHaveBeenCalledWith("Connection successful", "success");
  });

  it("invokes onCancel when Back is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<NewConnectionScreen onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("prefills from prefilledConnectionString and reveals the form", async () => {
    render(<NewConnectionScreen prefilledConnectionString="postgresql://u:p@localhost:5432/db" />);
    expect(screen.getByLabelText(/connection uri/i)).toHaveValue("postgresql://u:p@localhost:5432/db");
    expect(screen.getByLabelText(/connection label/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Host")).toHaveValue("localhost");
  });
});