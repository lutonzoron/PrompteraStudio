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
