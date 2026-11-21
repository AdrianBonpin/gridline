import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

import * as commands from "./commands";
import { useConnectionStore } from "../stores/connectionStore";
import {
  SESSION_CREDENTIAL_REQUIRED,
  isSessionCredentialRequired,
  sessionCredentialConnectionId,
  withSessionCredential,
} from "./sessionCredential";
import type { Connection } from "./types";

const makeConn = (over: Partial<Connection> = {}): Connection => ({
  id: "c1",
  name: "Prod",
  db_type: "postgresql",
  host: "h",
  port: 5432,
  username: "u",
  database: "d",
  folder_id: null,
  keychain_ref: null,
  tag_ids: [],
  favorite: false,
  use_keychain: false,
  created_at: "",
  updated_at: "",
  ...over,
});

/** Poll until a synchronous condition holds (the prompt is opened in a microtask). */
async function until<T>(read: () => T | null | undefined): Promise<T> {
  for (let i = 0; i < 100; i += 1) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition was never met");
}

beforeEach(() => {
  // Restore first: `setState` copies the current state, so restoring after it
  // would carry an earlier test's spy into this test's state object.
  vi.restoreAllMocks();
  // Drop a prompt left open by a failed test so it cannot answer the next one.
  if (useConnectionStore.getState().sessionCredentialPrompt) {
    useConnectionStore.getState().resolveSessionCredential(null);
  }
  useConnectionStore.setState({
    connections: [makeConn({ id: "c1" }), makeConn({ id: "conn-2", name: "Target" })],
    sessionCredentialPrompt: null,
  });
});

describe("session credential refusal", () => {
  it("recognizes the backend state code and names the connection", () => {
    const error = new Error("session-credential-required:conn-2");
    expect(isSessionCredentialRequired(error)).toBe(true);
    expect(sessionCredentialConnectionId(error)).toBe("conn-2");
  });

  it("ignores unrelated failures", () => {
    const error = new Error("file-grant-expired: choose the file again");
    expect(isSessionCredentialRequired(error)).toBe(false);
    expect(sessionCredentialConnectionId(error)).toBeNull();
  });

  it("accepts a bare refusal without a connection id", () => {
    expect(sessionCredentialConnectionId(SESSION_CREDENTIAL_REQUIRED)).toBeNull();
  });
});

describe("withSessionCredential", () => {
  it("runs the job untouched when no credential is needed", async () => {
    const job = vi.fn(async () => "job-1");
    const request = vi.spyOn(
      useConnectionStore.getState(),
      "requestSessionCredential",
    );

    await expect(withSessionCredential("c1", job)).resolves.toBe("job-1");

    expect(job).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it("asks for the missing session password once and retries the same job", async () => {
    let attempts = 0;
    const job = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("session-credential-required:conn-2");
      }
      return "job-1";
    });
    const store = vi
      .spyOn(commands, "storeSessionCredential")
      .mockResolvedValue(undefined);

    const run = withSessionCredential("c1", job);
    const prompt = await until(
      () => useConnectionStore.getState().sessionCredentialPrompt,
    );
    // The refusal names the connection: a sync may need only its target.
    expect(prompt.connectionId).toBe("conn-2");
    expect(prompt.connectionName).toBe("Target");
    expect(job).toHaveBeenCalledTimes(1);

    useConnectionStore.getState().resolveSessionCredential("typed-password");

    await expect(run).resolves.toBe("job-1");
    expect(job).toHaveBeenCalledTimes(2);
    // The answered password is kept for this session only, and mirrored to
    // backend memory before the retried job runs.
    expect(store).toHaveBeenCalledWith("conn-2", "typed-password");
    expect(await useConnectionStore.getState().getConnectionPassword("conn-2")).toBe(
      "typed-password",
    );
    expect(useConnectionStore.getState().sessionCredentialPrompt).toBeNull();
  });

  it("falls back to the page's connection when the refusal names none", async () => {
    let attempts = 0;
    const job = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error(SESSION_CREDENTIAL_REQUIRED);
      return "job-1";
    });

    const run = withSessionCredential("c1", job);
    const prompt = await until(
      () => useConnectionStore.getState().sessionCredentialPrompt,
    );
    expect(prompt.connectionId).toBe("c1");

    useConnectionStore.getState().resolveSessionCredential("pw");
    await expect(run).resolves.toBe("job-1");
  });

  it("fails without retrying when the prompt is cancelled", async () => {
    const job = vi.fn(async () => {
      throw new Error("session-credential-required:c1");
    });

    const run = withSessionCredential("c1", job);
    await until(() => useConnectionStore.getState().sessionCredentialPrompt);
    useConnectionStore.getState().resolveSessionCredential(null);

    await expect(run).rejects.toThrow(/session password is required/i);
    expect(job).toHaveBeenCalledTimes(1);
  });

  it("passes other failures through without prompting", async () => {
    const job = vi.fn(async () => {
      throw new Error("pg_dump not found");
    });
    const request = vi.spyOn(
      useConnectionStore.getState(),
      "requestSessionCredential",
    );

    await expect(withSessionCredential("c1", job)).rejects.toThrow(
      "pg_dump not found",
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("does not prompt twice when the answered password still is not accepted", async () => {
    const job = vi.fn(async () => {
      throw new Error("session-credential-required:c1");
    });
    const request = vi.spyOn(
      useConnectionStore.getState(),
      "requestSessionCredential",
    );

    const run = withSessionCredential("c1", job);
    await until(() => useConnectionStore.getState().sessionCredentialPrompt);
    useConnectionStore.getState().resolveSessionCredential("pw");

    await expect(run).rejects.toThrow(/could not be used/i);
    expect(request).toHaveBeenCalledTimes(1);
    expect(job).toHaveBeenCalledTimes(2);
  });
});
