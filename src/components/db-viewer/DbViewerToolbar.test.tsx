import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DbViewerToolbar } from "./DbViewerToolbar";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { TooltipProvider } from "../ui/Tooltip";

describe("DbViewerToolbar", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
  });

  it("renders Tables label", () => {
    render(
      <TooltipProvider>
        <DbViewerToolbar />
      </TooltipProvider>,
    );
    expect(screen.getByText("Tables")).toBeInTheDocument();
  });

  it("renders database dropdown when multiple databases", () => {
    useDbViewerStore.setState({
      databases: ["mydb", "otherdb"],
      schemas: ["public"],
      currentDatabase: "mydb",
      currentSchema: "public",
    });
    render(
      <TooltipProvider>
        <DbViewerToolbar />
      </TooltipProvider>,
    );
    expect(screen.getByText("mydb")).toBeInTheDocument();
  });

  it("renders refresh and create table buttons", () => {
    render(
      <TooltipProvider>
        <DbViewerToolbar />
      </TooltipProvider>,
    );
    expect(screen.getByLabelText(/refresh/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/create table/i)).toBeInTheDocument();
  });
});