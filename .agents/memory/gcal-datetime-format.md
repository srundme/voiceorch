---
name: Google Calendar datetime format
description: The correct way to pass event times to Google Calendar API — local datetime string (no Z) + timeZone field
---

## Rule
Always use `formatInTimeZone(date, tz, "yyyy-MM-dd'T'HH:mm:ss")` from `date-fns-tz` for `dateTime` values, paired with the `timeZone` field.

Never use `date.toISOString()` (which produces a UTC string with `Z` suffix) when also specifying `timeZone`.

```ts
// CORRECT
const localStart = formatInTimeZone(startTime, timezone, "yyyy-MM-dd'T'HH:mm:ss");
start: { dateTime: localStart, timeZone: timezone }

// WRONG — timeZone field is silently ignored when dateTime has a Z offset
start: { dateTime: startTime.toISOString(), timeZone: timezone }
```

**Why:** Per Google Calendar API RFC, when `dateTime` contains an explicit timezone offset (like `Z` for UTC), the separate `timeZone` field is ignored for time interpretation. The event is stored as UTC. For half-hour-offset timezones like IST (UTC+5:30), this doesn't cause an error but causes the `timeZone` display hint to be dropped, which can lead to 30-minute misalignment when the attendee's calendar locale differs from IST.

**How to apply:** Any time you call `calendar.events.insert()` or `calendar.events.patch()` with a `start`/`end` block that also sets `timeZone`, ensure the `dateTime` string has NO timezone offset. Use `formatInTimeZone` from `date-fns-tz` to convert the UTC Date object to a local-time string in the target timezone.
