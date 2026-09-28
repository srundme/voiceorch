"""Job match for Irfan's own call loop.

Same rules as artifacts/api-server/src/lib/jobshop-match.ts.
The spoken pitch may use only the jobs this returns.
"""
from __future__ import annotations

import json
import math
import re
from datetime import date
from pathlib import Path

JOBS_PATH = Path(__file__).with_name("jobs.json")
PITCH_FLOOR = 60
ENGLISH_FLOOR = {"EXCELLENT": 5, "VERY_GOOD": 4, "GOOD": 3, "AVERAGE": 2, "POOR": 1}


def empty_profile() -> dict:
    return {"skills": []}


def _num(value) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    if isinstance(value, str) and value.strip() and _is_number(value):
        return float(value)
    return None


def _is_number(value: str) -> bool:
    try:
        return math.isfinite(float(value))
    except ValueError:
        return False


def _text(value) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None


def _skills(value) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    raw = _text(value)
    if not raw:
        return []
    return [part.strip() for part in re.split(r"[,/]| and ", raw, flags=re.I) if part.strip()]


def merge_profile(prev: dict, patch: dict) -> dict:
    next_profile = {**prev, "skills": list(prev.get("skills") or [])}
    mapping = {
        "first_name": "firstName",
        "city": "city",
        "qualification": "qualification",
        "skill_role": "skillRole",
        "shift": "shift",
        "english": "english",
        "gender": "gender",
    }
    for src, dest in mapping.items():
        got = _text(patch.get(src))
        if got:
            next_profile[dest] = got
    skills = _skills(patch.get("skills"))
    if skills:
        next_profile["skills"] = skills
    numbers = {
        "birth_year": "birthYear",
        "tenth_year": "tenthYear",
        "twelfth_year": "twelfthYear",
        "diploma_year": "diplomaYear",
        "degree_year": "degreeYear",
        "pg_year": "pgYear",
        "experience_years": "experienceYears",
        "expected_monthly_salary": "expectedMonthlySalary",
    }
    for src, dest in numbers.items():
        got = _num(patch.get(src))
        if got is not None:
            next_profile[dest] = got
    return next_profile


def _missing(profile: dict) -> list[str]:
    missing = []
    if not profile.get("city"):
        missing.append("city")
    if not profile.get("qualification"):
        missing.append("qualification")
    if profile.get("experienceYears") is None:
        missing.append("experience_years")
    if not profile.get("skills"):
        missing.append("skills")
    if not profile.get("shift"):
        missing.append("shift")
    if profile.get("expectedMonthlySalary") is None:
        missing.append("expected_monthly_salary")
    return missing


def _norm_city(value: str) -> str:
    compact = re.sub(r"[^a-z]", "", value.lower())
    if compact in ("bangalore", "bengaluru"):
        return "bengaluru"
    return compact


def _edu_level(value: str | None) -> int:
    q = (value or "").lower()
    if "post" in q or "pg" in q:
        return 4
    if any(token in q for token in ("graduat", "degree", "ug", "b.tech", "btech")):
        return 3
    if "12" in q or "diploma" in q:
        return 2
    if "10" in q:
        return 1
    return 1


def _english_rank(value: str | None) -> int | None:
    text = (value or "").lower()
    if not text:
        return None
    if "excellent" in text:
        return 5
    if "very" in text:
        return 4
    if "good" in text:
        return 3
    if "average" in text:
        return 2
    if "poor" in text:
        return 1
    return None


def _wants_voice(skills: list[str]) -> str:
    blob = " ".join(skills).lower()
    if re.search(r"non[ -]?voice", blob):
        return "non-voice"
    if "domestic" in blob:
        return "domestic"
    if re.search(r"international|voice|bpo|customer|call", blob):
        return "international"
    return "none"


def _shift_fits(candidate_shift: str, job: dict) -> bool:
    shift = candidate_shift.lower()
    base = job["shiftBase"]
    if not shift or "any" in shift or "rotat" in shift:
        return True
    if base in ("ANY", "ROTATIONAL"):
        return True
    if base == "US":
        return "us" in shift or "night" in shift
    if base == "UK":
        return "uk" in shift or ("day" in shift and "night" not in shift)
    if base == "DAY_ONLY":
        return "day" in shift or "uk" in shift
    if base == "NIGHT_ONLY":
        return "night" in shift or "us" in shift
    if base == "DOMESTIC":
        return "domestic" in shift or "day" in shift
    if base == "AUS":
        return "aus" in shift or "australia" in shift
    return True


def _passes(profile: dict, job: dict) -> bool:
    city = _norm_city(profile["city"]) if profile.get("city") else ""
    if city and city != "bengaluru":
        return False
    if job["workStatus"] == "EXPERIENCED" and (profile.get("experienceYears") or 0) < 0.5:
        return False
    if profile.get("shift") and not _shift_fits(profile["shift"], job):
        return False
    spoken = _english_rank(profile.get("english"))
    if spoken is not None and spoken < ENGLISH_FLOOR[job["minEnglish"]]:
        return False
    if profile.get("birthYear") is not None:
        age = date.today().year - int(profile["birthYear"])
        if age < job["minAge"] or age > job["maxAge"]:
            return False
    if _edu_level(profile.get("qualification")) < 3:
        return False
    voice = _wants_voice(profile.get("skills") or [])
    if voice in ("non-voice", "none"):
        return False
    return True


