import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { DetailedConnectionForm } from "./DetailedConnectionForm";

import type { ConnectionFormData } from "./connectionFormData";
import type { DetailedConnectionFormProps } from "./DetailedConnectionForm";

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
  props: Omit<DetailedConnectionFormProps, "form" | "onChange"> & {
    onChange?: (updates: Partial<ConnectionFormData>) => void;
  },
) {
  const [form, setForm] = useState<ConnectionFormData>(BASE_FORM);
  return (
    <DetailedConnectionForm
      {...props}
      form={form}
      onChange={(updates) => {
        setForm((prev) => ({ ...prev, ...updates }));
        props.onChange?.(updates);
      }}
    />
  );
}

describe("DetailedConnectionForm", () => {
  it("updates host and port", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatefulForm onChange={onChange} />);
    await user.type(screen.getByLabelText(/host/i), "localhost");
    await user.clear(screen.getByLabelText(/port/i));
    await user.type(screen.getByLabelText(/port/i), "5432");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ host: "localhost" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ port: 5432 }));
  });
});