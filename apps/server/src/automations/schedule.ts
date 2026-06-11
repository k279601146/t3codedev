// @effect-diagnostics globalDate:off
import type { AutomationSchedule } from "@t3tools/contracts";
import { Cron } from "croner";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseTime(value: string): { readonly hours: number; readonly minutes: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return {
    hours: Number(match[1]),
    minutes: Number(match[2]),
  };
}

function makeDate(value: number | string): Date {
  return new globalThis.Date(value);
}

function nextDailyRun(from: Date, time: string): Date | null {
  const parsed = parseTime(time);
  if (!parsed) return null;
  const next = makeDate(from.getTime());
  next.setSeconds(0, 0);
  next.setHours(parsed.hours, parsed.minutes, 0, 0);
  if (next <= from) {
    next.setTime(next.getTime() + DAY_MS);
  }
  return next;
}

function nextWeeklyRun(from: Date, weekday: number, time: string): Date | null {
  const daily = nextDailyRun(from, time);
  if (!daily) return null;
  const daysAhead = (weekday - daily.getDay() + 7) % 7;
  const next = makeDate(daily.getTime());
  next.setDate(daily.getDate() + daysAhead);
  if (next <= from) {
    next.setDate(next.getDate() + 7);
  }
  return next;
}

export function computeNextRunAt(
  schedule: AutomationSchedule,
  from: number | string = globalThis.Date.now(),
): string | null {
  const fromDate = makeDate(from);
  switch (schedule.kind) {
    case "interval":
      return makeDate(fromDate.getTime() + schedule.minutes * 60_000).toISOString();
    case "daily":
      return nextDailyRun(fromDate, schedule.time)?.toISOString() ?? null;
    case "weekly":
      return nextWeeklyRun(fromDate, schedule.weekday, schedule.time)?.toISOString() ?? null;
    case "cron": {
      try {
        const cron = new Cron(schedule.expression, { paused: true });
        return cron.nextRun(fromDate)?.toISOString() ?? null;
      } catch {
        return null;
      }
    }
  }
}
