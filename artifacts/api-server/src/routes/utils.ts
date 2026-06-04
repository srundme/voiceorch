import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { normalizePhone, type WorkspacePhoneConfig } from "../services/phone-normalization.js";

const router: IRouter = Router();

/*
 * SnapServe Custom Function tool configuration
 * ─────────────────────────────────────────────
 * Name:        get_current_datetime
 * URL:         https://<your-replit-domain>/api/utils/datetime
 * Method:      GET
 * Parameters:  none required  (optional: tz=<IANA timezone>)
 * Description: "Returns the real current date and time in IST. Call this at
 *               the start of every conversation to ground relative date
 *               expressions like 'tomorrow', 'next Monday', or 'next week'
 *               into exact calendar dates before calling check_availability
 *               or book_appointment."
 *
 * System prompt addition:
 *   "Before handling any date or time reference, call get_current_datetime
 *    to get today's real date. Always use the returned `context` field to
 *    resolve relative dates."
 *
 * Example response:
 * {
 *   "iso": "2026-05-30T14:32:00+05:30",
 *   "date": "Saturday, May 30, 2026",
 *   "time": "2:32 PM",
 *   "dayOfWeek": "Saturday",
 *   "timezone": "Asia/Kolkata",
 *   "utcOffset": "+05:30",
 *   "context": "Today is Saturday, May 30, 2026. The current time is 2:32 PM IST (UTC+05:30). Use this to resolve relative dates: 'tomorrow' = Sunday May 31 2026, 'next Monday' = June 1 2026."
 * }
 */

function getUtcOffset(date: Date, tz: string): string {
  const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const tzDate = new Date(date.toLocaleString("en-US", { timeZone: tz }));
  const offsetMinutes = (tzDate.getTime() - utcDate.getTime()) / 60000;
  const absMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absMinutes / 60).toString().padStart(2, "0");
  const mins = (absMinutes % 60).toString().padStart(2, "0");
  return `${offsetMinutes >= 0 ? "+" : "-"}${hours}:${mins}`;
}

function getNextWeekday(from: Date, targetDay: number, tz: string): Date {
  const tzDateStr = from.toLocaleDateString("en-CA", { timeZone: tz });
  const [y, m, d] = tzDateStr.split("-").map(Number) as [number, number, number];
  const base = new Date(y, m - 1, d);
  const currentDay = base.getDay();
  const diff = ((targetDay - currentDay + 7) % 7) || 7;
  base.setDate(base.getDate() + diff);
  return base;
}

router.get("/utils/datetime", (req, res): void => {
  const tz = (typeof req.query["tz"] === "string" && req.query["tz"]) || "Asia/Kolkata";

  let now: Date;
  try {
    now = new Date();
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(now);
  } catch {
    res.status(400).json({ error: `Unknown timezone: ${tz}` });
    return;
  }

  const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const dayFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
  });

  const isoFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const dateStr = dateFmt.format(now);
  const timeStr = timeFmt.format(now);
  const dayOfWeek = dayFmt.format(now);
  const utcOffset = getUtcOffset(now, tz);

  const isoFormatted = isoFmt.format(now).replace(", ", "T") + utcOffset;

  const tzAbbr = tz === "Asia/Kolkata" ? "IST" : tz;
  const utcOffsetLabel = `UTC${utcOffset}`;

  const tomorrow = getNextWeekday(now, (now.getDay() + 1) % 7 === 0 ? 0 : -1, tz);
  const tomorrowLocal = new Date(now);
  tomorrowLocal.setDate(tomorrowLocal.getDate());

  const tomorrowFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const tomorrowDate = new Date(now.getTime() + 86400000);
  const tomorrowStr = tomorrowFmt.format(tomorrowDate);
  const tomorrowDay = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(tomorrowDate);
  const tomorrowShort = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long", day: "numeric", year: "numeric" }).format(tomorrowDate);

  const nextMonday = getNextWeekday(now, 1, tz);
  const nextMondayStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(nextMonday);

  const context =
    `Today is ${dateStr}. The current time is ${timeStr} ${tzAbbr} (${utcOffsetLabel}). ` +
    `Use this to resolve relative dates: 'tomorrow' = ${tomorrowDay} ${tomorrowShort}, ` +
    `'next Monday' = ${nextMondayStr}.`;

  res.json({
    iso: isoFormatted,
    date: dateStr,
    time: timeStr,
    dayOfWeek,
    timezone: tz,
    utcOffset,
    context,
  });
});

// POST /utils/normalize-phone
router.post("/utils/normalize-phone", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { phone, countryCode, nationalDigitLength } = req.body as {
    phone: string;
    countryCode?: string;
    nationalDigitLength?: number;
  };

  if (!phone) { res.status(400).json({ error: "phone is required" }); return; }

  const config: WorkspacePhoneConfig = {
    defaultCountryCode: countryCode ?? "91",
    nationalDigitLength: nationalDigitLength ?? 10,
  };

  res.json(normalizePhone(phone, config));
});

export default router;
