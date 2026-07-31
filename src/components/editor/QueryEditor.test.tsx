import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryEditor } from "./QueryEditor";

// Monaco editor loads from CDN — mock it for tests to avoid network dependency
vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange, onMount }: any) => {
    if (onMount) {
      onMount({
        addAction: vi.fn(),
        getValue: () => value,
        setValue: (v: string) => onChange?.(v),
        focus: vi.fn(),
      });
    }
    return (
      <div data-testid="monaco-editor">
        <textarea
          data-testid="monaco-textarea"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
        />
      </div>
    );
  },
}));

describe("QueryEditor", () => {
  it("renders a textarea editor", () => {
    render(<QueryEditor value="SELECT 1" onChange={() => {}} onRun={() => {}} />);
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
  });

  it("displays the provided value", () => {
    render(<QueryEditor value="SELECT * FROM users" onChange={() => {}} onRun={() => {}} />);
    const textarea = screen.getByTestId("monaco-textarea");
    expect(textarea).toHaveValue("SELECT * FROM users");
  });

  it("calls onChange when text changes", () => {
    const onChange = vi.fn();
    render(<QueryEditor value="" onChange={onChange} onRun={() => {}} />);
    fireEvent.change(screen.getByTestId("monaco-textarea"), { target: { value: "SELECT 1" } });
    expect(onChange).toHaveBeenCalledWith("SELECT 1");
  });

  it("shows Run button", () => {
    render(<QueryEditor value="" onChange={() => {}} onRun={() => {}} />);
    expect(screen.getByText("Run")).toBeInTheDocument();
  });

  it("calls onRun when Run button is clicked", () => {
    const onRun = vi.fn();
    render(<QueryEditor value="SELECT 1" onChange={() => {}} onRun={onRun} />);
    fireEvent.click(screen.getByText("Run"));
    expect(onRun).toHaveBeenCalledTimes(1);
  });
});