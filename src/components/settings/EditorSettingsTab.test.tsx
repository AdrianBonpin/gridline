import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditorSettingsTab } from "./EditorSettingsTab";
import { useSettingsStore } from "../../stores/settingsStore";

beforeEach(() => {
  useSettingsStore.setState({
    settings: {
      confirm_before_delete: true, default_folder_id: null, theme: "dark", font_size: "medium",
      default_ports: {}, tag_order: null, table_refresh_rate: 0, table_page_size: 50,
      shortcuts: {}, accent_color: "#2563EB",
      editor_font_size: 13, editor_font_family: "Space Mono", editor_word_wrap: "off",
      editor_minimap: false, editor_tab_size: 4,
    } as any, loading: false, error: null,
  });
  vi.restoreAllMocks();
});

describe("EditorSettingsTab", () => {
  it("renders the five editor option controls", () => {
    render(<EditorSettingsTab />);
    expect(screen.getByLabelText(/font size/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/font family/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/word wrap/i)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /minimap/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/tab size/i)).toBeInTheDocument();
  });

  it("calls updateSetting when word wrap changes", () => {
    const update = vi.fn();
    useSettingsStore.setState({ updateSetting: update } as any);
    render(<EditorSettingsTab />);
    fireEvent.change(screen.getByLabelText(/word wrap/i), { target: { value: "on" } });
    expect(update).toHaveBeenCalledWith("editor_word_wrap", "on");
  });

  it("calls updateSetting when minimap toggled", () => {
    const update = vi.fn();
    useSettingsStore.setState({ updateSetting: update } as any);
    render(<EditorSettingsTab />);
    fireEvent.click(screen.getByRole("switch", { name: /minimap/i }));
    expect(update).toHaveBeenCalledWith("editor_minimap", "true");
  });
});