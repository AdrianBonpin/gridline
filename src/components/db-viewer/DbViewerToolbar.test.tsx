import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("renders refresh and create table buttons", () => {
    render(
      <TooltipProvider>
        <DbViewerToolbar {...defaultProps} />
      </TooltipProvider>,
    );
    expect(screen.getByLabelText(/refresh/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/create table/i)).toBeInTheDocument();
  });
});