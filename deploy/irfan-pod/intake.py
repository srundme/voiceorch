"""Candidate intake for Sruthi.

The prompt only tells her how to speak. This module is the call program:
one next question, the facts already heard, and the disposition those facts
support. She does not choose the path.
"""
from __future__ import annotations

import re
from datetime import date

MALE_NAMES = {
    "aarav", "abhay", "abhishek", "aditya", "ajay", "akash", "amit", "anand", "anil", "ankit",
    "arjun", "arun", "ashok", "deepak", "dinesh", "gaurav", "harish", "irfan", "karthik",
    "karthikeyan", "krishna", "manoj", "mohan", "naveen", "nikhil", "nitin", "pradeep",
    "rahul", "rajesh", "rakesh", "ramesh", "ravi", "rohan", "rohit", "sanjay", "santosh",
    "suresh", "surya", "vijay", "vikram", "vinod", "vishal",
}
FEMALE_NAMES = {
    "aishwarya", "ananya", "anjali", "anushka", "divya", "kavya", "lakshmi", "neha", "pooja",
    "priya", "priyanka", "ramya", "shreya", "sruthi", "swathi", "varsha",
}
FEMALE_SUFFIXES = ("amma", "eshwari", "wari", "priya", "lata", "latha", "bai", "devi")
MALE_SUFFIXES = ("endra", "eshwar", "raj", "deep", "veer", "nath", "pal")

ENGLISH = ("Excellent", "Very good", "Good", "Average", "Poor")
BLR_WORDS = ("bangalore", "bengaluru", "blr")

# Every call, in this order. Phone is already the number on the line.
# Gender and English are filled by the program, never asked.
ORDER: tuple[tuple[str, str], ...] = (
    ("first_name", "their first name"),
    ("last_name", "their surname"),
    ("email", "their email. Let them finish spelling it, then repeat it back once"),
    ("date_of_birth", "their date of birth"),
    ("work_status", "whether they are a fresher or have worked before"),
    ("total_companies", "how many companies they have worked with"),
    ("city", "the city they are in right now"),
    ("job_city", "the city they want to work in"),
    ("pincode", "their 6-digit pincode"),
    ("skill_role", "the role they do or want"),
    ("skill", "international voice, domestic voice, or non-voice"),
    ("industry", "the industry they have worked in"),
    ("qualification", "their qualification"),
    ("shift", "the shift they want"),
    ("dnd", "whether they want these calls to stop"),
)

LABELS = {
    "voice_mail": "Voice mail",
    "call_disconnected": "Call disconnected",
    "not_interested": "Not interested",
    "busy_call_me_back": "Busy, call me back",
    "other_recruiter": "Other recruiter",
    "out_station_candidate": "Out station, will not relocate",
    "non_hiring_zone": "Non hiring zone",
    "other_domain_experience": "Other domain",
    "poor_communication": "Poor communication",
    "age_limit": "Age limit",
    "career_gap": "Career gap",
    "shift_issues": "Shift issues",
    "serving_notice": "Serving notice",
    "cooling_period": "Cooling period",
    "no_company": "No company",
    "work_from_home": "Work from home",
    "high_salary": "High salary",
    "need_weekend_off": "Need weekend off",
    "line_up_scheduled": "Line up scheduled",
}


def empty_screen(phone: str = "") -> dict:
    screen = {key: "" for key, _ask in ORDER}
    screen.update({
        "phone": _digits(phone),
        "gender": "",
        "english": "",
        "will_relocate": "",
        "stay": "",
        "wants_bpo": "",
        "birth_year": "",
        "tenth_year": "",
        "twelfth_year": "",
        "diploma_year": "",
        "degree_year": "",
        "pg_year": "",
        "exam_years_asked": "",
        "gap_reason": "",
        "notice": "",
        "attended": "",
        "cooling": "",
        "shift_ok": "",
        "skill_down": "",
        "wants_wfh": "",
        "office_ok": "",
        "weekend_off": "",
        "expected_salary": "",
        "salary_ok": "",
        "call_event": "",
        "callback_when": "",
        "pincode_partial": "",
        "pincode_later": "",
        "no_opening": "",
        "disposition": "",
    })
    return screen


