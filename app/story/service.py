from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from .. import db
from ..cost import estimate_generation
from ..llm.prompts import DICE_SYSTEM, FOOTAGE_STORY_RULES, STORY_SYSTEM
from ..llm.providers import RateLimited, get_provider
from .contract import contract_errors

_EVENT_SOUND = re.compile(r"knock|footstep|footfall|hinge|latch|creak|\btap\b", re.I)
_LEADING_CLOCK = re.compile(
    r"^\s*(?:\[\s*)?\d{2}:\d{2}(?:\.\d+)?\s*[–—-]\s*\d{2}:\d{2}(?:\.\d+)?\s*\]?\s*"
)
_DIALOGUE_TAG = re.compile(r"<d>\s*\[Portuguese\]\s*(.*?)\s*</d>", re.I | re.S)

_ANTI_SHEET = (
    "No character sheet, no studio backdrop, no white/gray void, no cutout collage, "
    "no cut, no zoom, no reverse angle."
)
_FOOTAGE_MATERIAL = (
    "PHYSICAL MATERIAL LOCK: A body is a photographed solid volume, never a pure-black optical shadow. "
    "In infrared BOTH skin or fur and surroundings reflect light in ordinary grayscale; visible body surfaces "
    "retain middle-gray gradients, modest surface texture and joint volume. Preserve the defined abnormal "
    "proportions from the first moment, without growing or melting anatomy. Exactly the limbs specified, "
    "no extra joints or independent floating parts. Occlusion by existing bars, foliage or architecture is physical. "
    "No theatrical rim light, spotlight, sharp monster outline or artificially crisp creature against a blurry setting."
)
_FOOTAGE_NEGATIVES = (
    "NEGATIVES: No drawing, cartoon, flat silhouette graphic, opaque ink-black body, vector contour, paper cutout, "
    "sticker, clean compositing boundary, rubber limbs, glossy CGI, mascot costume, sharp monster portrait, huge eyes, "
    "glowing eyes, exposed teeth, blood, wounds, exposed bones, victim or lens jump scare. No second anomaly, added creature, "
    "architecture changing, new actor, teleport, magical particles, portal, bright beam, theatrical strobe, crisp science-fiction hull, "
    "enormous mothership or explosive reveal. Shadows are reduced illumination on actual surfaces, never independently animated black characters. "
    "No timestamp, date, clock, watermark, logo, readable sign, captions, phone UI or overlay. No dialogue, narration or music."
)


def _prefix_slug(slug: str) -> str:
    safe = re.sub(r"[^\w\-]+", "_", slug or "").strip("_")
    return safe or "story"


def _field(take: dict[str, Any], *names: str) -> str:
    for name in names:
        value = take.get(name)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _duration(value: Any, default: float) -> float:
    if isinstance(value, (int, float)):
        parsed = float(value)
    else:
        match = re.search(r"\d+(?:\.\d+)?", str(value or ""))
        parsed = float(match.group(0)) if match else default
    return max(2.0, min(15.0, parsed))


def _local_range(duration: float) -> str:
    total_ms = int(round(float(duration) * 1000))
    seconds, millis = divmod(total_ms, 1000)
    return f"00:00.000–00:{seconds:02d}.{millis:03d}"


def _frame_phrase(width: int, height: int) -> str:
    if height > width * 1.15:
        shape = "vertical"
    elif width > height * 1.15:
        shape = "horizontal"
    elif abs(width - height) <= 8:
        shape = "square"
    else:
        shape = "portrait"
    return f"{shape} {int(width)}x{int(height)}"


