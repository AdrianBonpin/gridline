import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewConnectionScreen } from "./NewConnectionScreen";

const { createConnection, notify, testConnection } = vi.hoisted(() => ({
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
  });

  it("switches to detailed mode and back", async () => {
    const user = userEvent.setup();
    render(<NewConnectionScreen folders={[]} tags={[]} />);
    await user.click(screen.getByText(/configure manually instead/i));
    expect(screen.getByText(/general/i)).toBeInTheDocument();
    await user.click(screen.getByText(/back to connection string/i));
    expect(screen.getByLabelText(/connection string/i)).toBeInTheDocument();
  });

  it("parses prefilled connection string and populates fields", async () => {
    const user = userEvent.setup();
    render(
      <NewConnectionScreen
        prefilledConnectionString="postgresql://u:p@localhost:5432/db"
        folders={[]}
        tags={[]}
      />,
    );

    expect(screen.getByLabelText(/connection string/i)).toHaveValue(
      "postgresql://u:p@localhost:5432/db",
    );

    await user.click(screen.getByText(/configure manually instead/i));

    expect(screen.getByLabelText("Host")).toHaveValue("localhost");
    expect(screen.getByLabelText("Port")).toHaveValue(5432);
    expect(screen.getByLabelText("User")).toHaveValue("u");
    expect(screen.getByLabelText("Database")).toHaveValue("db");
  });

  it("shows validation error and does not call createConnection when saving empty form", async () => {
    const user = userEvent.setup();
    render(<NewConnectionScreen folders={[]} tags={[]} />);
    await user.click(screen.getByText("Save Connection"));

    expect(notify).toHaveBeenCalledWith("name is required", "error");
    expect(createConnection).not.toHaveBeenCalled();
  });

  it("saves a connection and invokes onSaved when required fields are filled", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<NewConnectionScreen folders={[]} tags={[]} onSaved={onSaved} />);

    await user.type(screen.getByLabelText("Connection Label"), "Local DB");
    await user.type(
      screen.getByLabelText("Connection String"),
      "postgresql://u:p@localhost:5432/db",
    );
    await user.click(screen.getByText("Save Connection"));

    await waitFor(() => expect(createConnection).toHaveBeenCalledTimes(1));
    expect(createConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Local DB",
        db_type: "postgresql",
        host: "localhost",
        port: 5432,
        username: "u",
        password: "p",
        database: "db",
        connection_string: "postgresql://u:p@localhost:5432/db",
        folder_id: null,
        tag_ids: [],
        environment: null,
        use_keychain: false,
      }),
    );
    expect(notify).toHaveBeenCalledWith("Connection saved", "success");
    expect(onSaved).toHaveBeenCalled();
  });

  it("calls testConnection when Test Connection is clicked", async () => {
    const user = userEvent.setup();
    render(<NewConnectionScreen folders={[]} tags={[]} />);

    await user.type(screen.getByLabelText("Connection Label"), "Local DB");
    await user.type(
      screen.getByLabelText("Connection String"),
      "postgresql://u:p@localhost:5432/db",
    );
    await user.click(screen.getByText("Test Connection"));

    await waitFor(() => expect(testConnection).toHaveBeenCalledTimes(1));
    expect(testConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Local DB",
        db_type: "postgresql",
        host: "localhost",
        port: 5432,
        username: "u",
        password: "p",
        database: "db",
      }),
    );
    expect(notify).toHaveBeenCalledWith("Connection successful", "success");
  });

  it("invokes onCancel when Back is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<NewConnectionScreen folders={[]} tags={[]} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onCancel).toHaveBeenCalled();
  });
});