# Roteiro examples

## A) Religious short (~2 h wall · ~1 min film · 12 takes)

4 Continuity blocks × 3 takes. Stock SFW models. Only 3 spoken lines total.

This example's three-take blocks follow its actual scene changes; it is not a rule to insert a cut after every three takes. Narrative conversations can need more spoken takes and a longer continuous session; see [character-identity.md](character-identity.md).

| Block | Session | Beats |
|---|---|---|
| A candle prayer | `faith_A_candle` | join hands + whisper → silent prayer → open eyes |
| B walk to church | `faith_B_street` | walk → adjust coat → look at steeple |
| C pew | `faith_C_pew` | sit → short line → silent bow |
| D altar | `faith_D_altar` | kneel → sign of the cross → “amém” |

Master = last of A+B+C+D only.

## B) NSFW long (~5 min film · ~60 takes · overnight)

Selective Continuity: multi-scene film with hard cuts. 10Eros + heretic.

| Block | Type | Note |
|---|---|---|
| A bed cowgirl | Continuity ~8 | same shot |
| B bath | Continuity ~6 | new session |
| C sofa | Continuity ~8 | new session |
| D inserts | NEW each | no continue between inserts |
| E bed2 | Continuity longer | split pose changes across takes |
| F shower | Continuity | keep short if time-boxed |
| G climax | Continuity | sparse speech until peak |
| H aftercare | NEW mix | quiet |

Prompt hygiene:

- Max ~1 dialogue / 3–4 takes
- Anatomy lock on NEW and CONTINUE
- Never “bra off + flip position + climax” in one take (one action only; use 3–5 s or split takes)
- Duration default 5 s; use shorter/longer per beat (`duration` 2–15 in takes.json)

## C) Fixed hero (post sheet-leak lessons)

Do **not** REF2VA the multi-panel sheet every take.

1. Crop face from sheet (design only).
2. Create **scene plate** still: hero already in location A.
3. Takes 1–3: I2VA NEW from plate → CONTINUE with `use_references: false`, no timeline images.
4. Location B: new plate + new session (same face identity in text + new I2VA).

See [character-identity.md](character-identity.md).

## NEW vs CONTINUE prompt skeletons

**NEW (I2VA from scene plate — preferred)**

```text
CONTINUITY LOCK: Same hero as the first-frame plate. No character sheet, no studio void, no cutout.
Spatial: <who left/right/front/back — fixed>.

integrated_multimodal_description:
[Shot 1] Live-action cinematic, <setting>, <mood>, SFW|explicit adult.
00:00.000–00:05.000 Same person as the input frame, fully in the scene. <ONE action>. <camera>. [optional one short <d>[Portuguese] …</d>]

overall_soundscape:
<ambience>. No music.
non_diegetic_music: N/A
```

**CONTINUE (latent only — no sheet re-inject)**

```text
CONTINUITY LOCK: same camera, same screen direction, same front/back. Same hero. No sheet, no void.
Continue <ONE action>. No dialogue. <sound only>.
```

**Deprecated default:** REF2VA + full sheet + `use_references: true` on every continue.

## Strange Footages and Promptera packs

For series-specific 8-10 second footage, handheld sky/zoom, realistic skin/fur volume and manual-only clocks, read [footage-direction.md](footage-direction.md). The live-action cinematic skeleton above is not the look for casual CCTV or phone captures.

For the current Inbox schema, explicit dimensions, `first_frame`, approval/queue verification and cascading regeneration, read [promptera-inbox.md](promptera-inbox.md) plus the repository's `AI_STORY_INBOX.md`. Never create a different pack format from a legacy example.