def _legacy_action(prompt: str, style_lock: str) -> str:
    text = (prompt or "").strip()
    if style_lock:
        text = text.replace(style_lock, " ")
    text = _LEADING_CLOCK.sub("", text)
    kept: list[str] = []
    for line in text.splitlines():
        cleaned = re.sub(r"(?i)^\s*continuity lock:\s*", "", line).strip()
        low = cleaned.lower()
        if not cleaned or low.startswith((
            "visual style lock", "spatial:", "camera:",
            "overall_soundscape", "non_diegetic", "integrated_multimodal",
            "capture mode", "physical material",
        )):
            continue
        kept.append(cleaned)
    return " ".join(kept)[:1200]


def _unique_event_sounds(sounds: list[str]) -> list[str]:
    """A repeated block of knocks, steps and hinges leaks those actions into silent takes."""
    counts: dict[str, int] = {}
    for sound in sounds:
        key = sound.strip()
        if key:
            counts[key] = counts.get(key, 0) + 1
    out: list[str] = []
    seen: set[str] = set()
    for sound in sounds:
        key = sound.strip()
        hits = _EVENT_SOUND.findall(key)
        if key and counts.get(key, 0) >= 2 and len(set(h.lower() for h in hits)) >= 2:
            if key in seen:
                out.append("Quiet ambience only. No speech, no impacts, no footsteps, no music.")
                continue
            seen.add(key)
        out.append(key)
    return out


def _style_block(style_lock: str, craft: str) -> str:
    parts = [part.strip() for part in (style_lock, craft) if part and part.strip()]
    return "\n\n".join(parts)


def _spoken_line(raw: str) -> str:
    text = (raw or "").strip()
    if not text or text.lower() in {"none", "no", "mute", "no dialogue", "no speech"}:
        return ""
    match = _DIALOGUE_TAG.search(text)
    line = match.group(1).strip() if match else text
    line = re.sub(r"</?d>", "", line, flags=re.I)
    line = re.sub(r"\[Portuguese\]", "", line, flags=re.I).strip()
    return line


def _beat_sentence(action: str, entry: str, exit_state: str) -> str:
    text = action.strip()
    if entry and entry.lower() not in text.lower():
        text = f"{entry.rstrip('.')}. {text}"
    if exit_state and exit_state.lower() not in text.lower():
        text = f"{text.rstrip('.')}. {exit_state.rstrip('.')}."
    return text


def _capture_line(mode: str, camera: str) -> str:
    low = (mode or "").lower()
    if "phone" in low or "handheld" in low:
        label = "handheld phone"
        detail = (
            "A person holds the phone: small irregular wrist tremor, breathing sway, tiny roll, "
            "and imperfect delayed reframing. Sky, roofs and foliage move with the hand. "
            "No gimbal, no tripod, no cinematic zoom."
        )
    elif "trail" in low:
        label = "trail camera"
        detail = (
            "Fixed on the path, stream or clearing, with real ground and vegetation in frame. "
            "No pan, no zoom, no subject tracking."
        )
    else:
        label = "fixed CCTV"
        detail = (
            "Inexpensive fixed installed doorbell or CCTV camera with mild wide-angle distortion, "
            "watching a real entrance, walkway, gate and ground. Same viewpoint and exposure throughout; "
            "no zoom, pan, tilt, following or cinematic grading. No visible UI."
        )
    extra = camera.strip()
    if extra and extra.lower() not in detail.lower():
        detail = f"{detail} {extra}"
    return f"CAPTURE MODE: {label}. {detail}"


def _native_frame(width: int, height: int) -> str:
    if height > width * 1.15:
        ratio = "vertical 9:16"
    elif width > height * 1.15:
        ratio = "horizontal 16:9"
    elif abs(width - height) <= 8:
        ratio = "square 1:1"
    else:
        ratio = "portrait 4:5"
    return f"native {ratio} at {int(width)}x{int(height)}"


