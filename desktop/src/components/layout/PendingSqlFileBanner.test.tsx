import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PendingSqlFileBanner } from "./PendingSqlFileBanner";
import { useUiStore } from "../../stores/uiStore";

beforeEach(() => {
  useUiStore.setState({ pendingSqlFile: null });
});

describe("PendingSqlFileBanner", () => {
  it("renders nothing when there is no pending file", () => {
    const { container } = render(<PendingSqlFileBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the file and tells the user to open a connection", () => {
    useUiStore.setState({
      pendingSqlFile: { path: "/tmp/a.sql", name: "student_db.sql", content: "SELECT 1;" },
    });
    render(<PendingSqlFileBanner />);
    expect(screen.getByText(/student_db\.sql/)).toBeInTheDocument();
    expect(screen.getByText(/open a connection/i)).toBeInTheDocument();
  });
});
