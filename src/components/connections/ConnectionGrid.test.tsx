import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectionGrid } from "./ConnectionGrid";
import type { Connection } from "../../lib/types";

const makeConn = (id: string): Connection => ({
  id, name: `Conn ${id}`, db_type: "postgresql", host: "h", port: 5432,
  username: null, folder_id: null, keychain_ref: null, tag_ids: [],
  created_at: "", updated_at: "",
});

describe("ConnectionGrid", () => {
  it("renders empty state when no connections", () => {
    render(<ConnectionGrid connections={[]} tags={[]} />);
    expect(screen.getByText(/no connections/i)).toBeInTheDocument();
  });
  it("renders cards for each connection", () => {
    const conns = [makeConn("1"), makeConn("2")];
    render(<ConnectionGrid connections={conns} tags={[]} />);
    expect(screen.getByText("Conn 1")).toBeInTheDocument();
    expect(screen.getByText("Conn 2")).toBeInTheDocument();
  });
  it("renders no-results state when filtered empty", () => {
    render(<ConnectionGrid connections={[]} tags={[]} hasSearch />);
    expect(screen.getByText(/no connections match/i)).toBeInTheDocument();
  });
});