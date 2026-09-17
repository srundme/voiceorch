/**
 * Pull intake fields from the caller's last turn in process — no LLM.
 *
 * The spoken agent only talks. Form writes are this extractor plus
 * executeIntakeWrite, so a persist chat cannot stall TTS or leave the
 * line dead until the caller nudges.
 */
import { normalizeIntakeField } from "./candidate-intake-fields.js";
import {
  addCalendarDaysIso,
  noticePeriodLengthDays,
  parseNoticePeriodSelect,
  upcomingIsoFromDayOfMonth,
} from "./intake-dispositions.js";
import {
  canonicalCityName,
  isBangaloreCityName,
  isBangalorePlace,
  parseLastCompany,
  parsePincode,
  parseScreenYesNo,
  parseTenure,
} from "./intake-screen.js";

const NOTICE_PERIOD_OPTIONS = [
  "15 Days",
  "30 Days",
  "45 Days",
  "60 Days",
  "90 Days",
  "Other",
] as const;

const NAME_NOISE = new Set([
  "yes", "no", "ok", "okay", "yeah", "yep", "nah", "nope", "hi", "hello",
  "hey", "hmm", "huh", "um", "uh", "please", "thanks", "thank you",
  "sir", "madam", "maam", "haan", "ha", "fine", "sure", "correct",
]);

const DISCOVERY_NOISE = /\b(called|calling|looking|job|jobs|ad|advert|referral|refer|assist|help|want|wanted|opening|vacancy)\b/i;

export interface IntakeExtractInput {
  transcript: string;
  waitingOn: readonly string[];
  lastAgentText?: string;
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function primaryIs(waitingOn: readonly string[], ...needles: string[]): boolean {
  const first = (waitingOn[0] ?? "").toLowerCase();
  return needles.some((n) => first.includes(n.toLowerCase()));
}

function waitingHas(waitingOn: readonly string[], ...needles: string[]): boolean {
  const blob = waitingOn.join(" ").toLowerCase();
  return needles.some((n) => blob.includes(n.toLowerCase()));
}

function prefersOffice(text: string): boolean {
  return /\b(?:don'?t|do not|not)\s+(?:want\s+|need\s+)?(?:to\s+)?(?:work\s+from\s+home|wfh)\b/i.test(text)
    || /\bready to (?:come to|work from|join) (?:the )?office\b/i.test(text)
    || /\bprefer(?:ring)? (?:to )?(?:come to |work from )?the office\b/i.test(text)
    || /\bcome to (?:the )?office\b/i.test(text)
    || /\boffice is (?:fine|okay|ok)\b/i.test(text);
}

function prefersWfh(text: string): boolean {
  if (prefersOffice(text)) return false;
  return /\b(?:prefer(?:ring)?|need|want)\s+(?:to\s+)?(?:work from home|wfh)\b/i.test(text)
    || /\bwork from home\b/i.test(text)
    || /\bwfh\b/i.test(text);
}

function lastWorkingDayFromSpeech(text: string): string | null {
  const iso = extractIsoDate(text, true);
  if (iso) return iso;
  const stripped = text.replace(/\b(?:\d+|fifteen|thirty|forty[\s-]*five|sixty|ninety|one|two|three|a|an)\s*(?:days?|months?)\b/gi, " ");
  const ordinal = stripped.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/i);
  if (ordinal) return upcomingIsoFromDayOfMonth(Number(ordinal[1]));
  const labeled = stripped.match(
    /\b(?:last\s+(?:working\s+)?(?:day|date)|lwd)(?:\s+is|\s+on)?\s*(?:the\s+)?(\d{1,2})\b/i,
  );
  if (labeled) return upcomingIsoFromDayOfMonth(Number(labeled[1]));
  const bare = stripped.replace(/\s+/g, " ").trim();
  if (/^\d{1,2}$/.test(bare)) return upcomingIsoFromDayOfMonth(Number(bare));
  return null;
}

function formatNoticeRemark(period: string | null, lwd: string | null): string | null {
  const bits = [
    period ? `Notice ${period}` : null,
    lwd ? `last working day ${lwd}` : null,
  ].filter(Boolean);
  return bits.length > 0 ? bits.join("; ") : null;
}

function agentAsked(lastAgentText: string, ...needles: string[]): boolean {
  const blob = lastAgentText.toLowerCase();
  return needles.some((n) => blob.includes(n.toLowerCase()));
}

function putField(patch: Record<string, unknown>, key: Parameters<typeof normalizeIntakeField>[0], raw: unknown): void {
  const result = normalizeIntakeField(key, raw);
  if (result.ok && result.value != null && result.value !== "") {
    patch[key] = result.value;
  }
}

function looksLikeName(text: string): boolean {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed || NAME_NOISE.has(trimmed.toLowerCase())) return false;
  if (DISCOVERY_NOISE.test(trimmed)) return false;
  if (isBangalorePlace(trimmed) || parseScreenYesNo(trimmed)) return false;
  if (parsePincode(trimmed) || /@/.test(trimmed) || /\d/.test(trimmed)) return false;
  const parts = words(trimmed);
  if (parts.length < 1 || parts.length > 3) return false;
  return /^[A-Za-z][A-Za-z .'-]{0,79}$/.test(trimmed);
}

function volunteeredName(text: string): string | null {
  const m = text.match(
    /\b(?:my name is|name is|i(?:'m| am) called|this is|it(?:'s| is))\s+([A-Za-z][A-Za-z.'-]{1,40}(?:\s+[A-Za-z][A-Za-z.'-]{1,40}){0,2})\b/i,
  );
  if (!m) return null;
  const name = m[1]!.trim();
  return looksLikeName(name) ? name : null;
}

