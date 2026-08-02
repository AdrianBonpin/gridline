import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecentConnectionsStrip } from "./RecentConnectionsStrip";
import type { Connection } from "../../lib/types";

const makeConn = (id: string): Connection => ({
  id,
  name: id.toUpperCase(),
  db_type: "postgresql",
  host: "h",
  port: 5432,
  username: null,
  folder_id: null,
  keychain_ref: null,
  tag_ids: [],
  created_at: "",
  updated_at: "",
  favorite: false,
});

describe("RecentConnectionsStrip", () => {
  it("renders up to 8 recent connections and calls onOpen on click", () => {
    const onOpen = vi.fn();
    const recents = Array.from({ length: 10 }, (_, i) => makeConn(`c${i}`));
    render(<RecentConnectionsStrip recents={recents} onOpen={onOpen} />);
    expect(screen.getAllByRole("button")).toHaveLength(8);
    fireEvent.click(screen.getByText("C0"));
    expect(onOpen).toHaveBeenCalledWith("c0");
  });

  it("renders nothing when the list is empty", () => {
    const { container } = render(
      <RecentConnectionsStrip recents={[]} onOpen={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});