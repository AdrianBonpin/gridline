import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ObjectSearchPalette } from "./ObjectSearchPalette";
import * as cmd from "../../lib/commands";
import type { ObjectSearchHit } from "../../lib/types";

vi.mock("../../lib/commands");

const mockSetObjectSearchOpen = vi.fn();
const mockSetCurrentSchema = vi.fn();
const mockSetSelectedObjectType = vi.fn();
const mockOpenTab = vi.fn();

const baseMockState = {
  objectSearchOpen: true,
  setObjectSearchOpen: mockSetObjectSearchOpen,
  currentSchema: "public" as string | null,
  setCurrentSchema: mockSetCurrentSchema,
  setSelectedObjectType: mockSetSelectedObjectType,
  openTab: mockOpenTab,
};

let mockState: typeof baseMockState = { ...baseMockState };

vi.mock("../../stores/dbViewerStore", () => ({
  useDbViewerStore: (selector: unknown) => {
    return typeof selector === "function"
      ? (selector as (s: typeof mockState) => unknown)(mockState)
      : mockState[selector as keyof typeof mockState];
  },
}));

describe("ObjectSearchPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState = { ...baseMockState };
  });

  it("renders nothing when closed", () => {
    mockState = { ...baseMockState, objectSearchOpen: false };
    const { container } = render(<ObjectSearchPalette connectionId="c1" />);
    expect(container.firstChild).toBeNull();
  });

  it("debounces and groups results by type", async () => {
    const hits: ObjectSearchHit[] = [
      { name: "users", schema: "public", object_type: "TABLE" },
      { name: "get_user", schema: "public", object_type: "FUNCTION" },
    ];
    vi.mocked(cmd.searchObjects).mockResolvedValue(hits);

    render(<ObjectSearchPalette connectionId="c1" />);
    fireEvent.change(screen.getByPlaceholderText(/search objects/i), {
      target: { value: "user" },
    });

    await waitFor(() =>
      expect(cmd.searchObjects).toHaveBeenCalledWith("c1", "public", "user"),
    );
    await waitFor(() => {
      expect(screen.getByText("TABLE")).toBeInTheDocument();
      expect(screen.getByText("FUNCTION")).toBeInTheDocument();
    });
  });

  it("uses currentSchema fallback when store value is null", async () => {
    vi.mocked(cmd.searchObjects).mockResolvedValue([]);
    mockState = { ...baseMockState, currentSchema: null };

    render(<ObjectSearchPalette connectionId="c1" />);
    fireEvent.change(screen.getByPlaceholderText(/search objects/i), {
      target: { value: "x" },
    });

    await waitFor(() =>
      expect(cmd.searchObjects).toHaveBeenCalledWith("c1", "public", "x"),
    );
  });

  it("Esc closes the palette", () => {
    render(<ObjectSearchPalette connectionId="c1" />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockSetObjectSearchOpen).toHaveBeenCalledWith(false);
  });

  it("backdrop click closes the palette", () => {
    render(<ObjectSearchPalette connectionId="c1" />);
    const backdrop = screen.getByLabelText(/search objects/i).closest(
      "div[class*='fixed inset-0']",
    ) as HTMLElement;
    fireEvent.click(backdrop);
    expect(mockSetObjectSearchOpen).toHaveBeenCalledWith(false);
  });

  it("selecting a table opens a tab and closes", async () => {
    vi.mocked(cmd.searchObjects).mockResolvedValue([
      { name: "users", schema: "public", object_type: "TABLE" },
    ]);

    render(<ObjectSearchPalette connectionId="c1" />);
    fireEvent.change(screen.getByPlaceholderText(/search objects/i), {
      target: { value: "users" },
    });
    await waitFor(() => screen.getByText("users"));
    fireEvent.click(screen.getByText("users"));

    expect(mockOpenTab).toHaveBeenCalledWith("public", "users");
    expect(mockSetObjectSearchOpen).toHaveBeenCalledWith(false);
    expect(mockSetCurrentSchema).not.toHaveBeenCalled();
    expect(mockSetSelectedObjectType).not.toHaveBeenCalled();
  });

  it("selecting a view opens a tab and closes", async () => {
    vi.mocked(cmd.searchObjects).mockResolvedValue([
      { name: "active_users", schema: "public", object_type: "VIEW" },
    ]);

    render(<ObjectSearchPalette connectionId="c1" />);
    fireEvent.change(screen.getByPlaceholderText(/search objects/i), {
      target: { value: "active" },
    });
    await waitFor(() => screen.getByText("active_users"));
    fireEvent.click(screen.getByText("active_users"));

    expect(mockOpenTab).toHaveBeenCalledWith("public", "active_users");
    expect(mockSetObjectSearchOpen).toHaveBeenCalledWith(false);
  });

  it("selecting a matview opens a tab and closes", async () => {
    vi.mocked(cmd.searchObjects).mockResolvedValue([
      { name: "mv_users", schema: "public", object_type: "MATERIALIZED VIEW" },
    ]);

    render(<ObjectSearchPalette connectionId="c1" />);
    fireEvent.change(screen.getByPlaceholderText(/search objects/i), {
      target: { value: "mv" },
    });
    await waitFor(() => screen.getByText("mv_users"));
    fireEvent.click(screen.getByText("mv_users"));

    expect(mockOpenTab).toHaveBeenCalledWith("public", "mv_users");
    expect(mockSetObjectSearchOpen).toHaveBeenCalledWith(false);
  });

  it.each([
    ["FUNCTION", "functions"],
    ["PROCEDURE", "procedures"],
    ["TRIGGER", "triggers"],
    ["SEQUENCE", "sequences"],
    ["ENUM", "enums"],
    ["EXTENSION", "extensions"],
    ["INDEX", "indexes"],
    ["CONSTRAINT", "constraints"],
  ] as const)(
    "selecting a %s switches the objects view and closes",
    async (objectType, mappedType) => {
      vi.mocked(cmd.searchObjects).mockResolvedValue([
        { name: "item", schema: "app", object_type: objectType },
      ]);

      render(<ObjectSearchPalette connectionId="c1" />);
      fireEvent.change(screen.getByPlaceholderText(/search objects/i), {
        target: { value: "item" },
      });
      await waitFor(() => screen.getByText("item"));
      fireEvent.click(screen.getByText("item"));

      expect(mockSetCurrentSchema).toHaveBeenCalledWith("app");
      expect(mockSetSelectedObjectType).toHaveBeenCalledWith(mappedType);
      expect(mockSetObjectSearchOpen).toHaveBeenCalledWith(false);
      expect(mockOpenTab).not.toHaveBeenCalled();
    },
  );

  it("shows an empty state when no results match", async () => {
    vi.mocked(cmd.searchObjects).mockResolvedValue([]);
    render(<ObjectSearchPalette connectionId="c1" />);
    fireEvent.change(screen.getByPlaceholderText(/search objects/i), {
      target: { value: "nomatch" },
    });
    await waitFor(() => expect(cmd.searchObjects).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/no matches/i)).toBeInTheDocument(),
    );
  });

  it("clears query and results when reopened", async () => {
    vi.mocked(cmd.searchObjects).mockResolvedValue([
      { name: "users", schema: "public", object_type: "TABLE" },
    ]);
    const { rerender } = render(<ObjectSearchPalette connectionId="c1" />);
    fireEvent.change(screen.getByPlaceholderText(/search objects/i), {
      target: { value: "users" },
    });
    await waitFor(() => screen.getByText("users"));

    mockState = { ...baseMockState, objectSearchOpen: false };
    rerender(<ObjectSearchPalette connectionId="c1" />);

    mockState = { ...baseMockState, objectSearchOpen: true };
    rerender(<ObjectSearchPalette connectionId="c1" />);

    expect(screen.queryByText("users")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search objects/i)).toHaveValue("");
  });
});