import { describe, expect, it } from "vitest";

import { formatDate } from "../format";

describe("formatDate", () => {
  it("formats date-only values stored by forms", () => {
    expect(formatDate("2026-04-24")).toBe("Apr 24, 2026");
  });

  it("formats SQLite datetime values stored by default timestamps", () => {
    expect(formatDate("2026-04-24 14:03:12")).toBe("Apr 24, 2026");
  });

  it("formats ISO timestamps without shifting the calendar day", () => {
    expect(formatDate("2026-04-24T01:02:03.000Z")).toBe("Apr 24, 2026");
  });
});