def _assemble_prompt(
    *,
    kind: str,
    category: str,
    duration: float,
    width: int,
    height: int,
    model_pack: str,
    style_block: str,
    spatial: str,
    camera: str,
    entry: str,
    action: str,
    exit_state: str,
    visible: str,
    speaker: str,
    dialogue: str,
    sound: str,
    capture_mode: str,
) -> str:
    """Write the prompt in the shape of the scripts that already render."""
    clock = _local_range(duration)
    offscreen = bool(re.search(r"offscreen|off-screen|inside|unseen|beyond", speaker, re.I))
    if offscreen and "not visible" not in visible.lower():
        visible = f"{visible.rstrip('.')}. The speaker is not visible."
    if not sound:
        sound = (
            "Quiet location ambience only. No voice, no music."
            if category == "footage"
            else "Quiet location ambience only. No music."
        )

    if category == "footage":
        action = _DIALOGUE_TAG.sub("", action).strip() or "One physical strange event stays readable."
        lines = [
            "CONTINUITY LOCK: One uninterrupted fictional SFW observed incident, "
            f"{_native_frame(width, height)}. One subject, one specific strange action; "
            "ordinary modest Brazilian location. Keep identity, established unusual proportions, "
            "material surfaces, scene geometry, weather and illumination stable throughout. "
            "Where a creature or person is visible it has physical rounded thickness, coherent joints, "
            "intact skin or cloth texture, grounded weight and soft contact shadows. "
            "Low-cost optics, limited fine detail, restrained compression blocks, sensor noise and movement "
            "softness affect subject and environment equally. The event is readable for at least three seconds "
            "at normal playback, without a posed close-up. No studio, sheet, character bible or collage.",
            style_block,
            _capture_line(capture_mode, camera),
            _FOOTAGE_MATERIAL,
            f"SPATIAL / SUBJECT / LIGHT: {spatial}",
            "integrated_multimodal_description:",
            f"[Shot 1] {clock} ONE subject action: {_beat_sentence(action, entry, exit_state)}",
            f"overall_soundscape: {sound} No voice, no narration, no music, no sting.",
            "non_diegetic_music: N/A",
            _FOOTAGE_NEGATIVES,
        ]
        return "\n\n".join(line for line in lines if line).strip()

    look = " ".join(part for part in (style_block, visible) if part).strip()
    if kind == "continue":
        lock = (
            "CONTINUITY LOCK: Continue the latest ready checkpoint; no image reinjection or resetting the scene. "
            f"{look}. {_ANTI_SHEET}"
        )
    else:
        lock = f"CONTINUITY LOCK: {look}. {_ANTI_SHEET}"
    if model_pack == "nsfw":
        lock += (
            " Anatomy lock: clear male penis and female vagina as the scene requires. "
            "No swapped, fused, or missing genitals."
        )
    spoken = _spoken_line(dialogue)
    if spoken:
        sound_line = (
            f"Sound: {sound.rstrip('. ')}: <d>[Portuguese] {spoken}</d>. "
            "Say it once, then quiet. No narrator, score, extra words or overlapping voices."
        )
    else:
        sound_line = (
            f"Sound: {sound.rstrip('. ')}. No speech. "
            "No narrator, score, extra words or overlapping voices."
        )
    if offscreen:
        sound_line += " The speaker is not visible."
    lines = [
        lock,
        f"Spatial: {spatial} {camera}. {_frame_phrase(width, height)}.",
        f"{clock} ONE action: {_beat_sentence(action, entry, exit_state)}",
        sound_line,
        "No text or captions.",
    ]
    return "\n\n".join(line for line in lines if line).strip()


