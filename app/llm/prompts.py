from __future__ import annotations

STORY_SYSTEM = """You plan a MiniMax H3 + DaSiWa Continuity film. The app writes every take prompt in the shape already used by the working scripts. Do not write prompt, seed, or prefix.

Return one JSON object with title, synopsis, roteiro_md, takes, and total_duration_sec.
Every take object has all of these keys: n, kind, session, duration, title, spatial, camera, entry_state, action, exit_state, visible, speaker, dialogue, sound, capture_mode.

Contract:
- kind is "new" or "continue". The first take is "new". CONTINUE keeps that session and extends the latest checkpoint. A hard cut, a new place, or a camera reset is "new" plus a new session name.
- Do not open a new session every three or four takes when the place and camera stay the same. A conversation or a door exchange stays in one session for as many takes as the scene needs, including seven or more.
- duration is the seconds of that single beat, from 2 to 15. The sum of durations stays within max_duration_sec. A take's own clock always starts at 00:00.000.
- One action per take. action is English and includes the pose at the end and the prop or door state. No montage, no spoken line, and no <d> tag inside action.
- spatial, camera, entry_state, exit_state, visible, and sound are English. spatial names LEFT, CENTER, or RIGHT and stays fixed for the whole session.
- entry_state of a CONTINUE is the previous take's exit_state. Do not replay a finished beat.
- visible lists only who is on screen. A voice behind a door or wall is speaker "offscreen" plus who is heard, and visible says that person is not on screen.
- speaker is "none" when nobody speaks. dialogue is then "". When someone speaks, dialogue is Brazilian Portuguese, the spoken words only, short enough for the take. Keep the lines the story needs.
- sound lists only what is heard in THIS take. Never copy knocks, footsteps, and hinges onto a take where they do not happen.
- title, synopsis, and roteiro_md may be Portuguese. roteiro_md has one section per take: "Take NN — NEW" or "Take NN — CONTINUE", the one action, "Sem fala" or the spoken line, and "Som exclusivo deste take".
- capture_mode is "" unless this is a footage clip.
- No character sheet, studio backdrop, white or gray void, or cutout. A CONTINUE does not bring a sheet back.

The app turns accepted fields into the working prompt. Story takes become CONTINUITY LOCK, Spatial, "00:00.000–00:SS.mmm ONE action:", and "Sound:" with the Portuguese line inside <d>[Portuguese] …</d> only when someone speaks. A CONTINUE lock starts with "Continue the latest ready checkpoint; no image reinjection". Footage becomes CONTINUITY LOCK, CAPTURE MODE, PHYSICAL MATERIAL LOCK, SPATIAL / SUBJECT / LIGHT, integrated_multimodal_description, overall_soundscape, and NEGATIVES.

The door exchange below is the field shape, not a plot to copy. The knock exists only in the take where the paw taps once. The offscreen question does not put the speaker in the doorway.
"""

FOOTAGE_STORY_RULES = """This project is one Strange Footage clip, not a multi-scene film.
- Return exactly one take, kind "new", duration 8, 9, or 10.
- capture_mode is exactly one of: "fixed CCTV", "trail camera", "handheld phone".
- One concrete unsettling event, readable for several seconds. An empty yard, ordinary weather, or a speck that only flashes past is not enough.
- Everyday Brazilian place and cheap real capture. A sky-only shot uses handheld phone. Fixed CCTV still shows a real ground-level place.
- visible describes volume from the first frame: rounded thickness, real joints, skin or fur or cloth, and contact shadows. Do not ask for a featureless black silhouette or a flat shadow.
- dialogue is "". No voice, narration, score, sting, growl, roar, scream, or invented engine.
- No clocks, watermarks, subtitles, or phone interface in the image.
- No cinematic camera move. A manual zoom, if any, is one camera note inside camera, about 1x to 2–3x once around the middle, and it enlarges the noise with the picture.
"""

DICE_SYSTEM = """You invent a short original story idea suitable for a vertical Continuity video.
Respond with JSON: {"brief": "...", "title": "...", "tone": "..."}.
Keep it family-friendly unless the user asked for NSFW model pack.
Ideas should be visually clear, one protagonist, 1–3 locations max.
Language of brief/title: Portuguese (Brazil).
"""

STYLE_ADAPT_SYSTEM = """You adapt visual style locks for MiniMax H3 video prompts.

Given a BASE style (lock_en, bible_hint_pt, craft_rules_en, anti_drift_en, negatives)
and a USER REQUEST for a new style, produce a NEW style JSON:

{
  "label": "short PT label",
  "lock_en": "Visual style lock: ... (English, detailed, starts with Visual style lock:)",
  "bible_hint_pt": "short PT description for humans",
  "craft_rules_en": "MUST READ AS ... FORBIDDEN: ...",
  "anti_drift_en": "what NOT to look like",
  "negatives": "comma-separated negative concepts",
  "model_pack_hint": "sfw"|"nsfw",
  "diff_from_base": "what changed vs base"
}

Keep the lock precise enough that H3 cannot drift to Pixar CGI unless requested.
"""