def infer_gender(name: str) -> str:
    cleaned = re.sub(r"[^a-z\s]", " ", name.lower())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return ""
    if re.match(r"^(mr|shri|sri|master)\b", cleaned):
        return "Male"
    if re.match(r"^(mrs|ms|miss|smt)\b", cleaned):
        return "Female"
    parts = [part for part in cleaned.split(" ") if len(part) > 1]
    for part in parts:
        male = part in MALE_NAMES
        female = part in FEMALE_NAMES
        if male and not female:
            return "Male"
        if female and not male:
            return "Female"
    first = parts[0] if parts else ""
    if len(first) >= 5:
        if first.endswith(FEMALE_SUFFIXES):
            return "Female"
        if first.endswith(MALE_SUFFIXES):
            return "Male"
    return ""


def apply_save(screen: dict, patch: dict) -> dict:
    """Store what she heard. Empty and unknown values do not wipe a fact."""
    nxt = dict(screen)
    for key, raw in patch.items():
        if key not in nxt or key in {"gender", "disposition", "phone"}:
            continue
        if key == "exam_years_asked":
            if _yes_no(raw) == "yes" or str(raw or "").strip():
                nxt["exam_years_asked"] = "yes"
            continue
        if key == "pincode":
            _take_pin(nxt, raw)
            continue
        value = _normalize(key, raw)
        if value:
            nxt[key] = value
            if key.endswith("_year"):
                nxt["exam_years_asked"] = "yes"
    if nxt.get("work_status") == "fresher":
        nxt["total_companies"] = "0"
    if nxt.get("first_name"):
        nxt["gender"] = infer_gender(nxt["first_name"])
    gap = education_gap(nxt)
    if gap:
        nxt["education_gap"] = gap
    else:
        nxt.pop("education_gap", None)
    return nxt


def education_gap(screen: dict) -> str:
    """yes, no, or empty when the years are not there yet."""
    birth = _year(screen.get("birth_year")) or _year_in(screen.get("date_of_birth"))
    tenth = _year(screen.get("tenth_year"))
    twelfth = _year(screen.get("twelfth_year"))
    diploma = _year(screen.get("diploma_year"))
    degree = _year(screen.get("degree_year"))
    pg = _year(screen.get("pg_year"))
    if not birth or not any((tenth, twelfth, diploma, degree, pg)):
        return ""
    if tenth and not 15 <= tenth - birth <= 17:
        return "yes"
    if twelfth and tenth and twelfth - tenth > 2:
        return "yes"
    if twelfth and not 17 <= twelfth - birth <= 19:
        return "yes"
    if diploma and twelfth and diploma - twelfth > 2:
        return "yes"
    if diploma and not twelfth and tenth and diploma - tenth > 3:
        return "yes"
    if degree and twelfth and degree - twelfth > 3:
        return "yes"
    if degree and not 20 <= degree - birth <= 22:
        return "yes"
    if pg and degree and pg - degree > 2:
        return "yes"
    return "no"


def step(screen: dict, jobs: list[dict] | None = None) -> dict:
    """The one thing she does next, and the disposition if the facts already decide it."""
    jobs = jobs or []
    caught = _interrupt(screen)
    if caught:
        return caught
    for key, ask in ORDER:
        if key == "total_companies" and screen.get("work_status") == "fresher":
            continue
        if key == "pincode" and screen.get("pincode_later") == "yes":
            continue
        if key == "pincode" and screen.get("pincode_partial"):
            got = str(screen["pincode_partial"])
            left = 6 - len(got)
            return _open(
                f"the rest of the pincode. They already said {got}. "
                f"Repeat {got} and ask only for the remaining {left} digits."
            )
        if not str(screen.get(key) or "").strip():
            return _open(ask)
    follow = _follow(screen, jobs)
    if follow:
        return follow
    return _filed("line_up_scheduled", "Call match_jobs. Speak only a job it returns.", pitch=True, done=True)