def conform_takes(
    takes: list[dict[str, Any]],
    *,
    slug: str,
    seed_base: int,
    style_lock: str = "",
    craft: str = "",
    width: int = 576,
    height: int = 1024,
    model_pack: str = "sfw",
    category: str = "general",
    keep_all: bool = False,
) -> list[dict[str, Any]]:
    """Turn model fields into Continuity takes. One seed per session, local timestamps, per-take sound."""
    raw = [take for take in takes if isinstance(take, dict)]
    if category == "footage" and raw and not keep_all:
        raw = [raw[0]]

    fixed: list[dict[str, Any]] = []
    seen_new: set[str] = set()
    for take in raw:
        kind = str(take.get("kind") or "new").lower()
        if kind not in {"new", "continue"}:
            kind = "new"
        session = str(take.get("session") or "scene_v1").strip() or "scene_v1"
        if kind == "new" and session in seen_new:
            cut = 2
            renamed = f"{session}_cut{cut}"
            while renamed in seen_new:
                cut += 1
                renamed = f"{session}_cut{cut}"
            session = renamed
        if kind == "new" or session not in seen_new:
            kind = "new"
            seen_new.add(session)
        fixed.append({**take, "kind": kind, "session": session})

    sounds = _unique_event_sounds([_field(take, "sound", "sfx") for take in fixed])
    style = _style_block(style_lock, craft)
    session_seed: dict[str, int] = {}
    ordinal = 0
    out: list[dict[str, Any]] = []
    prefix_slug = _prefix_slug(slug)

    for index, take in enumerate(fixed):
        session = str(take["session"])
        kind = str(take["kind"])
        if session not in session_seed:
            ordinal += 1
            session_seed[session] = int(seed_base) + ordinal
        default_duration = 9.0 if category == "footage" else 5.0
        duration = _duration(take.get("duration"), default_duration)
        if category == "footage":
            duration = min(10.0, max(8.0, duration))

        action = _field(take, "action")
        if not action:
            action = _legacy_action(_field(take, "prompt"), style_lock)
        if style_lock and style_lock in action:
            action = action.replace(style_lock, " ").strip()
        action = action or "Hold the established pose."

        spatial = _field(take, "spatial") or (
            "Keep whoever is already in frame in their current LEFT, CENTER or RIGHT place. Do not drift."
        )
        camera = _field(take, "camera") or "locked-off, same angle as the start of this shot"
        entry = _field(take, "entry_state", "entry") or (
            "Start settled in the spatial map, props at rest."
            if kind == "new"
            else "Start from the previous take's ending pose."
        )
        exit_state = _field(take, "exit_state", "exit") or (
            "End settled in the pose this single action finishes. No extra gesture."
        )
        visible = _field(take, "visible") or "Only the characters already established in this shot."
        n = index + 1
        prompt = _assemble_prompt(
            kind=kind,
            category=category,
            duration=duration,
            width=int(width),
            height=int(height),
            model_pack=model_pack,
            style_block=style,
            spatial=spatial,
            camera=camera,
            entry=entry,
            action=action,
            exit_state=exit_state,
            visible=visible,
            speaker=_field(take, "speaker") or "none",
            dialogue=_field(take, "dialogue"),
            sound=sounds[index] if index < len(sounds) else "",
            capture_mode=_field(take, "capture_mode", "capture"),
        )
        item: dict[str, Any] = {
            "n": n,
            "kind": kind,
            "session": session,
            "seed": session_seed[session],
            "duration": duration,
            "prefix": f"video/{prefix_slug}/t{n:02d}",
            "prompt": prompt,
            "title": _field(take, "title") or f"Take {n}",
        }
        frame = _field(take, "first_frame")
        if kind == "new" and frame:
            item["first_frame"] = frame
        out.append(item)
    return out


def _normalize_takes(
    takes: list[dict[str, Any]],
    *,
    slug: str,
    seed_base: int,
    style_lock: str,
    craft: str,
    width: int = 576,
    height: int = 1024,
    model_pack: str = "sfw",
    category: str = "general",
    keep_all: bool = False,
) -> list[dict[str, Any]]:
    return conform_takes(
        takes,
        slug=slug,
        seed_base=seed_base,
        style_lock=style_lock,
        craft=craft,
        width=width,
        height=height,
        model_pack=model_pack,
        category=category,
        keep_all=keep_all,
    )


