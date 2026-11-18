"""The JSON the story model must return before a prompt is written.

The shape matches the skill and the scripts that already render:
Chapeuzinho (one session, one action, per-take sound, offscreen voice)
and Strange Footages (one clip, capture mode, physical volume, no speech).
"""

from __future__ import annotations

import re
from typing import Any

_ACCENT = re.compile(r"[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]")
_PT_WORD = re.compile(
    r"\b(não|está|estão|você|vocês|menina|também|depois|então|senhora|vovó)\b",
    re.I,
)
_EN_DIALOGUE = re.compile(r"\b(the|you|who|what|where|please|hello|come|walks|says)\b", re.I)
_ANCHOR = re.compile(r"\b(LEFT|CENTER|RIGHT)\b")
_EVENT_SOUND = re.compile(r"knock|footstep|footfall|hinge|latch|creak|\btap\b", re.I)
_OFFSCREEN = re.compile(r"offscreen|off-screen|inside|unseen|beyond|behind", re.I)
_UNSEEN = re.compile(r"not visible|unseen|offscreen|off-screen|beyond|inside|no other", re.I)
_CAPTURE = (
    ("phone", "handheld"),
    ("trail",),
    ("cctv", "doorbell", "fixed"),
)

_STORY_FIELDS = (
    "kind",
    "session",
    "duration",
    "spatial",
    "camera",
    "entry_state",
    "action",
    "exit_state",
    "visible",
    "speaker",
    "dialogue",
    "sound",
)
_ENGLISH_FIELDS = (
    "spatial",
    "camera",
    "entry_state",
    "action",
    "exit_state",
    "visible",
    "sound",
)


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _takes(data: dict[str, Any]) -> list[dict[str, Any]]:
    raw = data.get("takes")
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def _english_leak(text: str) -> bool:
    return bool(_ACCENT.search(text) or _PT_WORD.search(text))


def _tokens(text: str) -> set[str]:
    return {word for word in re.findall(r"[a-z0-9]+", text.lower()) if len(word) > 3}


def _same_place(a: str, b: str) -> bool:
    left, right = _tokens(a), _tokens(b)
    if not left or not right:
        return False
    return len(left & right) / len(left | right) >= 0.55


def _capture_ok(value: str) -> bool:
    low = value.lower()
    return any(any(part in low for part in group) for group in _CAPTURE)


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        match = re.search(r"\d+(?:\.\d+)?", str(value))
        return float(match.group(0)) if match else None