def _score(profile: dict, job: dict) -> float:
    voice = _wants_voice(profile.get("skills") or [])
    skills_score = 100 if voice == "international" else 75 if voice == "domestic" else 30
    years = profile.get("experienceYears") or 0
    if job["workStatus"] == "FRESHER":
        exp_score = 100 if years <= 1 else 80
    elif job["workStatus"] == "EXPERIENCED":
        exp_score = 100 if years >= 0.5 else 30
    else:
        exp_score = 100
    resp_score = 90 if voice == "international" else 70
    edu_score = 100 if _edu_level(profile.get("qualification")) >= 3 else 40
    loc_score = 100 if profile.get("city") and _norm_city(profile["city"]) == "bengaluru" else 40
    shift_score = 100 if profile.get("shift") and _shift_fits(profile["shift"], job) else 50
    spoken = _english_rank(profile.get("english"))
    needed = ENGLISH_FLOOR[job["minEnglish"]]
    if spoken is None or spoken >= needed:
        comm_score = 100
    elif spoken == needed - 1:
        comm_score = 70
    else:
        comm_score = 40
    expected = profile.get("expectedMonthlySalary")
    salary_score = 90
    if expected:
        if expected <= job["salaryMax"]:
            salary_score = 100
        elif expected <= job["salaryMax"] * 1.3:
            salary_score = 60
        else:
            salary_score = 35
    overall = (
        skills_score * 35
        + exp_score * 25
        + resp_score * 15
        + edu_score * 10
        + loc_score * 5
        + shift_score * 5
        + comm_score * 2.5
        + salary_score * 2.5
    ) / 100
    return math.floor(overall * 10 + 0.5) / 10


def _gap(later: float, earlier: float, allowed: int, label: str) -> str | None:
    gap = int(later - earlier - allowed)
    if gap > 0:
        unit = "year" if gap == 1 else "years"
        return f"{label}: {gap} {unit} longer than the normal {allowed}."
    return None


def education_gap_notes(profile: dict) -> list[str]:
    notes = []
    birth = profile.get("birthYear")
    tenth = profile.get("tenthYear")
    twelfth = profile.get("twelfthYear")
    diploma = profile.get("diplomaYear")
    degree = profile.get("degreeYear")
    pg = profile.get("pgYear")
    if tenth and twelfth:
        note = _gap(twelfth, tenth, 2, "12th after 10th")
        if note:
            notes.append(note)
    if diploma and twelfth:
        note = _gap(diploma, twelfth, 2, "Diploma after 12th")
        if note:
            notes.append(note)
    elif diploma and tenth:
        note = _gap(diploma, tenth, 3, "Diploma after 10th")
        if note:
            notes.append(note)
    if degree and twelfth:
        note = _gap(degree, twelfth, 3, "Degree after 12th")
        if note:
            notes.append(note)
    if pg and degree:
        note = _gap(pg, degree, 2, "Postgraduate after the degree")
        if note:
            notes.append(note)
    if birth and tenth and tenth - birth > 17:
        notes.append(f"10th at age {int(tenth - birth)}. Normal is 15, 16, or 17.")
    if birth and twelfth and twelfth - birth > 19:
        notes.append(f"12th at age {int(twelfth - birth)}. Normal is 17, 18, or 19.")
    if birth and degree and degree - birth > 22:
        notes.append(f"Degree at age {int(degree - birth)}. Normal is 20, 21, or 22.")
    return notes


def _rupees(amount: float) -> str:
    return "₹" + f"{int(amount):,}"


def _pitch_line(match: dict, index: int) -> str:
    return (
        f"{index}. {match['title']} at {match['company']}, {match['area']} ({match['jobId']}), "
        f"match {match['score']}. {match['city']}, {match['workMode']}, {match['shift']}, "
        f"{_rupees(match['salaryMin'])} to {_rupees(match['salaryMax'])} a month, {match['qualification']}."
    )


def load_jobs(path: Path = JOBS_PATH) -> list[dict]:
    return json.loads(path.read_text())


def match_profile(prev: dict, patch: dict, jobs: list[dict] | None = None) -> dict:
    profile = merge_profile(prev, patch)
    gaps = education_gap_notes(profile)
    gap_line = (
        "GAPS: " + " ".join(gaps) + " Ask what they did in the gap if you have not already."
        if gaps
        else "GAPS: none."
    )
    missing = _missing(profile)
    if missing:
        return {
            "profile": profile,
            "matches": [],
            "speech": f"PROFILE_SAVED. Still needed before a match: {', '.join(missing)}. Ask the next one only. Do not name a job. {gap_line}",
        }
    catalog = jobs if jobs is not None else load_jobs()
    matches = []
    for job in catalog:
        if not _passes(profile, job):
            continue
        score = _score(profile, job)
        if score < PITCH_FLOOR:
            continue
        matches.append({
            "jobId": job["jobId"],
            "title": job["title"],
            "company": job["company"],
            "area": job["area"],
            "score": score,
            "salaryMin": job["salaryMin"],
            "salaryMax": job["salaryMax"],
            "city": job["city"],
            "workMode": job["workMode"],
            "shift": job["shiftLabel"],
            "qualification": job["qualification"],
        })
    matches.sort(key=lambda row: (row["score"], row["salaryMax"]), reverse=True)
    matches = matches[:3]
    if not matches:
        return {
            "profile": profile,
            "matches": [],
            "speech": "PROFILE_SAVED. NO_OPENING. Tell them you do not have an opening that fits, and the team will call if one comes. Do not name a company or a salary. " + gap_line,
        }
    lines = [_pitch_line(match, index + 1) for index, match in enumerate(matches)]
    return {
        "profile": profile,
        "matches": matches,
        "speech": "PROFILE_SAVED. Speak only these jobs, strongest first, in your own short sentences. Do not add a company, a city, or a salary that is not written here.\n"
        + "\n".join(lines)
        + "\n"
        + gap_line,
    }
