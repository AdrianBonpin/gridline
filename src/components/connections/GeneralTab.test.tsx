import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GeneralTab } from "./GeneralTab";
import type { ConnectionFormData } from "./connectionFormData";

const BASE_FORM: ConnectionFormData = {
  name: "",
  environment: null,
  folder_id: null,
  tag_ids: [],
  connection_string: "",
  db_type: "postgresql",
  host: "localhost",
  port: 5432,
  username: "postgres",
  password: "secret",
  database: "mydb",
  use_keychain: true,
};

describe("GeneralTab", () => {
  it("renders a Name input and passes value to onChange", () => {
    const onChange = vi.fn();
    render(<GeneralTab form={BASE_FORM} onChange={onChange} />);

    const nameInput = screen.getByLabelText("Name");
    expect(nameInput).toBeInTheDocument();
    expect(nameInput).toHaveValue(BASE_FORM.name);

    fireEvent.change(nameInput, { target: { value: "My New Name" } });
    expect(onChange).toHaveBeenCalledWith({ name: "My New Name" });
  });

  it("renders host, port, user, password, and database fields", () => {
    render(<GeneralTab form={BASE_FORM} onChange={() => {}} />);

    expect(screen.getByLabelText("Host")).toBeInTheDocument();
    expect(screen.getByLabelText("Port")).toBeInTheDocument();
    expect(screen.getByLabelText("User")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Database")).toBeInTheDocument();
  });

  it("hides host and port for sqlite but shows database", () => {
    render(<GeneralTab form={{ ...BASE_FORM, db_type: "sqlite" }} onChange={() => {}} />);

    expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Port")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Database")).toBeInTheDocument();
  });
});