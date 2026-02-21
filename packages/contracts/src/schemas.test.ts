import { describe, expect, it } from "vitest";
import { nutrientKeySchema } from "./schemas.js";

describe("nutrientKeySchema", () => {
  it("accepts canonical keys", () => {
    expect(nutrientKeySchema.parse("kcal")).toBe("kcal");
    expect(nutrientKeySchema.parse("omega6_g")).toBe("omega6_g");
  });

  it("rejects unknown keys", () => {
    expect(() => nutrientKeySchema.parse("foo")).toThrow();
  });
});
