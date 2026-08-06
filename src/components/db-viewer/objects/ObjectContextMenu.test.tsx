import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ObjectContextMenu, DROP_TITLE } from "./ObjectContextMenu";
import * as objectCrud from "../../../lib/objectCrud";
import { useDbViewerStore } from "../../../stores/dbViewerStore";

describe("ObjectContextMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDbViewerStore.getState().reset();
  });

  it("DROP_TITLE covers the table and role kinds (exhaustiveness)", () => {
    expect(DROP_TITLE.table).toBe("table");
    expect(DROP_TITLE.role).toBe("role");
  });

  it("Edit on a sequence opens an objectForm tab with prefilled edit params", async () => {
    render(
      <ObjectContextMenu
        connectionId="c1"
        objectType="sequence"
        item={{ schema: "public", name: "s" }}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    fireEvent.click(screen.getByText("Edit…"));
    const st = useDbViewerStore.getState();
    expect(st.tabs).toHaveLength(1);
    expect(st.tabs[0].tabType).toBe("objectForm");
    expect(st.tabs[0].form?.mode).toBe("edit");
    expect(st.tabs[0].form?.kind).toBe("sequence");
    expect(st.tabs[0].form?.params?.name).toBe("s");
    expect(st.tabs[0].form?.params?.schema).toBe("public");
  });

  it("Create on a sequence opens an objectForm tab in create mode", async () => {
    render(
      <ObjectContextMenu
        connectionId="c1"
        objectType="sequence"
        item={{ schema: "public", name: "s" }}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    fireEvent.click(screen.getByText("Create…"));
    const st = useDbViewerStore.getState();
    expect(st.tabs).toHaveLength(1);
    expect(st.tabs[0].tabType).toBe("objectForm");
    expect(st.tabs[0].form?.mode).toBe("create");
    expect(st.tabs[0].form?.kind).toBe("sequence");
    expect(st.tabs[0].form?.params?.name).toBe("");
  });

  it("Drop fetches dependencies then stages the drop", async () => {
    vi.spyOn(objectCrud, "buildObjectDdl").mockResolvedValue([
      'DROP SEQUENCE "public"."s"',
    ]);
    const addChange = vi.spyOn(useDbViewerStore.getState(), "addChange");
    render(
      <ObjectContextMenu
        connectionId="c1"
        objectType="sequence"
        item={{ schema: "public", name: "s" }}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    fireEvent.click(screen.getByText("Drop…"));
    // DependencyDialog with no deps → Proceed is enabled
    expect(
      await screen.findByRole("button", { name: /proceed/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /proceed/i }));
    await waitFor(() =>
      expect(addChange).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ddl",
          sql: 'DROP SEQUENCE "public"."s"',
        }),
      ),
    );
  });
});