async def generate_dice_brief(*, model_pack: str = "sfw", category: str = "general") -> dict[str, Any]:
    provider = get_provider()
    user = f"model_pack={model_pack}. Invent one fresh idea."
    if category == "footage":
        user += (
            " Category is footage: one concrete unsettling but restrained "
            "surveillance or phone incident, no dialogue, everyday Brazilian place."
        )
    data = await provider.chat_json(
        DICE_SYSTEM,
        user,
        {"brief": "...", "title": "...", "tone": "..."},
    )
    return {
        "brief": data.get("brief") or "",
        "title": data.get("title") or "História aleatória",
        "tone": data.get("tone") or "",
    }


def _clip_text(text: str, limit: int) -> str:
    flat = " ".join(str(text or "").split())
    if len(flat) <= limit:
        return flat
    return flat[: limit - 1].rstrip() + "…"


def _take_revision_line(take: dict[str, Any], bucket: str) -> str:
    action = take.get("action") or _clip_text(take.get("prompt") or "", 360)
    action = _clip_text(action, 360)
    return (
        f"{bucket} take {take.get('n')} kind={take.get('kind') or 'new'} "
        f"session={take.get('session') or ''} duration={take.get('duration') or 5}s "
        f"title={take.get('title') or ''}: {action}"
    )


def story_user_prompt(
    *,
    brief: str,
    max_duration_sec: float,
    model_pack: str,
    category: str,
    frame: str,
    bible: str,
    style_lock: str,
    craft: str,
    title: str | None = None,
    notes: str | None = None,
    revise: bool = False,
    take_count: int | None = None,
    drop_takes: list[int] | None = None,
    add_takes: list[dict[str, Any]] | None = None,
    current_takes: list[dict[str, Any]] | None = None,
    roteiro_md: str | None = None,
) -> str:
    user = (
        f"BRIEF (Portuguese):\n{brief}\n\n"
        f"max_duration_sec: {max_duration_sec}\n"
        f"model_pack: {model_pack}\n"
        f"category: {category}\n"
        f"confirmed frame: {frame}\n"
        f"STYLE bible (PT, for humans only): {bible}\n"
        f"STYLE lock_en (English, keep this look):\n{style_lock}\n"
        f"STYLE craft:\n{craft}\n"
    )
    if category == "footage":
        user += f"\n{FOOTAGE_STORY_RULES}\n"
    if title:
        user += f"Preferred title: {title}\n"
    revision = _revision_block(
        notes=notes,
        revise=revise,
        take_count=take_count,
        drop_takes=drop_takes,
        add_takes=add_takes,
        current_takes=current_takes,
        roteiro_md=roteiro_md,
        category=category,
    )
    if revision:
        user += "\n" + revision
    return user


