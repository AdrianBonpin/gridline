import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectionMetadataRow } from "./ConnectionMetadataRow";
import type { ConnectionFormData } from "./connectionFormData";

const BASE_FORM: ConnectionFormData = {
  name: "", environment: null, folder_id: null, tag_ids: [],
  connection_string: "", db_type: "postgresql", host: "", port: 5432,
  username: null, password: null, database: null, use_keychain: false, ssh_password: null,
};

describe("ConnectionMetadataRow", () => {
  it("renders a Connection Label input and emits name changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Wrapper() {
      const [form, setForm] = useState(BASE_FORM);
      return (
        <ConnectionMetadataRow
          form={form}
          onChange={(updates) => {
            onChange(updates);
            setForm((prev) => ({ ...prev, ...updates }));
          }}
        />
      );
    }
    render(<Wrapper />);
    const label = screen.getByLabelText(/connection label/i);
    expect(label).toBeInTheDocument();
    await user.type(label, "My DB");
    expect(onChange).toHaveBeenLastCalledWith({ name: "My DB" });
  });

  it("does not render tag/env/folder controls", () => {
    render(<ConnectionMetadataRow form={BASE_FORM} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /add tags/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /set env/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("environment-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("folder-section")).not.toBeInTheDocument();
  });
});