def screen_note(screen: dict, jobs: list[dict] | None = None) -> str:
    current = step(screen, jobs)
    known = []
    for key, _ask in ORDER:
        value = str(screen.get(key) or "").strip()
        if value:
            known.append(f"{key.replace('_', ' ')}: {value}")
    if screen.get("gender"):
        known.append(f"gender: {screen['gender']} (from the first name, do not ask)")
    if screen.get("english"):
        known.append(f"english: {screen['english']} (from how they speak, do not ask)")
    if screen.get("phone"):
        known.append(f"phone: {screen['phone']}")
    lines = [
        "=== SCREEN ===",
        "This is a phone call, not a form. Speak one or two short sentences in your own words.",
        "React to what they just said, then bring up the next topic. Do not read this note aloud.",
        "Do not start every reply with their name. Do not say 'could you please share'.",
        "Do not repeat a question they already started answering.",
        "Call save_screen only for a fact the latest audio clearly said.",
        "If you are not sure, say you missed it and do not save that fact.",
        "Do not fill a surname, a year, a city, or a job from an older summary.",
        "Do not choose a disposition. Do not ask gender. Do not ask them to rate their English.",
        "Send english on save_screen as Excellent, Very good, Good, Average, or Poor from how they are speaking.",
    ]
    if known:
        lines.append("Known: " + "; ".join(known))
    else:
        lines.append("Known: phone only, if it is listed on this call.")
    if screen.get("pincode_partial") and not screen.get("pincode"):
        lines.append(f"Pincode so far: {screen['pincode_partial']}")
    lines.append(f"Next topic: {current['ask']}")
    if current["disposition"]:
        lines.append(f"Disposition: {current['label']}")
    else:
        lines.append("Disposition: not chosen yet")
    lines.append("=== END SCREEN ===")
    return "\n".join(lines)


def card(screen: dict, jobs: list[dict] | None = None) -> dict:
    current = step(screen, jobs)
    return {
        "phone": screen.get("phone") or "",
        "firstName": screen.get("first_name") or "",
        "lastName": screen.get("last_name") or "",
        "email": screen.get("email") or "",
        "gender": screen.get("gender") or "",
        "dateOfBirth": screen.get("date_of_birth") or "",
        "workStatus": screen.get("work_status") or "",
        "totalCompanies": screen.get("total_companies") or "",
        "city": screen.get("city") or "",
        "jobCity": screen.get("job_city") or "",
        "pincode": screen.get("pincode") or "",
        "skillRole": screen.get("skill_role") or "",
        "skill": screen.get("skill") or "",
        "industry": screen.get("industry") or "",
        "qualification": screen.get("qualification") or "",
        "shift": screen.get("shift") or "",
        "dnd": screen.get("dnd") or "",
        "english": screen.get("english") or "",
        "disposition": current["label"],
        "next": "" if current["done"] else current["ask"],
        "pitch": current["pitch"],
    }


def _interrupt(screen: dict) -> dict | None:
    if screen.get("dnd") == "yes":
        return _close("", "Tell them the calls will be blocked, then end_call. Do not offer a job.")
    event = screen.get("call_event") or ""
    if event == "voicemail":
        return _close("voice_mail", "The call reached voicemail. end_call. Do not assess them.")
    if event == "disconnected":
        return _close("call_disconnected", "The call disconnected. end_call.")
    if event == "not_interested":
        return _close("not_interested", "They are not interested. Say a short close, then end_call.")
    if event == "other_recruiter":
        return _close("other_recruiter", "Another recruiter owns this. Say a short close, then end_call.")
    if event == "busy":
        if not screen.get("callback_when"):
            return _open("Ask when you should call them back, and save callback_when.")
        return _close("busy_call_me_back", "Confirm the callback time, then end_call.")
    return None


