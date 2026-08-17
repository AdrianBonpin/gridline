import { describe, it, expect } from "vitest";
import { faqItems } from "./faq";

describe("faqItems", () => {
  it("has exactly 5 items", () => {
    expect(faqItems).toHaveLength(5);
  });

  it("every item has a non-empty question and answer", () => {
    for (const item of faqItems) {
      expect(item.question.trim().length).toBeGreaterThan(0);
      expect(item.answer.trim().length).toBeGreaterThan(0);
    }
  });

  it("questions are unique", () => {
    const questions = faqItems.map((i) => i.question);
    expect(new Set(questions).size).toBe(questions.length);
  });
});
