import { describe, it, expect, vi } from "vitest";
import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders title and message", () => {
    render(
      <ConfirmDialog open title="Delete?" message="Are you sure?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("Delete?")).toBeInTheDocument();
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog open title="Delete?" message="Are you sure?" onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    await user.click(screen.getByText(/confirm/i));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("calls onCancel when cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="Delete?" message="Are you sure?" onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    await user.click(screen.getByText(/cancel/i));
    expect(onCancel).toHaveBeenCalled();
  });

  it("removes content from DOM after exit animation", async () => {
    const { rerender } = render(
      <ConfirmDialog open title="Delete?" message="Are you sure?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("Delete?")).toBeInTheDocument();
    rerender(
      <ConfirmDialog open={false} title="Delete?" message="Are you sure?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    await waitForElementToBeRemoved(() => screen.queryByText("Delete?"));
    expect(screen.queryByText("Delete?")).not.toBeInTheDocument();
  });

  it("calls onCancel when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="Delete?" message="Are you sure?" onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });
});