import { describe, it, expect } from "vitest";

describe("test infrastructure", () => {
  it("vitest is configured with jsdom", () => {
    const div = document.createElement("div");
    div.textContent = "hello";
    document.body.appendChild(div);
    expect(div).toHaveTextContent("hello");
  });
});