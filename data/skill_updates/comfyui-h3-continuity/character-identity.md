# Character identity — anti sheet-leak (learned)

REF2VA with a **studio character sheet** often pastes the sheet into the video (white/gray void, cutout, collage). Treat that as a known failure mode.

## Preferred pipeline (default for next jobs)

```
1) Design sheet (ChatGPT/etc.) — mid-gray OK for humans; avoid pure white
2) Crop face (and optional body) WITHOUT studio margins if possible
3) Build a SCENE STILL of the hero already in the location
   - either: one T2VA/I2VA still pass, or composite, or first good frame
4) Block NEW = I2VA from that scene still (FL2VA unet)
5) CONTINUE = Continuity checkpoint only
   - use_references: false
   - timeline items: []  (do NOT re-inject the sheet)
6) Hard cut / new location = new scene still (same face crop as guide text + new I2VA plate)
```

## Do / Don't

| Do | Don't |
|---|---|
| I2VA first frame = character **already in the set** | Feed full multi-panel sheet as REF2VA every take |
| Refs only to **author** the first plate | `use_references: true` on every CONTINUE |
| One named hero in Pictures; extras anonymous | Two competing sheets (hero+villain) without spatial locks |
| Explicit screen map: left/right, front/back | Vague “same shot” with no blocking |
| Negatives: no character sheet, no studio void, no cutout | Rely on long prompts alone to stop sheet leak |

## When REF2VA is OK

- Short test clips only, or
- Single clean **face crop** (no studio bg) + strong “fully integrated in scene” language, and
- **Never** re-send refs on CONTINUE (`use_references: false`)

If a NEW shows sheet/void/swap: **stop the block**, fix the plate, re-queue NEW — do not CONTINUE on a bad anchor.

In a shared queue, this applies to the affected block; do not cancel unrelated active generations.

## Continuity lock snippet (put on every take)

```text
CONTINUITY LOCK: Same camera angle, same screen direction, same who-is-in-front.
Named hero keeps exact face/outfit from the established plate.
Extras never inherit the hero face or outfit.
No character sheet, no studio backdrop, no white/gray void, no cutout collage.
ONE action only.
```

## Spatial map (required for multi-subject)

Per Continuity block, fix and repeat:

- Camera orientation
- Hero screen position (e.g. foreground center / left)
- Threat/extra position (e.g. background door only)
- Forbidden swaps (hero must not appear at the door as the monster, etc.)

## Continuing an approved animated story

Inspect the actual approved videos, especially the end of the most recent scene, plus the source prompts and scene plates. Do not infer the current story beat from a title. If a scene is still generating, separate its planned ending from the last confirmed render; prepare the next scene against that planned ending without repeating the same encounter or flower-picking beat.

Keep a compact design/continuity record with the selected art reference, character face and proportions, outfit colors, props, voices, cottage/location geometry, screen directions and the current story state. Reuse verified assets or scene-plate crops as design sources. Save the selected plate and exact generation/edit prompt, and link the new take to the actual saved asset. A new location must preserve character design, not invent a new style.

For the current Chapeuzinho, the user approved classic Disney-era hand-drawn 2D, not a rotating list of animation inspirations. Preserve the established girl, mother, wolf, basket and cottage across chapters. Review prior references before introducing a visible new character. A character who is only heard offscreen should not appear at a window or doorway; keep the opening occluded/closed in the plate when needed.

A scene lasts as long as the conversation/action needs. Three or four takes is a compute guideline, not a compulsory hard cut. Keep a continuous seven-take door exchange or a longer conversation in the same shot/session when the user wants that continuity, rather than resetting every third take. A real cut or new viewpoint still starts a NEW session. Do not reinject design sheets on longer CONTINUE runs.

## Pose, prop and voice state per take

Carry the exact exit pose and prop state forward. Restrict the current take to its own action and motivated sound; avoid a shared list of all sound effects in the scene. An end pose with an arm still raised to knock can encourage another knock in the next take, so specify the paw/hand lowered and a quiet waiting tail.

Example door exchange, one sustained scene with separate beats:

1. Approach, door closed, hands/paws lowered; footsteps only.
2. Exactly one tap; hand/paw lowered by second 2, quiet still wait to the end.
3. Elderly **offscreen** voice from inside: `<d>[Portuguese] Quem é?</d>`. Visible wolf stays silent with mouth closed; door and opaque shutters stay closed.
4. Wolf imitates the girl with his voice, without changing body/face: `<d>[Portuguese] Sou eu, Chapeuzinho. Trouxe pão e geleia para a senhora.</d>`. Door closed, only his mouth moves.
5. Same offscreen elderly voice invites him in; wolf listens silently, door still closed.
6. One direct latch/open action on the established hinge; sound only latch and hinge. Wolf stays outside. Do not include knocking in the action or sound.
7. Start with the door **already open**; one entry, footsteps only. Keep the camera outside and do not reveal the grandmother prematurely.

This sequence is an example of causal state control, not a mandatory plot for every story. Fit speech to the actual take duration and include the story's necessary exchanges; sparse dialogue guidance must not remove the conversation the user requested.