function splitName(text: string): { firstName: string; lastName?: string } | null {
  if (!looksLikeName(text)) return null;
  const parts = words(text);
  if (parts.length === 1) return { firstName: parts[0]! };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

function extractCity(text: string): string | null {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed || NAME_NOISE.has(trimmed.toLowerCase())) return null;
  if (parseScreenYesNo(trimmed) && words(trimmed).length <= 2) return null;

  if (isBangaloreCityName(trimmed)) return "BANGALORE";
  if (isBangalorePlace(trimmed) && words(trimmed).length <= 6) {
    return canonicalCityName(trimmed);
  }

  const placePhrase = trimmed.match(
    /\b(?:from|in|live(?:s)?\s+(?:in|at)|staying\s+(?:in|at)|based\s+in)\s+([A-Za-z][A-Za-z .]{1,40}?)(?:[.,!]|$)/i,
  );
  if (placePhrase) {
    const place = placePhrase[1]!.trim();
    if (isBangaloreCityName(place)) return "BANGALORE";
    if (isBangalorePlace(place)) return canonicalCityName(place);
    const result = normalizeIntakeField("city", place);
    if (result.ok && result.value) return String(result.value);
  }

  if (words(trimmed).length <= 4 && !DISCOVERY_NOISE.test(trimmed)) {
    const result = normalizeIntakeField("city", trimmed);
    if (result.ok && result.value) return String(result.value);
  }
  return null;
}

