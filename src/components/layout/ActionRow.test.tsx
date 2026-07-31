import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionRow } from "./ActionRow";
import { useUiStore } from "../../stores/uiStore";

beforeEach(() => useUiStore.setState({ activeView: "home" }));

describe("ActionRow", () => {
  it("renders Saved Connections title", () => {
    render(<ActionRow />);
    expect(screen.getByText("Saved Connections")).toBeInTheDocument();
  });
  it("New Connection button switches view", async () => {
    render(<ActionRow />);
    await userEvent.click(screen.getByText(/new connection/i));
    expect(useUiStore.getState().activeView).toBe("new-connection");
  });
  it("Settings button switches view", async () => {
    render(<ActionRow />);
    await userEvent.click(screen.getByText(/settings/i));
    expect(useUiStore.getState().activeView).toBe("settings");
  });
});