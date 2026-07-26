import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewConnectionScreen } from "./NewConnectionScreen";

vi.mock("../../stores/connectionStore", () => ({
  useConnectionStore: () => ({
    createConnection: vi.fn().mockResolvedValue({}),
  }),
}));

vi.mock("../../stores/notificationStore", () => ({
  useNotificationStore: () => ({
    notify: vi.fn(),
  }),
}));

describe("NewConnectionScreen", () => {
  it("switches to detailed mode and back", async () => {
    const user = userEvent.setup();
    render(<NewConnectionScreen folders={[]} tags={[]} />);
    await user.click(screen.getByText(/configure manually instead/i));
    expect(screen.getByText(/general/i)).toBeInTheDocument();
    await user.click(screen.getByText(/back to connection string/i));
    expect(screen.getByLabelText(/connection string/i)).toBeInTheDocument();
  });
});