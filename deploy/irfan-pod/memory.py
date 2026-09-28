"""Caller memory for Irfan. One file per phone number on this machine.

SnapServe keeps facts and past calls in its database and reads them back on
the next call. This file does the same job locally. Nothing is sent to SnapServe.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

FACT_KEYS = (
    "name",
    "location",
    "pincode",
    "role",
    "experience",
    "qualification",
    "shift",
    "expected_salary",
    "email",
)
KEEP_CALLS = 8


def memory_dir() -> Path:
    raw = os.environ.get("IRFAN_MEMORY_DIR", "").strip()
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parent / "memory"


def empty_record(phone: str) -> dict:
    return {"phone": phone, "call_count": 0, "facts": {}, "summary": "", "calls": []}


def load_memory(phone: str, root: Path | None = None) -> dict:
    path = _path(phone, root)
    if not path.is_file():
        return empty_record(phone)
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return empty_record(phone)
    if not isinstance(data, dict):
        return empty_record(phone)
    data["phone"] = phone
    data["call_count"] = int(data.get("call_count") or 0)
    facts = data.get("facts") if isinstance(data.get("facts"), dict) else {}
    data["facts"] = {key: str(facts[key]) for key in FACT_KEYS if str(facts.get(key) or "").strip()}
    data["summary"] = str(data.get("summary") or "").strip()
    calls = data.get("calls") if isinstance(data.get("calls"), list) else []
    data["calls"] = calls[-KEEP_CALLS:]
    data["screen"] = data.get("screen") if isinstance(data.get("screen"), dict) else {}
    return data


def save_memory(record: dict, root: Path | None = None) -> None:
    phone = str(record.get("phone") or "")
    if not phone:
        return
    path = _path(phone, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(record, ensure_ascii=False, indent=2))
    os.replace(tmp, path)


def memory_block(record: dict) -> str:
    facts = record.get("facts") or {}
    summary = str(record.get("summary") or "").strip()
    call_count = int(record.get("call_count") or 0)
    if call_count <= 0 and not facts and not summary:
        return ""
    lines = ["=== CALLER MEMORY ==="]
    header = []
    if facts.get("name"):
        header.append(f"Name: {facts['name']}")
    if call_count > 0:
        header.append(f"Calls: {call_count}")
    if header:
        lines.append("  |  ".join(header))
    lines.append(
        "[LIVE CORRECTION WINS] If the caller says anything in THIS call that contradicts a fact "
        "here, the caller is right. Use the new value. Do not argue with the stored one."
    )
    if summary:
        lines.append("")
        lines.append(f"Previous call summary: {summary}")
        lines.append(
            "HOW TO USE THIS SUMMARY: This can be wrong. Do not say a stored fact as if they just said it. "
            "Walk the call in order and ask the next topic. "
            "Keep what they say on this call. Do not jump to openings."
        )
    known = [(key, facts[key]) for key in FACT_KEYS if facts.get(key)]
    if known:
        lines.append("")
        lines.append("KNOWN DETAILS (confirm in one line, do not re-ask once they agree):")
        for key, value in known:
            lines.append(f"- {key}: {value}")
    return "\n".join(lines)


def parse_extract(text: str) -> dict:
    raw = text.strip()
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end < start:
        return {}
    try:
        data = json.loads(raw[start : end + 1])
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def apply_extract(record: dict, extract: dict, turns: list[dict]) -> dict:
    facts = dict(record.get("facts") or {})
    incoming = extract.get("facts") if isinstance(extract.get("facts"), dict) else extract
    for key in FACT_KEYS:
        value = _clean(incoming.get(key) if isinstance(incoming, dict) else "")
        if value:
            facts[key] = value
    summary = _clean(extract.get("summary") if isinstance(extract, dict) else "", 400)
    if not summary:
        summary = _fallback_summary(turns)
    calls = list(record.get("calls") or [])
    calls.append({
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "summary": summary,
        "transcript": [
            {"who": str(turn.get("who") or ""), "text": str(turn.get("text") or "")}
            for turn in turns
            if str(turn.get("text") or "").strip()
        ],
    })
    return {
        "phone": record.get("phone") or "",
        "call_count": int(record.get("call_count") or 0) + 1,
        "facts": facts,
        "summary": summary,
        "calls": calls[-KEEP_CALLS:],
    }


def _fallback_summary(turns: list[dict]) -> str:
    callers = [str(turn.get("text") or "").strip() for turn in turns if turn.get("who") == "Caller"]
    callers = [line for line in callers if line]
    if not callers:
        return "The call connected."
    return callers[-1][:240]


def _clean(value: object, limit: int = 80) -> str:
    text = " ".join(str(value or "").split())
    if not text or text.lower() in {"unknown", "n/a", "none", "null"}:
        return ""
    return text[:limit]


def _path(phone: str, root: Path | None) -> Path:
    digits = "".join(ch for ch in phone if ch.isdigit())
    return (root or memory_dir()) / f"{digits}.json"
