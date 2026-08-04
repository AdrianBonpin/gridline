import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectionMetadataRow } from "./ConnectionMetadataRow";
import type { ConnectionFormData } from "./connectionFormData";
import type { Folder, Tag } from "../../lib/types";

const BASE_FORM: ConnectionFormData = {
  name: "", environment: null, folder_id: null, tag_ids: [],
  connection_string: "", db_type: "postgresql", host: "", port: 5432,
  username: null, password: null, database: null, use_keychain: false, ssh_password: null,
};
const folders: Folder[] = [{ id: "f1", name: "Work", parent_id: null, tag_ids: [], created_at: "", updated_at: "" }];
const tags: Tag[] = [{ id: "t1", name: "prod", color: "#f00", created_at: "" }];

describe("ConnectionMetadataRow", () => {
  it("renders a Connection Label input and emits name changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Wrapper() {
      const [form, setForm] = useState(BASE_FORM);
      return (
        <ConnectionMetadataRow
          form={form}
          folders={folders}
          tags={tags}
          onChange={(updates) => {
            onChange(updates);
            setForm((prev) => ({ ...prev, ...updates }));
          }}
        />
      );
    }
    render(<Wrapper />);
    const label = screen.getByLabelText(/connection label/i);
    await user.type(label, "My DB");
    expect(onChange).toHaveBeenLastCalledWith({ name: "My DB" });
  });

  it("toggles the tag picker via + Add Tags and selects a tag", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConnectionMetadataRow form={BASE_FORM} folders={folders} tags={tags} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /add tags/i }));
    await user.click(screen.getByRole("button", { name: /prod/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tag_ids: ["t1"] }));
  });

  it("changes the environment via Set Env", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConnectionMetadataRow form={BASE_FORM} folders={folders} tags={tags} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /set env/i }));
    const envSection = screen.getByTestId("environment-section");
    await user.click(within(envSection).getByRole("button"));
    await user.click(within(envSection).getByRole("button", { name: "Production" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ environment: "production" }));
  });

  it("changes the folder via the folder select", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConnectionMetadataRow form={BASE_FORM} folders={folders} tags={tags} onChange={onChange} />);
    const folderSection = screen.getByTestId("folder-section");
    await user.click(within(folderSection).getByRole("button"));
    await user.click(within(folderSection).getByRole("button", { name: "Work" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ folder_id: "f1" }));
  });
});