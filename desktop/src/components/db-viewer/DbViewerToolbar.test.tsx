import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DbViewerToolbar } from "./DbViewerToolbar";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { TooltipProvider } from "../ui/Tooltip";

const defaultProps = {
  databases: [] as string[],
  currentDatabase: null as string | null,
  setCurrentDatabase: () => {},
  schemas: [] as string[],
  currentSchema: null as string | null,
  setCurrentSchema: () => {},
  searchQuery: "",
  onSearchChange: () => {},
};

describe("DbViewerToolbar", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
  });

  it("renders Tables label", () => {
    render(
      <TooltipProvider>
        <DbViewerToolbar {...defaultProps} />
      </TooltipProvider>,
    );
    expect(screen.getByText("Tables")).toBeInTheDocument();
  });

  it("renders database dropdown when multiple databases", () => {
    render(
      <TooltipProvider>
        <DbViewerToolbar
          {...defaultProps}
          databases={["mydb", "otherdb"]}
          currentDatabase="mydb"
        />
      </TooltipProvider>,
    );
    expect(screen.getByText("mydb")).toBeInTheDocument();
  });

  it("omits bottom padding when nothing is rendered below the title row", () => {
    const { container } = render(
      <TooltipProvider>
        <DbViewerToolbar {...defaultProps} />
      </TooltipProvider>,
    );
    expect(container.firstElementChild!.className).not.toContain("pb-3");
  });

  it("keeps bottom padding when selectors are rendered below", () => {
    const { container } = render(
      <TooltipProvider>
        <DbViewerToolbar
          {...defaultProps}
          databases={["mydb", "otherdb"]}
          currentDatabase="mydb"
        />
      </TooltipProvider>,
    );
    expect(container.firstElementChild!.className).toContain("pb-3");
  });

  it("keeps bottom padding while the search input is open", () => {
    const { container } = render(
      <TooltipProvider>
        <DbViewerToolbar {...defaultProps} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByLabelText(/search tables/i));
    expect(container.firstElementChild!.className).toContain("pb-3");
  });

  it("renders refresh and create table buttons", () => {
    render(
      <TooltipProvider>
        <DbViewerToolbar {...defaultProps} />
      </TooltipProvider>,
    );
    expect(screen.getByLabelText(/refresh/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/create table/i)).toBeInTheDocument();
  });

  it("opens a create table form tab when Create Table is clicked", () => {
    const openFormTab = vi.spyOn(useDbViewerStore.getState(), "openFormTab");
    render(
      <TooltipProvider>
        <DbViewerToolbar {...defaultProps} currentSchema="public" />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByLabelText(/create table/i));
    expect(openFormTab).toHaveBeenCalledWith(expect.objectContaining({ kind: "table", mode: "create" }));
  });

  it("shows a disabled schema loading indicator while schema tree is loading", () => {
    useDbViewerStore.setState({ schemaTreeLoading: true });
    render(
      <TooltipProvider>
        <DbViewerToolbar {...defaultProps} />
      </TooltipProvider>,
    );
    expect(screen.getByLabelText(/select schema/i)).toBeDisabled();
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it("renders schema options when not loading and multiple schemas exist", () => {
    useDbViewerStore.setState({ schemaTreeLoading: false });
    render(
      <TooltipProvider>
        <DbViewerToolbar
          {...defaultProps}
          schemas={["public", "app"]}
          currentSchema="public"
        />
      </TooltipProvider>,
    );
    expect(screen.getByText("public")).toBeInTheDocument();
  });
});