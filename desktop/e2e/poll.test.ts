import { describe, expect, it, vi } from "vitest";
import { HarnessError } from "./errors.mjs";
import { pollUntil } from "./poll.mjs";

function fakeClock() {
  let clock = 0;
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    get elapsed() {
      return clock;
    },
  };
}

describe("pollUntil", () => {
  it("returns the first truthy attempt result without sleeping", async () => {
    const clock = fakeClock();
    const attempt = vi.fn().mockResolvedValue("ready");
    await expect(
      pollUntil(attempt, {
        timeoutMs: 1_000,
        intervalMs: 100,
        label: "grid",
        sleep: clock.sleep,
        now: clock.now,
      }),
    ).resolves.toBe("ready");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(clock.elapsed).toBe(0);
  });

  it("retries until an attempt succeeds", async () => {
    const clock = fakeClock();
    const attempt = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue("visible");
    await expect(
      pollUntil(attempt, {
        timeoutMs: 1_000,
        intervalMs: 100,
        label: "grid",
        sleep: clock.sleep,
        now: clock.now,
      }),
    ).resolves.toBe("visible");
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(clock.elapsed).toBe(200);
  });

  it("keeps polling through thrown attempts", async () => {
    const clock = fakeClock();
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error("no such element"))
      .mockResolvedValue("visible");
    await expect(
      pollUntil(attempt, {
        timeoutMs: 1_000,
        intervalMs: 100,
        label: "grid",
        sleep: clock.sleep,
        now: clock.now,
      }),
    ).resolves.toBe("visible");
  });

  it("fails with the label, the budget and the last error once time runs out", async () => {
    const clock = fakeClock();
    const attempt = vi.fn().mockRejectedValue(new Error("no such element"));
    const failure = pollUntil(attempt, {
      timeoutMs: 250,
      intervalMs: 100,
      label: "demo table grid",
      sleep: clock.sleep,
      now: clock.now,
    });
    await expect(failure).rejects.toBeInstanceOf(HarnessError);
    await expect(failure).rejects.toThrow(/demo table grid/);
    await expect(failure).rejects.toThrow(/250ms/);
    await expect(failure).rejects.toThrow(/no such element/);
  });

  it("reports an unresolved condition when attempts return falsy values", async () => {
    const clock = fakeClock();
    const attempt = vi.fn().mockResolvedValue(false);
    await expect(
      pollUntil(attempt, {
        timeoutMs: 150,
        intervalMs: 100,
        label: "connection card",
        sleep: clock.sleep,
        now: clock.now,
      }),
    ).rejects.toThrow(/connection card did not appear within 150ms/);
  });
});