def _follow(screen: dict, jobs: list[dict]) -> dict | None:
    if not _in_bangalore(screen):
        if not screen.get("will_relocate"):
            return _open("This place is not Bangalore. Ask whether they will relocate to Bangalore.")
        if screen.get("will_relocate") == "no":
            if _non_hiring(screen.get("pincode")):
                return _close("non_hiring_zone", "They will not relocate out of a non-hiring area. Say the team cannot line this up, then end_call.")
            return _close("out_station_candidate", "They will not relocate to Bangalore. Say a short close, then end_call.")
        if _non_hiring(screen.get("pincode")) and not screen.get("stay"):
            return _open("Ask whether they stay in a paying guest or with family.")

    if _other_domain(screen) and not screen.get("wants_bpo"):
        return _open("Their background is not a BPO voice job. Ask whether a BPO voice job would work for them.")
    if screen.get("wants_bpo") == "no":
        return _close("other_domain_experience", "They do not want a BPO job. Say a short close, then end_call.")

    if screen.get("english") == "Poor" and screen.get("skill") == "international" and not screen.get("skill_down"):
        return _open("Their English is below an international voice process. Ask whether domestic voice or non-voice would work. If they pick one, save skill. If they refuse both, save skill_down as no.")
    if screen.get("skill_down") == "no" and screen.get("english") == "Poor":
        return _close("poor_communication", "Their English does not fit a voice process they will take. Say a short close, then end_call.")

    if _age_blocked(screen, jobs):
        return _close("age_limit", "Their age is outside every opening that states an age range. Say the team will call if a fitting opening comes, then end_call.")

    if not screen.get("exam_years_asked"):
        return _open("Ask the year they finished 10th, and the year of their latest exam. Save tenth_year and degree_year or twelfth_year.")
    gap = education_gap(screen)
    if gap == "yes" and not screen.get("gap_reason"):
        return _open("There is a gap in the years. Ask what they did in that gap, and save gap_reason.")
    if gap == "yes" and screen.get("gap_reason"):
        return _close("career_gap", "The gap is on the profile. Say the team has to check it before a lineup, then end_call.")

    if screen.get("shift") == "day" and not screen.get("shift_ok"):
        return _open("Ask whether they can do a US or night shift. Save shift_ok as yes or no.")
    if screen.get("shift_ok") == "no":
        return _close("shift_issues", "They cannot do the shift these openings need. Say a short close, then end_call.")

    if screen.get("work_status") == "experienced" and not screen.get("notice"):
        return _open("Ask their notice period, and whether they can join now.")
    if screen.get("notice") in {"serving", "later"}:
        return _close("serving_notice", "They cannot join now. Say the team has to check a later batch. Do not promise one. Then end_call.")
    if screen.get("work_status") == "experienced" and not screen.get("attended"):
        return _open("Ask which companies they have already attended. If none, save attended as none.")
    if screen.get("cooling") == "yes":
        return _close("cooling_period", "They are inside a cooling period. Say they can apply again after it, then end_call.")

    if screen.get("wants_wfh") == "yes" and not screen.get("office_ok"):
        return _open("They want work from home. Ask whether they will still come to the Bangalore office.")
    if screen.get("wants_wfh") == "yes" and screen.get("office_ok") == "no":
        return _close("work_from_home", "They will not come to the office. Say these openings are office-based, then end_call.")

    salary = _money(screen.get("expected_salary"))
    ceiling = _salary_ceiling(jobs)
    if salary and ceiling and salary > ceiling and not screen.get("salary_ok"):
        return _open("Their expected salary is above the openings. Ask whether they will accept the range on the opening. Save salary_ok as yes or no.")
    if screen.get("salary_ok") == "no":
        return _close("high_salary", "They will not accept the salary on the openings. Say you will call if something higher comes, then end_call.")

    if screen.get("no_opening") == "yes":
        return _close("no_company", "There is no opening that fits. Say the team will call if one comes, then end_call.")

    if screen.get("weekend_off") == "yes":
        return _filed("need_weekend_off", "They need a weekend off. Call match_jobs. A lineup is still allowed. Speak only a job it returns.", pitch=True, done=True)
    return None


def _open(ask: str) -> dict:
    return {"ask": ask, "disposition": "", "label": "", "pitch": False, "done": False}


def _close(disposition: str, ask: str) -> dict:
    return {"ask": ask, "disposition": disposition, "label": LABELS.get(disposition, ""), "pitch": False, "done": True}


def _filed(disposition: str, ask: str, pitch: bool, done: bool) -> dict:
    return {"ask": ask, "disposition": disposition, "label": LABELS.get(disposition, ""), "pitch": pitch, "done": done}


