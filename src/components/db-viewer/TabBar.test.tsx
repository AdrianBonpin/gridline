import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabBar } from "./TabBar";
import { useDbViewerStore } from "../../stores/dbViewerStore";

const user = userEvent.setup();

describe("TabBar", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
  });

  it("renders nothing when no tabs are open", () => {
    const { container } = render(<TabBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders open tab names", () => {
    useDbViewerStore.getState().openTab("public", "users");
    useDbViewerStore.getState().openTab("public", "posts", true);

    render(<TabBar />);
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("posts")).toBeInTheDocument();
  });

  it("sets active tab when clicked", async () => {
    const store = useDbViewerStore.getState();
    store.openTab("public", "users");
    store.openTab("public", "posts", true);
    const firstTabId = useDbViewerStore.getState().tabs[0].id;

    render(<TabBar />);
    await user.click(screen.getByText("users"));
    expect(useDbViewerStore.getState().activeTabId).toBe(firstTabId);
  });

  it("closes tab when close button clicked", async () => {
    useDbViewerStore.getState().openTab("public", "users");
    useDbViewerStore.getState().openTab("public", "posts", true);
    const firstTabId = useDbViewerStore.getState().tabs[0].id;

    render(<TabBar />);
    const closeButton = screen.getByRole("button", {
      name: /close users/i,
    });
    await user.click(closeButton);

    expect(useDbViewerStore.getState().tabs).toHaveLength(1);
    expect(
      useDbViewerStore.getState().tabs.find((t) => t.id === firstTabId),
    ).toBeUndefined();
  });
});