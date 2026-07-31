import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryEditor } from "./QueryEditor";

// Monaco editor loads from CDN — mock it for tests to avoid network dependency
const { registeredActions } = vi.hoisted(() => ({
  registeredActions: [] as Array<{ id: string; keybindings: number[]; run: () => void }>,
}));

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange, onMount }: any) => {
    if (onMount) {
      onMount({
        addAction: (action: any) => registeredActions.push(action),
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
  beforeEach(() => {
    registeredActions.length = 0;
  });

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

  it("registers a Cmd+Enter action that runs the query", () => {
    const onRun = vi.fn();
    render(<QueryEditor value="SELECT 1" onChange={() => {}} onRun={onRun} />);
    expect(registeredActions).toHaveLength(1);
    expect(registeredActions[0].keybindings).toEqual([2048 | 3]);
    registeredActions[0].run();
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("wraps the editor without padding, border, or rounding", () => {
    render(<QueryEditor value="" onChange={() => {}} onRun={() => {}} />);
    const wrapper = screen.getByTestId("query-editor");
    expect(wrapper.className).not.toMatch(/rounded|border|p-\d/);
  });
});