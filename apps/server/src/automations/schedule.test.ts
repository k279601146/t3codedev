import { describe, expect, it } from "vitest";

import { computeNextRunAt } from "./schedule.ts";

process.env.TZ = "UTC";

describe("computeNextRunAt", () => {
  it("computes minute interval schedules", () => {
    expect(
      computeNextRunAt(
        {
          kind: "interval",
          minutes: 15,
        },
        "2026-01-01T00:00:00.000Z",
      ),
    ).toBe("2026-01-01T00:15:00.000Z");
  });

  it("computes daily schedules later on the same day", () => {
    expect(
      computeNextRunAt(
        {
          kind: "daily",
          time: "09:30",
        },
        "2026-01-01T08:00:00.000Z",
      ),
    ).toBe("2026-01-01T09:30:00.000Z");
  });

  it("rolls daily schedules to the next day after the target time", () => {
    expect(
      computeNextRunAt(
        {
          kind: "daily",
          time: "09:30",
        },
        "2026-01-01T10:00:00.000Z",
      ),
    ).toBe("2026-01-02T09:30:00.000Z");
  });

  it("computes weekly schedules", () => {
    expect(
      computeNextRunAt(
        {
          kind: "weekly",
          weekday: 1,
          time: "09:00",
        },
        "2026-01-01T00:00:00.000Z",
      ),
    ).toBe("2026-01-05T09:00:00.000Z");
  });

  it("computes cron schedules through croner", () => {
    expect(
      computeNextRunAt(
        {
          kind: "cron",
          expression: "*/10 * * * *",
        },
        "2026-01-01T00:05:00.000Z",
      ),
    ).toBe("2026-01-01T00:10:00.000Z");
  });

  it("returns null for invalid cron and time schedules", () => {
    expect(
      computeNextRunAt(
        { kind: "cron", expression: "not a cron" },
        "2026-01-01T00:00:00.000Z",
      ),
    ).toBeNull();
    expect(
      computeNextRunAt({ kind: "daily", time: "25:99" }, "2026-01-01T00:00:00.000Z"),
    ).toBeNull();
  });
});
