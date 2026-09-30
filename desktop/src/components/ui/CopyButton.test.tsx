import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { CopyButton } from "./CopyButton";

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

/**
 * Capture Node-level unhandled rejections. jsdom does not dispatch
 * `window.unhandledrejection` for rejections originating in the environment, so
 * the process event is the only reliable signal that a failed clipboard write
 * escaped the click handler.
 */
interface UnhandledRejectionEmitter {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
}

const nodeProcess = (
  globalThis as unknown as { process?: UnhandledRejectionEmitter }
).process;

function captureUnhandledRejections() {
  const seen: unknown[] = [];
  const listener = (reason: unknown) => {
    seen.push(reason);
  };
  nodeProcess?.on("unhandledRejection", listener);
  return {
    seen,
    stop: () => nodeProcess?.off("unhandledRejection", listener),
  };
}

/** Let queued microtasks and Node's unhandled-rejection check drain. */
async function drain() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("CopyButton", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockClipboard(vi.fn().mockResolvedValue(undefined));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies the given text to the clipboard", async () => {
    render(<CopyButton text="brew install mysql-client" />);
    fireEvent.click(screen.getByTitle("Copy to clipboard"));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "brew install mysql-client",
      ),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it("shows a transient Copied confirmation", async () => {
    render(<CopyButton text="brew install libpq" />);
    const btn = screen.getByTitle("Copy to clipboard");
    expect(btn.textContent).toBe("Copy");

    fireEvent.click(btn);

    await waitFor(() => expect(screen.getByTitle("Copy to clipboard").textContent).toBe("Copied"));
  });

  it("reverts to Copy after the confirmation delay", async () => {
    vi.useFakeTimers();
    render(<CopyButton text="brew install libpq" />);
    const btn = screen.getByTitle("Copy to clipboard");

    fireEvent.click(btn);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTitle("Copy to clipboard").textContent).toBe("Copied");

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByTitle("Copy to clipboard").textContent).toBe("Copy");
  });

  it("stays quiet when the clipboard rejects", async () => {
    const rejected = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    mockClipboard(rejected);
    const unhandled = captureUnhandledRejections();

    render(<CopyButton text="brew install libpq" />);
    fireEvent.click(screen.getByTitle("Copy to clipboard"));

    await waitFor(() => expect(rejected).toHaveBeenCalled());
    await drain();

    expect(screen.getByTitle("Copy to clipboard").textContent).toBe("Copy");
    expect(unhandled.seen).toEqual([]);
    unhandled.stop();
  });

  it("stays quiet when the clipboard API is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const unhandled = captureUnhandledRejections();

    render(<CopyButton text="brew install libpq" />);
    expect(() =>
      fireEvent.click(screen.getByTitle("Copy to clipboard")),
    ).not.toThrow();

    await drain();

    expect(screen.getByTitle("Copy to clipboard").textContent).toBe("Copy");
    expect(unhandled.seen).toEqual([]);
    unhandled.stop();
  });

  it("uses a custom label for the accessible name", () => {
    render(<CopyButton text="x" label="Copy install command" />);
    expect(screen.getByTitle("Copy install command")).toBeTruthy();
    expect(screen.getByLabelText("Copy install command")).toBeTruthy();
  });
});