def _revision_block(
    *,
    notes: str | None,
    revise: bool,
    take_count: int | None,
    drop_takes: list[int] | None,
    add_takes: list[dict[str, Any]] | None,
    current_takes: list[dict[str, Any]] | None,
    roteiro_md: str | None,
    category: str,
) -> str:
    note = (notes or "").strip()
    drops = []
    for raw in drop_takes or []:
        try:
            number = int(raw)
        except (TypeError, ValueError):
            continue
        if number > 0:
            drops.append(number)
    adds = [item for item in (add_takes or []) if isinstance(item, dict)]
    target = int(take_count) if take_count else None
    if not revise and not note and not drops and not adds and not target:
        return ""

    lines = [
        "SCRIPT REVISION:",
        "Follow the adjustments below. action, spatial, camera, entry_state, exit_state, visible, speaker, and sound stay English.",
        "dialogue is Brazilian Portuguese, spoken words only. title and roteiro_md may be Portuguese.",
    ]
    if revise and current_takes:
        lines.append(
            "Revise the CURRENT SCRIPT. Keep characters, place, and every KEEP take's beat unless an adjustment changes it."
        )
        known: list[int] = []
        for take in current_takes:
            try:
                number = int(take.get("n") or 0)
            except (TypeError, ValueError):
                number = 0
            known.append(number)
            bucket = "DROP" if number in drops else "KEEP"
            lines.append(_take_revision_line(take, bucket))
        missing = [number for number in drops if number not in known]
        if missing:
            lines.append("DROP numbers already absent, ignore them: " + ", ".join(str(n) for n in missing))
    elif revise:
        lines.append("There is no current take list. Write the script from the brief and the adjustments.")
    else:
        lines.append("Write a new script from the brief. Do not copy an earlier shot list.")

    if adds:
        lines.append("ADD takes at these positions. Numbers refer to the current script:")
        for item in adds:
            after = item.get("after")
            try:
                after_n = int(after) if after is not None else None
            except (TypeError, ValueError):
                after_n = None
            if after_n is None:
                where = "at the end"
            elif after_n <= 0:
                where = "before take 1"
            else:
                where = f"after take {after_n}"
            lines.append(f"- {where}: {_clip_text(item.get('note') or 'a new beat that fits the story', 400)}")

    if target:
        lines.append(
            f"The takes array MUST contain exactly {target} items. "
            "Renumber n from 1. The sum of durations MUST stay within max_duration_sec. "
            "If a requested take does not fit, shorten durations (minimum 2 seconds, or 8 for footage) "
            "instead of dropping that take."
        )
        if category == "footage" and target != 1:
            lines.append(
                "USER OVERRIDE: the one-take footage limit does not apply to this request. "
                f"Return exactly {target} takes. Keep cheap real capture, no voice, and one action per take."
            )
    if note:
        lines.append("USER ADJUSTMENTS (Portuguese — follow these):\n" + note)
    roteiro = (roteiro_md or "").strip()
    if revise and roteiro:
        lines.append("CURRENT ROTEIRO (Portuguese, for humans):\n" + _clip_text(roteiro, 2500))
    return "\n".join(lines) + "\n"


async def accept_story_contract(provider, *, system: str, user: str, schema: dict, validate) -> dict[str, Any]:
    """Call the model, then retry up to twice when the JSON misses the skill contract.

    A 429 does not spend one of those retries. The call waits out the provider
    window (Retry-After, or 60s for NVIDIA's roughly 20 requests per minute).
    """
    errors: list[str] = []
    attempt = 0
    waits = 0
    while attempt < 3:
        message = user
        if errors:
            message += (
                "\n\nCONTRACT REJECTED. Return the full JSON again and fix every item:\n"
                + "\n".join(f"- {item}" for item in errors)
            )
        try:
            data = await provider.chat_json(
                system,
                message,
                schema,
                temperature=0.2 if attempt else 0.3,
                max_tokens=8192,
            )
        except RateLimited as exc:
            waits += 1
            if waits > 3:
                raise ValueError(
                    "A API limitou as chamadas e não liberou depois de esperar o intervalo."
                ) from exc
            db.add_log(
                f"Limite da API de roteiro. Aguardando {int(exc.wait_sec)}s.",
                source="llm",
            )
            await asyncio.sleep(exc.wait_sec)
            continue
        except Exception as exc:
            errors = [f"Response was not valid JSON ({exc})."]
            attempt += 1
            continue
        if not isinstance(data, dict):
            errors = ["Response JSON must be an object with title, synopsis, roteiro_md and takes."]
            attempt += 1
            continue
        errors = validate(data)
        if not errors:
            return data
        attempt += 1
    raise ValueError(
        "A API não seguiu o contrato da skill depois de 2 novas tentativas: " + "; ".join(errors)
    )


