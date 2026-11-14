import { expect, it } from "vitest";

it("never warns about missing Knock keys under vitest, where there are none", async () => {
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    await import("./knock.server");
  } finally {
    console.warn = original;
  }

  expect(warnings).toEqual([]);
});
