"""The screening has to be asked on this call before a job match."""
from __future__ import annotations

# Each topic is something she must say herself. Memory is not enough.
TOPICS = (
    (
        ("what kind of job", "voice process", "non-voice", "non voice", "domestic voice", "international voice"),
        "Ask what kind of job they are looking for.",
    ),
    (
        ("pincode", "pin code"),
        "Ask their 6-digit pincode, then read the digits back.",
    ),
    (
        ("okay to continue", "continue with me"),
        "Ask whether it is okay to continue with you.",
    ),
    (
        ("international voice", "domestic voice", "non-voice", "non voice"),
        "Ask whether they want international voice, domestic voice, or non-voice.",
    ),
    (
        ("fresher", "experienced", "how many years", "bpo experience"),
        "Ask whether they are a fresher or experienced.",
    ),
    (
        ("year of birth", "born", "which year were you born", "10th", "12th"),
        "Ask their year of birth, then the education years.",
    ),
    (
        ("which shift", "what shift", "us shift", "uk shift", "day shift", "night shift"),
        "Ask which shift they want.",
    ),
    (
        ("travel", "come to the site", "relocate"),
        "Ask whether they can travel to the site.",
    ),
    (
        ("salary", "how much", "ctc", "take-home", "take home"),
        "Ask the salary they expect.",
    ),
    (
        ("notice", "how soon can you join", "currently working"),
        "Ask their notice period.",
    ),
    (
        ("which companies", "already attended", "interviewed"),
        "Ask which companies they have already attended.",
    ),
)


def screen_gap(turns: list[dict]) -> str | None:
    """The next question she still has to ask. None when the screen is done."""
    said = " ".join(
        str(turn.get("text") or "")
        for turn in turns
        if turn.get("who") != "Caller"
    ).lower()
    for needles, ask in TOPICS:
        if not any(needle in said for needle in needles):
            return ask + " Do not match jobs yet."
    return None