async def generate_story(
    *,
    brief: str,
    max_duration_sec: float,
    style_id: str | None,
    slug: str,
    seed_base: int = 2000,
    model_pack: str = "sfw",
    title: str | None = None,
    width: int = 576,
    height: int = 1024,
    category: str = "general",
    notes: str | None = None,
    revise: bool = False,
    take_count: int | None = None,
    drop_takes: list[int] | None = None,
    add_takes: list[dict[str, Any]] | None = None,
    current_takes: list[dict[str, Any]] | None = None,
    roteiro_md: str | None = None,
) -> dict[str, Any]:
    style = db.get_style(style_id) if style_id else None
    style_lock = (style or {}).get("lock_en") or ""
    craft = (style or {}).get("craft_rules_en") or ""
    bible = (style or {}).get("bible_hint_pt") or ""
    frame = _frame_phrase(int(width), int(height))
    adds = [item for item in (add_takes or []) if isinstance(item, dict)]
    target = int(take_count) if take_count else None
    explicit_multi = bool(adds) or (target is not None and target != 1)
    keep_all = category != "footage" or explicit_multi

    provider = get_provider()
    user = story_user_prompt(
        brief=brief,
        max_duration_sec=max_duration_sec,
        model_pack=model_pack,
        category=category,
        frame=frame,
        bible=bible,
        style_lock=style_lock,
        craft=craft,
        title=title,
        notes=notes,
        revise=revise,
        take_count=target,
        drop_takes=drop_takes,
        add_takes=adds,
        current_takes=current_takes if revise else None,
        roteiro_md=roteiro_md if revise else None,
    )

    take_example: dict[str, Any] = {
        "n": 1,
        "kind": "new",
        "session": "door_v1",
        "duration": 6,
        "title": "chega à porta",
        "spatial": "Wolf RIGHT, outside. Closed door CENTER. Camera outside, locked.",
        "camera": "locked-off medium, outside",
        "entry_state": "Both forepaws down. Door closed.",
        "action": "The wolf takes two steps and stops beside the closed door. Both forepaws stay down.",
        "exit_state": "Forepaws still down. Door still closed.",
        "visible": "Only the wolf.",
        "speaker": "none",
        "dialogue": "",
        "sound": "Two soft footsteps, then quiet air.",
        "capture_mode": "",
    }
    story_takes = [
        take_example,
        {
            "n": 2,
            "kind": "continue",
            "session": "door_v1",
            "duration": 6,
            "title": "a voz pergunta",
            "spatial": "Wolf RIGHT, outside. Closed door CENTER. Camera outside, locked.",
            "camera": "locked-off medium, outside",
            "entry_state": "Forepaws still down. Door still closed.",
            "action": "The wolf stays still, mouth closed. The door stays shut.",
            "exit_state": "Forepaws down. Door still closed.",
            "visible": "Only the wolf. The speaker is not visible.",
            "speaker": "offscreen elderly woman inside",
            "dialogue": "Quem é?",
            "sound": "Only the voice from inside the closed door, then quiet air. No footsteps.",
            "capture_mode": "",
        },
    ]
    if category == "footage":
        take_example = {
            "n": 1,
            "kind": "new",
            "session": "footage_v1",
            "duration": 9,
            "title": "o vulto no portão",
            "spatial": "Gate CENTER. Figure enters from LEFT and stops before the gate.",
            "camera": "fixed cheap CCTV, no pan or zoom",
            "entry_state": "Yard empty. Gate closed.",
            "action": "A tall stooped person in work clothes walks to the gate and stops.",
            "exit_state": "Figure still at the gate, both arms down.",
            "visible": "Only that one person.",
            "speaker": "none",
            "dialogue": "",
            "sound": "Night insects and distant traffic. No voice.",
            "capture_mode": "fixed CCTV",
        }
    schema = {
        "title": "Título em português",
        "synopsis": "Uma frase do que acontece.",
        "roteiro_md": (
            "# Título\n\n## Take 01 — NEW — 0s–6s\n"
            "**Uma ação:** chega e para.\n**Sem fala.**\n"
            "**Som exclusivo deste take:** passos, depois silêncio.\n\n"
            "## Take 02 — CONTINUE — 6s–12s\n"
            "**Uma ação:** espera imóvel.\n**Fala:** Quem é?\n"
            "**Som exclusivo deste take:** só a voz atrás da porta."
        ),
        "takes": [take_example] if category == "footage" else story_takes,
        "total_duration_sec": take_example["duration"],
    }
    system = STORY_SYSTEM if category != "footage" else f"{STORY_SYSTEM}\n\n{FOOTAGE_STORY_RULES}"
    if category == "footage" and target and target != 1:
        system += (
            f"\n\nUSER OVERRIDE for this request only: return exactly {target} takes. "
            "The one-take footage limit does not apply. Keep cheap real capture, no voice, and one action per take."
        )
    data = await accept_story_contract(
        provider,
        system=system,
        user=user,
        schema=schema,
        validate=lambda payload: contract_errors(
            payload,
            category=category,
            max_duration_sec=float(max_duration_sec),
            take_count=target,
            allow_multi_footage=explicit_multi,
        ),
    )
    takes = _normalize_takes(
        list(data.get("takes") or []),
        slug=slug,
        seed_base=seed_base,
        style_lock=style_lock,
        craft=craft,
        width=int(width),
        height=int(height),
        model_pack=model_pack,
        category=category,
        keep_all=keep_all,
    )
    total = sum(float(t["duration"]) for t in takes)
    # If over max, trim from the end. Renumber so prefixes stay sequential.
    while takes and total > float(max_duration_sec) + 0.5:
        dropped = takes.pop()
        total -= float(dropped["duration"])
    count_warning = None
    if target:
        if len(takes) > target:
            while len(takes) > target:
                dropped = takes.pop()
                total -= float(dropped["duration"])
            count_warning = f"O modelo devolveu takes a mais; a lista ficou em {target}."
        elif len(takes) < target:
            count_warning = f"O modelo devolveu {len(takes)} takes; o pedido era {target}."
    prefix_slug = _prefix_slug(slug)
    for index, take in enumerate(takes, start=1):
        take["n"] = index
        take["prefix"] = f"video/{prefix_slug}/t{index:02d}"
    estimate = estimate_generation(len(takes))
    return {
        "title": data.get("title") or title or "Sem título",
        "synopsis": data.get("synopsis") or "",
        "roteiro_md": data.get("roteiro_md") or "",
        "takes": takes,
        "total_duration_sec": total,
        "estimate": estimate,
        "count_warning": count_warning,
    }


