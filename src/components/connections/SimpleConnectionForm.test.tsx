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
  }
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
    render(
      <StatefulForm
        folders={[]}
        tags={[]}
        onChange={onChange}
      />
    );
    const input = screen.getByLabelText(/connection string/i);
    await user.type(input, "postgresql://a@b/c");
    expect(onChange).toHaveBeenLastCalledWith({ connection_string: "postgresql://a@b/c" });
    expect(input).toHaveValue("postgresql://a@b/c");
  });
});