def _normalize(key: str, raw: object) -> str:
    text = " ".join(str(raw or "").split())
    if not text or text.lower() in {"unknown", "n/a", "none", "null"}:
        if key == "attended" and text.lower() == "none":
            return "none"
        return ""
    if key in {"city", "job_city"}:
        if re.search(r"bangal|bengl|bangle|\bblr\b", text.lower()):
            return "Bangalore"
        return text[:80]
    if key in {"dnd", "will_relocate", "wants_bpo", "shift_ok", "office_ok", "weekend_off", "salary_ok", "cooling", "wants_wfh", "skill_down", "pincode_later"}:
        return _yes_no(text)
    if key == "work_status":
        low = text.lower()
        if "fresh" in low:
            return "fresher"
        if "experience" in low or "working" in low:
            return "experienced"
        return ""
    if key == "skill":
        low = text.lower()
        if "non" in low:
            return "non-voice"
        if "domestic" in low:
            return "domestic"
        if "international" in low:
            return "international"
        return ""
    if key == "english":
        low = text.lower()
        for rating in ENGLISH:
            if rating.lower() == low:
                return rating
        return ""
    if key == "pincode":
        digits = re.sub(r"\D", "", text)
        if re.fullmatch(r"[1-8]\d{5}", digits):
            return digits
        return ""
    if key == "shift":
        low = text.lower()
        if any(word in low for word in ("us", "night", "rotat", "graveyard")):
            return "us"
        if "uk" in low:
            return "uk"
        if "day" in low or "morning" in low:
            return "day"
        if "any" in low:
            return "any"
        return text[:40]
    if key == "call_event":
        low = text.lower().replace(" ", "_")
        allowed = {"voicemail", "disconnected", "not_interested", "busy", "other_recruiter"}
        if low in allowed:
            return low
        if "not interested" in text.lower():
            return "not_interested"
        if "voice mail" in text.lower() or "voicemail" in text.lower():
            return "voicemail"
        return ""
    if key in {"birth_year", "tenth_year", "twelfth_year", "diploma_year", "degree_year", "pg_year", "joined_year"}:
        year = _year_in(text)
        return str(year) if year else ""
    if key == "total_companies":
        match = re.search(r"\d+", text)
        return match.group(0) if match else ""
    if key == "notice":
        low = text.lower()
        if any(word in low for word in ("immediate", "now", "today", "no notice", "not serving")):
            return "now"
        if "serv" in low or "day" in low or "month" in low:
            return "serving"
        return text[:40]
    if key == "expected_salary":
        amount = _money(text)
        return str(amount) if amount else ""
    return text[:80]


def _yes_no(text: str) -> str:
    key = re.sub(r"[^a-z]", "", text.lower())
    if key in {"yes", "y", "yeah", "yep", "haan", "ha", "ok", "okay", "sure"}:
        return "yes"
    if key in {"no", "n", "nah", "nope"}:
        return "no"
    if re.search(r"\b(won't|will not|cannot|can't|dont|don't|not)\b", text.lower()):
        return "no"
    if re.search(r"\b(will|can|yes)\b", text.lower()):
        return "yes"
    return ""


def _in_bangalore(screen: dict) -> bool:
    pin = str(screen.get("pincode") or "")
    if re.fullmatch(r"[1-8]\d{5}", pin):
        return pin.startswith(("560", "562"))
    place = f"{screen.get('city') or ''} {screen.get('job_city') or ''}".lower()
    return any(word in place for word in BLR_WORDS)


def _non_hiring(pin: object) -> bool:
    text = str(pin or "")
    return text.startswith("5772")


def _other_domain(screen: dict) -> bool:
    if screen.get("skill") == "non-voice":
        return True
    industry = str(screen.get("industry") or "").lower()
    if not industry:
        return False
    if any(word in industry for word in ("bpo", "voice", "call cent", "customer care", "customer service")):
        return False
    return True


def _age_blocked(screen: dict, jobs: list[dict]) -> bool:
    age = _age(screen.get("date_of_birth"))
    if age is None:
        return False
    ranged = [job for job in jobs if job.get("minAge") or job.get("maxAge")]
    if not ranged:
        return False
    for job in ranged:
        low = int(job.get("minAge") or 0)
        high = int(job.get("maxAge") or 200)
        if low <= age <= high:
            return False
    return True