def validate_takes(takes: list[dict[str, Any]], max_duration_sec: float) -> list[str]:
    errors: list[str] = []
    if not takes:
        errors.append("Nenhum take")
        return errors
    total = 0.0
    sessions_seen: set[str] = set()
    for t in takes:
        kind = t.get("kind")
        session = t.get("session") or ""
        dur = float(t.get("duration") or 5)
        if kind not in {"new", "continue"}:
            errors.append(f"Take {t.get('n')}: kind inválido")
        if t.get("first_frame") and kind != "new":
            errors.append(f"Take {t.get('n')}: quadro-base só pode ser usado em NEW; CONTINUE usa o checkpoint")
        if not (t.get("prompt") or "").strip():
            errors.append(f"Take {t.get('n')}: prompt vazio")
        if dur < 2 or dur > 15:
            errors.append(f"Take {t.get('n')}: duration fora de 2–15")
        if kind == "new":
            sessions_seen.add(session)
        elif session not in sessions_seen and kind == "continue":
            # allow if earlier new in list
            earlier_new = any(
                x.get("session") == session and x.get("kind") == "new" for x in takes
            )
            if not earlier_new:
                errors.append(f"Take {t.get('n')}: CONTINUE sem NEW na session {session}")
        total += dur
    if total > float(max_duration_sec) + 1.0:
        errors.append(f"Duração total {total:.0f}s > máximo {max_duration_sec:.0f}s")
    return errors
