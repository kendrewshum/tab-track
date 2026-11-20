import { describe, expect, it } from "vitest";

import { getInitials } from "../avatar";

describe("getInitials", () => {
  it("uses the first letters of the first and last words", () => {
    expect(getInitials("Kendrew Shum")).toBe("KS");
    expect(getInitials("Mary Ann van Dyke")).toBe("MD");
  });

  it("uses the first two letters of a single word", () => {
    expect(getInitials("Rae")).toBe("RA");
    expect(getInitials("J")).toBe("J");
  });

  it("uppercases and ignores surrounding whitespace", () => {
    expect(getInitials("  priya   lal ")).toBe("PL");
  });

  it("keeps non-Latin and emoji characters whole", () => {
    expect(getInitials("Élodie")).toBe("ÉL");
    expect(getInitials("😀 Smile")).toBe("😀S");
  });

  it("falls back to a placeholder for a blank name", () => {
    expect(getInitials("")).toBe("?");
    expect(getInitials("   ")).toBe("?");
  });
});
