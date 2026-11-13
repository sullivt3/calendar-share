import { describe, expect, it } from "vitest";
import { spaceNameSchema, tokenSchema, sharingSchema, idSchema } from "../../src/shared/spaces";
describe("space boundaries", () => {
  it("trims names and rejects empty/oversized names", () => {
    expect(spaceNameSchema.parse({ name: " Together " }).name).toBe("Together");
    expect(spaceNameSchema.safeParse({ name: " " }).success).toBe(false);
    expect(spaceNameSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
  it("accepts only supported sharing modes and UUIDs", () => {
    expect(sharingSchema.safeParse({ mode: "EVERYONE" }).success).toBe(false);
    expect(idSchema.safeParse("../private").success).toBe(false);
    expect(tokenSchema.safeParse({ token: "guess" }).success).toBe(false);
    expect(tokenSchema.safeParse({ token: "a".repeat(64) }).success).toBe(true);
  });
});
