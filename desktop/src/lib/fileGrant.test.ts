import { describe, it, expect } from "vitest";
import {
  FILE_GRANT_CODES,
  FILE_GRANT_STATE,
  fileGrantErrorKind,
  fileGrantErrorMessage,
} from "./fileGrant";

describe("fileGrantErrorKind", () => {
  it("recognises each backend grant rejection from its code prefix", () => {
    expect(
      fileGrantErrorKind(
        "file-grant-expired: The file selection expired five minutes after it was made.",
      ),
    ).toBe("expired");
    expect(
      fileGrantErrorKind("file-grant-consumed: already used by another job."),
    ).toBe("consumed");
    expect(
      fileGrantErrorKind("file-grant-wrong-intent: different operation."),
    ).toBe("wrong-intent");
    expect(
      fileGrantErrorKind("file-grant-invalid: No file selection authorizes this."),
    ).toBe("invalid");
  });

  it("reads the code out of an Error, which is what invoke rejects with in tests", () => {
    expect(
      fileGrantErrorKind(new Error(`${FILE_GRANT_CODES.expired}: expired`)),
    ).toBe("expired");
  });

  it("does not classify ordinary failures as grant states", () => {
    expect(fileGrantErrorKind("pg_dump: connection refused")).toBeNull();
    expect(fileGrantErrorKind("Connection not found: abc")).toBeNull();
    expect(fileGrantErrorKind(new Error("boom"))).toBeNull();
    expect(fileGrantErrorKind("file-grant-somethingelse: nope")).toBeNull();
    expect(fileGrantErrorKind(undefined)).toBeNull();
  });

  it("strips the code from the displayed message", () => {
    expect(
      fileGrantErrorMessage(
        "file-grant-expired: The file selection expired five minutes after it was made. Choose the file again.",
      ),
    ).toBe(
      "The file selection expired five minutes after it was made. Choose the file again.",
    );
    expect(fileGrantErrorMessage("pg_dump: connection refused")).toBeNull();
  });

  it("gives every grant state a visible title and recovery text", () => {
    for (const kind of Object.keys(FILE_GRANT_STATE)) {
      const state = FILE_GRANT_STATE[kind as keyof typeof FILE_GRANT_STATE];
      expect(state.title.length).toBeGreaterThan(0);
      expect(state.detail).toMatch(/choose/i);
    }
  });
});
