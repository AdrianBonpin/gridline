import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryEditor } from "./QueryEditor";
import { editor as monacoEditor } from "monaco-editor";
import { useSettingsStore } from "../../stores/settingsStore";

// Monaco editor loads from CDN — mock it for tests to avoid network dependency
const { registeredActions, updateOptions } = vi.hoisted(() => ({
  registeredActions: [] as Array<{ id: string; keybindings: number[]; run: () => void }>,
  updateOptions: vi.fn(),
}));
const { editorOptions } = vi.hoisted(() => ({ editorOptions: [] as Array<Record<string, unknown>> }));

// monaco-editor's global re-measure (font metrics) — stub so tests stay light
vi.mock("monaco-editor", () => ({
  editor: { remeasureFonts: vi.fn() },
}));

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange, onMount, options }: any) => {
    editorOptions.push(options);
    if (onMount) {
      onMount({
        addAction: (action: any) => registeredActions.push(action),
        getValue: () => value,
        setValue: (v: string) => onChange?.(v),
        focus: vi.fn(),
        updateOptions,
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
    editorOptions.length = 0;
    updateOptions.mockClear();
    vi.mocked(monacoEditor.remeasureFonts).mockClear();
    useSettingsStore.setState({ settings: null });
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

  it("passes a placeholder option to the editor", () => {
    editorOptions.length = 0;
    render(<QueryEditor value="" onChange={() => {}} onRun={() => {}} />);
    expect(editorOptions[0]?.placeholder).toMatch(/Enter your SQL query/i);
  });

  it("re-measures fonts after mount so the cursor stays aligned", () => {
    render(<QueryEditor value="" onChange={() => {}} onRun={() => {}} />);
    expect(monacoEditor.remeasureFonts).toHaveBeenCalled();
  });

  it("calls updateOptions with editor settings when settings change", () => {
    const settings = {
      confirm_before_delete: true,
      default_folder_id: null,
      theme: "dark" as const,
      font_size: "medium" as const,
      default_ports: {},
      tag_order: null,
      table_refresh_rate: 5,
      table_page_size: 50,
      shortcuts: {},
      accent_color: "blue",
      editor_font_size: 13,
      editor_font_family: "Space Mono",
      editor_word_wrap: "off" as const,
      editor_minimap: false,
      editor_tab_size: 4,
    };
    useSettingsStore.setState({ settings });
    render(<QueryEditor value="" onChange={() => {}} onRun={() => {}} />);
    updateOptions.mockClear();
    act(() => {
      useSettingsStore.setState({
        settings: { ...settings, editor_font_size: 16, editor_word_wrap: "on" as const },
      });
    });
    expect(updateOptions).toHaveBeenCalledWith(
      expect.objectContaining({ fontSize: 16, wordWrap: "on" }),
    );
  });

  it("wraps the editor without padding, border, or rounding", () => {
    render(<QueryEditor value="" onChange={() => {}} onRun={() => {}} />);
    const wrapper = screen.getByTestId("query-editor");
    expect(wrapper.className).not.toMatch(/rounded|border|p-\d/);
  });
});