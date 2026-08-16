import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SaveQueryDialog } from "./SaveQueryDialog";
import { useQueryStore } from "../../stores/queryStore";

vi.mock("../../stores/queryStore", () => ({
  useQueryStore: vi.fn(),
}));

const mockSaveCurrentQuery = vi.fn();

function setStoreMock() {
  (useQueryStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        saveCurrentQuery: mockSaveCurrentQuery,
      }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setStoreMock();
  mockSaveCurrentQuery.mockResolvedValue({ id: "q-new" });
});

describe("SaveQueryDialog", () => {
  it("renders nothing when closed", () => {
    render(
      <SaveQueryDialog
        open={false}
        onClose={() => {}}
        connectionId="c1"
        queryText="SELECT 1"
      />,
    );
    expect(screen.queryByText(/save query/i)).not.toBeInTheDocument();
  });

  it("shows form when open", () => {
    render(
      <SaveQueryDialog
        open={true}
        onClose={() => {}}
        connectionId="c1"
        queryText="SELECT 1"
      />,
    );
    expect(screen.getByText(/save query/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/query name/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/folder/i)).toBeInTheDocument();
  });

  it("blocks save when name is empty", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SaveQueryDialog open={true} onClose={onClose} connectionId="c1" queryText="SELECT 1" />,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText(/name is required/i)).toBeInTheDocument();
    });
    expect(mockSaveCurrentQuery).not.toHaveBeenCalled();
  });

  it("saves with name + folder and closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SaveQueryDialog open={true} onClose={onClose} connectionId="c1" queryText="SELECT 1" />,
    );
    await user.type(screen.getByPlaceholderText(/query name/i), "My Query");
    await user.type(screen.getByPlaceholderText(/folder/i), "reports");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockSaveCurrentQuery).toHaveBeenCalledWith({
        connectionId: "c1",
        name: "My Query",
        queryText: "SELECT 1",
        folder: "reports",
      });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on cancel", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SaveQueryDialog open={true} onClose={onClose} connectionId="c1" queryText="SELECT 1" />,
    );
    await user.click(screen.getByText(/cancel/i));
    expect(onClose).toHaveBeenCalled();
  });
});