def _age(text: object) -> int | None:
    raw = str(text or "")
    year = _year_in(raw)
    if year:
        age = date.today().year - year
        if 16 <= age <= 70:
            return age
    match = re.search(r"\b(\d{2})\b", raw)
    if match:
        age = int(match.group(1))
        if 16 <= age <= 70:
            return age
    return None


def _year(value: object) -> int | None:
    text = str(value or "").strip()
    if re.fullmatch(r"(19|20)\d{2}", text):
        return int(text)
    return None


def _year_in(value: object) -> int | None:
    match = re.search(r"\b(19\d{2}|20\d{2})\b", str(value or ""))
    if not match:
        return None
    year = int(match.group(1))
    if 1940 <= year <= date.today().year:
        return year
    return None


def _money(value: object) -> int | None:
    digits = re.sub(r"[^\d]", "", str(value or ""))
    if not digits:
        return None
    amount = int(digits)
    if amount < 1000 or amount > 500000:
        return None
    return amount


def _salary_ceiling(jobs: list[dict]) -> int:
    caps = [int(job["salaryMax"]) for job in jobs if isinstance(job.get("salaryMax"), (int, float))]
    return max(caps) if caps else 0


def save_tool() -> dict:
    keys = [key for key, _ask in ORDER] + [
        "english", "will_relocate", "stay", "wants_bpo", "skill_down",
        "birth_year", "tenth_year", "twelfth_year", "diploma_year", "degree_year", "pg_year",
        "exam_years_asked", "gap_reason", "notice", "attended", "cooling",
        "shift_ok", "wants_wfh", "office_ok", "weekend_off",
        "expected_salary", "salary_ok", "call_event", "callback_when", "pincode_later",
    ]
    return {
        "type": "function",
        "function": {
            "name": "save_screen",
            "description": (
                "Save a fact the caller just said. Call this before you speak again. "
                "The result is the only question you ask next. "
                "Send english from how they speak. Do not ask gender. "
                "call_event is voicemail, disconnected, not_interested, busy, or other_recruiter."
            ),
            "parameters": {
                "type": "object",
                "properties": {key: {"type": "string"} for key in keys},
            },
        },
    }


_PIN_WORDS = {
    "zero": "0", "oh": "0", "o": "0",
    "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9",
}


def _spoken_pin(raw: object) -> str:
    low = str(raw or "").lower().replace(",", " ")

    def multi(match: re.Match) -> str:
        times = 3 if match.group(1) == "triple" else 2
        digit = _PIN_WORDS.get(match.group(2), "")
        return f" {digit * times} "

    low = re.sub(
        r"\b(double|triple)\s+(zero|oh|o|one|two|three|four|five|six|seven|eight|nine)\b",
        multi,
        low,
    )
    for word, digit in _PIN_WORDS.items():
        low = re.sub(rf"\b{word}\b", f" {digit} ", low)
    return re.sub(r"\D", "", low)


def _take_pin(screen: dict, raw: object) -> None:
    text = " ".join(str(raw or "").split())
    if re.search(r"\b(later|don't know|dont know|do not know|not now|skip)\b", text.lower()):
        screen["pincode_later"] = "yes"
        return
    digits = _spoken_pin(text)
    if not digits:
        return
    if len(digits) >= 6 and re.fullmatch(r"[1-8]\d{5}", digits[:6]):
        screen["pincode"] = digits[:6]
        screen["pincode_partial"] = ""
        screen["pincode_later"] = ""
        return
    have = re.sub(r"\D", "", str(screen.get("pincode_partial") or ""))
    combined = (have + digits)[:6]
    if len(combined) == 6 and re.fullmatch(r"[1-8]\d{5}", combined):
        screen["pincode"] = combined
        screen["pincode_partial"] = ""
        screen["pincode_later"] = ""
        return
    screen["pincode_partial"] = combined


def _digits(phone: str) -> str:
    return "".join(ch for ch in phone if ch.isdigit())[-10:]
