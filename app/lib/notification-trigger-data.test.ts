import { describe, expect, it } from "vitest";
import { snippet } from "./notification-trigger-data";

describe("snippet", () => {
  it("collapses whitespace in short text and leaves it whole", () => {
    expect(snippet("  Thanks,\n\nthat   helped!  ")).toBe(
      "Thanks, that helped!"
    );
  });

  it("cuts long text to 140 characters ending in …", () => {
    const reason =
      "I bought this course for my team by mistake and meant to buy a single Individual Purchase for myself instead, so I'd like my money back please.";

    expect(snippet(reason)).toBe(
      "I bought this course for my team by mistake and meant to buy a single Individual Purchase for myself instead, so I'd like my money back ple…"
    );
  });
});
