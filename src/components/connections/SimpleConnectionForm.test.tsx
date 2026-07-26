import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { SimpleConnectionForm } from "./SimpleConnectionForm";
import type { ConnectionFormData } from "./connectionFormData";
import type { SimpleConnectionFormProps } from "./SimpleConnectionForm";

const BASE_FORM: ConnectionFormData = {
  name: "",
  environment: null,
  folder_id: null,
  tag_ids: [],
  connection_string: "",
  db_type: "postgresql",
  host: "",
  port: 5432,
  username: null,
  password: null,
  database: null,
  use_keychain: false,
};

function StatefulForm(
  props: Omit<SimpleConnectionFormProps, "form" | "onChange"> & {
    onChange?: (updates: Partial<ConnectionFormData>) => void;
  },
) {
  const [form, setForm] = useState<ConnectionFormData>(BASE_FORM);
  return (
    <SimpleConnectionForm
      {...props}
      form={form}
      onChange={(updates) => {
        setForm((prev) => ({ ...prev, ...updates }));
        props.onChange?.(updates);
      }}
    />
  );
}

describe("SimpleConnectionForm", () => {
  it("updates the connection string", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatefulForm folders={[]} tags={[]} onChange={onChange} />);
    const input = screen.getByLabelText(/connection string/i);
    await user.type(input, "postgresql://a@b/c");
    expect(onChange).toHaveBeenLastCalledWith({
      connection_string: "postgresql://a@b/c",
    });
    expect(input).toHaveValue("postgresql://a@b/c");
  });

  it("toggles a tag via the SearchableTagPicker", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const tags = [
      {
        id: "tag-1",
        name: "Work",
        color: "#ff0000",
        created_at: "2024-01-01T00:00:00Z",
      },
      {
        id: "tag-2",
        name: "Personal",
        color: "#00ff00",
        created_at: "2024-01-01T00:00:00Z",
      },
    ];
    render(<StatefulForm folders={[]} tags={tags} onChange={onChange} />);

    const workTag = screen.getByText("Work");
    await user.click(workTag);
    expect(onChange).toHaveBeenLastCalledWith({ tag_ids: ["tag-1"] });

    await user.click(workTag);
    expect(onChange).toHaveBeenLastCalledWith({ tag_ids: [] });
  });
});