function extractIsoDate(text: string, allowFuture: boolean): string | null {
  const dob = normalizeIntakeField("dateOfBirth", text);
  if (dob.ok && typeof dob.value === "string") return dob.value;
  const trimmed = text.replace(/\s+/g, " ").trim().replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");
  const dmy = trimmed.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (!dmy) return null;
  const day = Number(dmy[1]);
  const month = Number(dmy[2]);
  const year = Number(dmy[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!allowFuture && iso >= new Date().toISOString().slice(0, 10)) return null;
  return iso;
}

function yesNoSelect(raw: ReturnType<typeof parseScreenYesNo>): "Yes" | "No" | null {
  if (raw === "yes") return "Yes";
  if (raw === "no") return "No";
  return null;
}

/**
 * Map one caller turn onto save_candidate_details args. Empty object means
 * the form should stay untouched this turn (discovery, backchannel, noise).
 */
export function extractIntakePatchFromTurn(opts: IntakeExtractInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const text = opts.transcript.replace(/\s+/g, " ").trim();
  if (!text) return patch;

  const waiting = opts.waitingOn;
  const agent = opts.lastAgentText ?? "";
  const yn = parseScreenYesNo(text);

  const email = normalizeIntakeField("email", text);
  if (email.ok && email.value) patch.email = email.value;

  const pin = parsePincode(text);
  if (pin) patch.pincode = pin;

  const notice = parseNoticePeriodSelect(text, NOTICE_PERIOD_OPTIONS)
    ?? (waitingHas(waiting, "servingNotice", "serving_notice") && /^\d{1,2}$/.test(text)
      ? parseNoticePeriodSelect(`${text} days`, NOTICE_PERIOD_OPTIONS)
      : null);
  if (/\blast year\b/i.test(text) && (primaryIs(waiting, "tenure", "lastCompany", "number of companies") || waitingHas(waiting, "tenure"))) {
    patch.tenure = "1 year";
  } else if (/\b(?:year|yr|month|mos?)\b/i.test(text) || primaryIs(waiting, "tenure", "lastCompany")) {
    const tenure = parseTenure(text);
    if (tenure) patch.tenure = tenure;
  }

  const named = volunteeredName(text);
  const onName = primaryIs(waiting, "first name", "last name")
    || (waitingHas(waiting, "first name", "last name") && (agentAsked(agent, "name", "surname") || Boolean(named)));
  if (onName && (primaryIs(waiting, "first name") || named)) {
    const split = splitName(named ?? (looksLikeName(text) ? text : ""));
    if (split) {
      putField(patch, "firstName", split.firstName);
      if (split.lastName) putField(patch, "lastName", split.lastName);
    }
  } else if (onName && primaryIs(waiting, "last name")) {
    const last = named ?? (looksLikeName(text) ? text : "");
    if (last) putField(patch, "lastName", last);
  }

  const city = extractCity(text);
  const volunteeredPlace = /\b(?:from|live|staying|based)\b/i.test(text);
  if (city && (primaryIs(waiting, "city they live in") || volunteeredPlace)) {
    putField(patch, "city", city);
  }
  if (primaryIs(waiting, "job city") && yn === "yes" && /bangalore|bengaluru|bengalore|\bthere\b/i.test(agent)) {
    putField(patch, "jobCity", "BANGALORE");
  } else if (city && primaryIs(waiting, "job city")) {
    putField(patch, "jobCity", city);
  }

  if (waitingHas(waiting, "fresher or experienced") || /\b(fresher|experienced|working professional)\b/i.test(text)) {
    if (/\bfresher\b/i.test(text)) putField(patch, "workStatus", "fresher");
    else if (/\b(?:experienced|working professional|already working)\b/i.test(text)) {
      putField(patch, "workStatus", "experienced");
    }
  }

  if (primaryIs(waiting, "lastCompany") || /\b(?:work(?:ing)?\s+(?:at|with|for))\b/i.test(text)) {
    const atCompany = text.match(/\b(?:at|with|for)\s+([A-Za-z][A-Za-z0-9 .&'-]{1,60}?)(?:\s+for\b|[.,]|$)/i);
    const company = parseLastCompany(atCompany?.[1] ?? text);
    if (company && !parseScreenYesNo(company) && !isBangalorePlace(company) && !primaryIs(waiting, "last name", "first name")) {
      patch.lastCompany = company;
    }
  }

  if (waitingHas(waiting, "number of companies") || /\bcompanies?\b/i.test(text)) {
    if (/\b(?:one|a|single)\s+compan(?:y|ies)\b/i.test(text)) putField(patch, "totalCompanies", "1");
    else if (/\btwo\s+compan(?:y|ies)\b/i.test(text)) putField(patch, "totalCompanies", "2");
    else if (primaryIs(waiting, "number of companies")) putField(patch, "totalCompanies", text);
  }

  if (waitingHas(waiting, "servingNotice", "serving_notice") || notice || /\bnotice\b|\blast (?:working )?(?:day|date)\b/i.test(text)) {
    if (yn) patch.servingNotice = yn;
    if (notice) {
      patch.servingNotice = "yes";
      patch.noticePeriod = notice;
    }
    const spokenLwd = lastWorkingDayFromSpeech(text);
    const noticeDays = notice ? noticePeriodLengthDays(notice) : null;
    if (spokenLwd) patch.lastWorkingDay = spokenLwd;
    else if (noticeDays && waitingHas(waiting, "servingNotice", "serving_notice")) {
      patch.lastWorkingDay = addCalendarDaysIso(noticeDays);
    }
    const remark = formatNoticeRemark(
      typeof patch.noticePeriod === "string" ? patch.noticePeriod : null,
      typeof patch.lastWorkingDay === "string" ? patch.lastWorkingDay : null,
    );
    if (remark) patch.noticeRemarks = remark;
  }

  if (waitingHas(waiting, "hasCareerGap") && yn) patch.hasCareerGap = yn;
  if (waitingHas(waiting, "otherDomain")) {
    if (/\b(?:voice|bpo|call\s*centre|call\s*center)\b/i.test(text) && !/\bother\b/i.test(text)) {
      patch.otherDomain = "no";
    } else if (yn) {
      patch.otherDomain = yn;
    }
  }
  if (waitingHas(waiting, "missingExpDocs")) {
    if (/\b(can't|cannot|don't have|no documents?)\b/i.test(text)) patch.missingExpDocs = "yes";
    else if (/\b(can share|i can|i have|yes i can)\b/i.test(text)) patch.missingExpDocs = "no";
    else if (yn) patch.missingExpDocs = yn === "yes" ? "no" : "yes";
  }
  if (waitingHas(waiting, "missingEduDocs")) {
    if (/\b(can't|cannot|don't have|no documents?)\b/i.test(text)) patch.missingEduDocs = "yes";
    else if (/\b(can share|i can|i have|yes i can)\b/i.test(text)) patch.missingEduDocs = "no";
    else if (yn) patch.missingEduDocs = yn === "yes" ? "no" : "yes";
  }

  if (waitingHas(waiting, "graduate or post graduate")) {
    if (/\bpost\s*grad/i.test(text) || /\b(?:pg|masters?|mba|mtech)\b/i.test(text)) {
      putField(patch, "qualification", "post graduate");
    } else if (/\bgraduat/i.test(text) || /\b(?:ug|bachelors?|degree)\b/i.test(text)) {
      putField(patch, "qualification", "graduate");
    }
  }

  if (waitingHas(waiting, "date of birth")) {
    const dob = extractIsoDate(text, false);
    if (dob) putField(patch, "dateOfBirth", dob);
  }

  if (primaryIs(waiting, "shift they can work") || agentAsked(agent, "night", "evening", "shift")) {
    if (yn === "yes" && /night|evening|shift|us/i.test(agent)) {
      putField(patch, "shiftBase", "US");
    } else if (/\bevening\b/i.test(text) || (/\bnight\b/i.test(text) && /\bevening\b/i.test(text))) {
      putField(patch, "shiftBase", "US");
    } else if (/\bnight\b/i.test(text)) {
      putField(patch, "shiftBase", "night");
    } else {
      const shift = normalizeIntakeField("shiftBase", text);
      if (shift.ok && shift.value) patch.shiftBase = shift.value;
    }
  }

  if (prefersOffice(text) || (waitingHas(waiting, "work_from_home") && /office/i.test(text))) {
    patch.wantsWfh = "no";
    patch["work_from_home.willing_to_work_from_office"] = "Yes";
  } else if (prefersWfh(text)) {
    patch.wantsWfh = "yes";
  } else if (waitingHas(waiting, "wantsWfh")) {
    if (/\b(?:wfh|work from home|from home)\b/i.test(text)) patch.wantsWfh = "yes";
    else if (/\b(?:office|on[\s-]?site|okay|fine)\b/i.test(text) || yn === "no") patch.wantsWfh = "no";
    else if (yn === "yes" && /office/i.test(agent)) patch.wantsWfh = "no";
  }
  if (waitingHas(waiting, "needsWeekendOff")) {
    if (/\b(?:saturday|sunday|weekend)\b/i.test(text) && !/\b(?:rotational|fine|okay|any)\b/i.test(text)) {
      patch.needsWeekendOff = "yes";
    } else if (/\b(?:rotational|fine|okay|any)\b/i.test(text) || yn === "no") {
      patch.needsWeekendOff = "no";
    }
  }

  const relocate = yesNoSelect(yn);
  if (relocate && waitingHas(waiting, "out_station_candidate.will_relocate", "out_station_candidate")) {
    patch["out_station_candidate.will_relocate"] = relocate;
    patch.disposition = "out_station_candidate";
  }
  if (relocate && waitingHas(waiting, "non_hiring_zone.will_relocate", "non_hiring_zone")) {
    patch["non_hiring_zone.will_relocate"] = relocate;
    if (!patch.disposition) patch.disposition = "non_hiring_zone";
  }
  if (relocate && waitingHas(waiting, "shift_issues")) {
    patch["shift_issues.willing_for_alternate_shift"] = relocate;
    patch.disposition = "shift_issues";
  }

  return patch;
}
