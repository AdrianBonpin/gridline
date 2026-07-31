import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryToolbar } from "./QueryToolbar";
import { TooltipProvider } from "../ui/Tooltip";

function renderToolbar(props: {
  onRun?: () => void;
  onFormat?: () => void;
  dbType?: "postgresql" | "mysql" | "sqlite" | "redis";
}) {
  return render(
    <TooltipProvider>
      <QueryToolbar
        onRun={props.onRun ?? (() => {})}
        onFormat={props.onFormat ?? (() => {})}
        dbType={props.dbType}
      />
    </TooltipProvider>,
  );
}

describe("QueryToolbar", () => {
  it("renders Run Query and the format icon button", () => {
    renderToolbar({});
    expect(
      screen.getByRole("button", { name: /run query/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /auto format/i }),
    ).toBeInTheDocument();
  });

  it("shows the SQL dialect on the right", () => {
    renderToolbar({ dbType: "postgresql" });
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    renderToolbar({ dbType: "mysql" });
    expect(screen.getByText("MySQL")).toBeInTheDocument();
  });

  it("hides the dialect badge when no db type is known", () => {
    renderToolbar({});
    expect(screen.queryByText(/postgresql|mysql|sqlite|redis/i)).toBeNull();
  });

  it("runs the query when Run Query is clicked", () => {
    const onRun = vi.fn();
    renderToolbar({ onRun });
    fireEvent.click(screen.getByRole("button", { name: /run query/i }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("calls onFormat when the format icon is clicked", () => {
    const onFormat = vi.fn();
    renderToolbar({ onFormat });
    fireEvent.click(screen.getByRole("button", { name: /auto format/i }));
    expect(onFormat).toHaveBeenCalledTimes(1);
  });

  it("starts with an unfilled play icon", () => {
    renderToolbar({});
    const playSvg = screen
      .getByRole("button", { name: /run query/i })
      .querySelector("svg");
    expect(playSvg).toHaveAttribute("fill", "none");
  });

  it("renders the format action as an icon only (no text label)", () => {
    renderToolbar({});
    const button = screen.getByRole("button", { name: /auto format/i });
    expect(button.textContent?.trim()).toBe("");
  });
});