def contract_errors(
    data: Any,
    *,
    category: str,
    max_duration_sec: float,
    take_count: int | None = None,
    allow_multi_footage: bool = False,
) -> list[str]:
    """English notes sent back to the model when its JSON misses the contract."""
    if not isinstance(data, dict):
        return ["Response JSON must be an object with title, synopsis, roteiro_md and takes."]

    errors: list[str] = []
    if not _text(data.get("title")):
        errors.append("title is missing.")
    if not _text(data.get("synopsis")):
        errors.append("synopsis is missing.")
    roteiro = _text(data.get("roteiro_md"))
    if len(roteiro) < 40 or not re.search(r"take", roteiro, re.I):
        errors.append(
            "roteiro_md must be the Portuguese human script, with one Take section per beat, "
            "the action, Sem fala or the spoken line, and Som exclusivo deste take."
        )

    takes = _takes(data)
    if not isinstance(data.get("takes"), list) or not takes:
        errors.append("takes must be a non-empty array of objects.")
        return errors

    footage = category == "footage"
    if footage and not allow_multi_footage and len(takes) != 1:
        errors.append("footage is exactly one take. Do not return a second shot.")
    if take_count and len(takes) != int(take_count):
        errors.append(f"takes must contain exactly {int(take_count)} items.")

    seen_new: set[str] = set()
    total = 0.0
    sounds: list[str] = []
    groups: list[tuple[str, str, int]] = []

    for index, take in enumerate(takes, start=1):
        label = f"take {index}"
        missing = [
            name for name in _STORY_FIELDS
            if name not in take or (_text(take.get(name)) == "" and name not in {"dialogue", "speaker"})
        ]
        if footage and not _text(take.get("capture_mode")):
            missing.append("capture_mode")
        if missing:
            errors.append(
                f"{label}: missing {', '.join(missing)}. "
                "Do not return a finished prompt. Fill the contract fields."
            )
            continue

        kind = _text(take.get("kind")).lower()
        session = _text(take.get("session"))
        if kind not in {"new", "continue"}:
            errors.append(f"{label}: kind must be \"new\" or \"continue\".")
        if not session:
            errors.append(f"{label}: session is missing.")
        if index == 1 and kind != "new":
            errors.append("the first take must be kind \"new\".")
        if kind == "new":
            if session in seen_new:
                errors.append(
                    f"{label}: a second NEW reuses session {session}. A hard cut needs a new session name."
                )
            seen_new.add(session)
        elif session not in seen_new:
            errors.append(f"{label}: CONTINUE session {session} has no earlier NEW.")

        duration = _number(take.get("duration"))
        if duration is None:
            errors.append(f"{label}: duration must be a number of seconds.")
            duration = 0
        elif footage and not 8 <= duration <= 10:
            errors.append(f"{label}: footage duration must be 8, 9, or 10 seconds.")
        elif not footage and not 2 <= duration <= 15:
            errors.append(f"{label}: duration must be from 2 to 15 seconds.")
        total += duration

        for name in _ENGLISH_FIELDS:
            value = _text(take.get(name))
            if _english_leak(value):
                errors.append(
                    f"{label}: {name} must be English. Portuguese belongs only in dialogue."
                )
            if name == "action" and ("<d>" in value.lower() or "continuity lock" in value.lower()):
                errors.append(
                    f"{label}: action is one English beat. Do not paste a prompt, a lock, or a spoken line into it."
                )
        if not _ANCHOR.search(_text(take.get("spatial"))):
            errors.append(f"{label}: spatial must name LEFT, CENTER, or RIGHT and stay fixed for the session.")

        speaker = _text(take.get("speaker")) or "none"
        dialogue = _text(take.get("dialogue"))
        if footage and dialogue and dialogue.lower() not in {"none", "no", "mute"}:
            errors.append(f"{label}: footage dialogue stays empty. No voice and no narration.")
        elif dialogue and dialogue.lower() not in {"none", "no", "mute", ""}:
            if speaker.lower() in {"", "none", "mute"}:
                errors.append(f"{label}: dialogue is set but speaker is none.")
            if _EN_DIALOGUE.search(dialogue) and not _english_leak(dialogue):
                errors.append(f"{label}: dialogue must be Brazilian Portuguese, the spoken words only.")
        elif speaker.lower() not in {"", "none", "mute", "no"}:
            errors.append(f"{label}: speaker is set but dialogue is empty.")

        if _OFFSCREEN.search(speaker):
            blob = f"{_text(take.get('visible'))} {_text(take.get('action'))}"
            if not _UNSEEN.search(blob):
                errors.append(
                    f"{label}: the speaker is offscreen, so visible must say that person is not on screen."
                )

        if footage and not _capture_ok(_text(take.get("capture_mode"))):
            errors.append(
                f"{label}: capture_mode must be exactly \"fixed CCTV\", \"trail camera\", or \"handheld phone\"."
            )
        sounds.append(_text(take.get("sound")))

        if not groups or groups[-1][0] != session or kind == "new":
            groups.append((session, _text(take.get("spatial")), 1))
        else:
            name, spatial, count = groups[-1]
            groups[-1] = (name, spatial, count + 1)

    if total > float(max_duration_sec) + 0.5:
        errors.append(
            f"total duration {total:.0f}s exceeds max_duration_sec {float(max_duration_sec):.0f}. "
            "Shorten beats. Do not drop the scene's last action."
        )

    repeated: list[str] = []
    counts: dict[str, int] = {}
    for sound in sounds:
        if sound:
            counts[sound] = counts.get(sound, 0) + 1
    for sound, count in counts.items():
        hits = {item.lower() for item in _EVENT_SOUND.findall(sound)}
        if count >= 2 and len(hits) >= 2:
            repeated.append(sound)
    if repeated:
        errors.append(
            "the same knock, footstep, or hinge list is copied onto more than one take. "
            "Each take lists only the sound that happens in that take."
        )

    if not footage and len(groups) >= 2:
        short = [group for group in groups if group[2] in {3, 4}]
        if len(short) >= 2 and _same_place(short[0][1], short[1][1]):
            errors.append(
                "do not start a new session every 3 or 4 takes when the place and camera stay the same. "
                "Keep that conversation in one session."
            )
    return errors
