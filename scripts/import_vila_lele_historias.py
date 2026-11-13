"""Import historias_vila_lele/*.md → Promptera draft projects (takes Continuity + style massinha)."""
from __future__ import annotations

import json
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import db  # noqa: E402
from app.config import ensure_dirs  # noqa: E402
from app.inbox.service import ensure_inbox, import_takes_file  # noqa: E402
from app.styles.service import ensure_seed_styles  # noqa: E402

SOURCE = Path(r"c:\Projetos\teste comfyui nsfw\historias_vila_lele")
W, H = 1024, 576
STYLE_ID = "massinha"

CHAR_LOCK = (
    "Handmade stop-motion claymation, tactile plasticine, visible fingerprint dents. "
    "One miniature clay set, no photo backdrop, no cutout, no character sheet, no studio void, "
    "no text, no numbers, no logos, no subtitles. Preschool, gentle, funny, SFW. "
    "Locked-off eye-level medium-wide 16:9 camera, soft daylight, no zoom, no pan. "
    "Big round eyes with white sclera and black pupils. Cheeks stay still. "
    "Counted limbs only. Same clay world forever."
)

CAST = {
    "Lelé": "Lelé clay child: round peach head, one orange tuft, yellow overalls, two green shoes, two arms, two legs",
    "Tito": "Tito clay turtle: olive shell, cream belly, tiny red bow tie, four short legs",
    "Beto": "Beto clay dog: caramel fur, floppy ears, blue collar",
    "Dona Rosa": "Dona Rosa clay woman: gray bun, round glasses, pink apron, blue dress, two arms",
    "Rosa": "Dona Rosa clay woman: gray bun, round glasses, pink apron, blue dress (witch hat when story says)",
    "Nica": "Nica clay blue bird: yellow beak, two wings, two feet — chirps only, never words",
    "Gida": "Gida clay chicken: cream feathers, red comb, two legs",
    "Fúco": "Fuco clay baby dragon: soft green scales, tiny wings, rounded snout, friendly",
    "Fuco": "Fuco clay baby dragon: soft green scales, tiny wings, rounded snout, friendly",
}

STORIES = [
    ("01_esconde_esconde_casco.md", "vila_lele_01_esconde_casco", "Vila Lelé 01 — Esconde-esconde do Tito", "vilele_esconde_casco", 8301),
    ("02_o_peido_culpado.md", "vila_lele_02_peido_culpado", "Vila Lelé 02 — O peido culpado", "vilele_peido_culpado", 8311),
    ("03_meia_no_nariz.md", "vila_lele_03_meia_nariz", "Vila Lelé 03 — Meia no nariz", "vilele_meia_nariz", 8321),
    ("04_coco_congelado.md", "vila_lele_04_coco_congelado", "Vila Lelé 04 — Cocô congelado", "vilele_coco_congelado", 8331),
    ("05_soluco_pum.md", "vila_lele_05_soluco_pum", "Vila Lelé 05 — Soluço-pum", "vilele_soluco_pum", 8341),
    ("06_banquinho_traidor.md", "vila_lele_06_banquinho", "Vila Lelé 06 — Banquinho traidor", "vilele_banquinho", 8351),
    ("07_o_dente_valente.md", "vila_lele_07_dente_valente", "Vila Lelé 07 — O dente valente", "vilele_dente_valente", 8361),
    ("08_bruxa_sem_vassoura.md", "vila_lele_08_bruxa", "Vila Lelé 08 — Bruxa sem vassoura", "vilele_bruxa_vassoura", 8371),
    ("09_ovo_esquecido.md", "vila_lele_09_ovo", "Vila Lelé 09 — Ovo esquecido", "vilele_ovo_esquecido", 8381),
    ("10_sombra_no_mato.md", "vila_lele_10_sombra", "Vila Lelé 10 — Sombra no mato", "vilele_sombra_mato", 8391),
    ("11_dragao_soluco.md", "vila_lele_11_dragao", "Vila Lelé 11 — Dragão soluço útil", "vilele_dragao_soluco", 8401),
    ("12_piscina_sabao.md", "vila_lele_12_piscina", "Vila Lelé 12 — Piscina de sabão", "vilele_piscina_sabao", 8411),
]


def _strip_md(s: str) -> str:
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    return s.strip()


def _speech_line(cell: str) -> str | None:
    cell = _strip_md(cell)
    if not cell or cell in {"—", "-", "–"}:
        return None
    low = cell.lower()
    # pure sfx / silence markers
    if any(
        x in low
        for x in (
            "silêncio",
            "efeito",
            "peido",
            "soluço",
            "só gesto",
            "sem fala",
            "mute",
            "só som",
        )
    ) and "**" not in cell and not re.search(r"[A-Za-zÀ-ú].*[.!?]", cell):
        # still allow if it looks like dialogue in bold elsewhere — handled below
        if not re.search(r"[A-ZÁÉÍÓÚÀÂÊÔÃÕ].+", cell):
            return None
    # extract bold dialogue if present
    bold = re.findall(r"\*\*([^*]+)\*\*", cell)
    if bold:
        # pick last bold that looks like speech
        for b in reversed(bold):
            b = b.strip()
            if b and b.lower() not in {"peido", "soluço"} and len(b) > 1:
                return b
    # "Beto: Foi ele." style
    m = re.search(r":\s*(.+)$", cell)
    if m:
        cand = _strip_md(m.group(1))
        if cand and cand not in {"—", "-"}:
            return cand
    # whole cell as speech if short sentence
    if len(cell) <= 80 and re.search(r"[A-Za-zÀ-ú]", cell) and not cell.lower().startswith("os "):
        if any(w in low for w in ("gesto", "efeito", "silêncio", "parados", "ninguém")):
            return None
        return cell
    return None


def _parse_takes(md: str) -> list[dict]:
    rows = []
    for line in md.splitlines():
        if not line.strip().startswith("|"):
            continue
        if re.search(r"\|\s*-+\s*\|", line) or "Kind" in line or "Ação" in line and "n |" in line.lower():
            continue
        if not re.search(r"\|\s*0?\d+", line):
            continue
        parts = [p.strip() for p in line.strip().strip("|").split("|")]
        if len(parts) < 3:
            continue
        # formats:
        # n | Kind | s | staging | action | speech
        # n | Kind | s | action | speech
        # n NEW | s | action | speech
        n_raw = parts[0]
        kind = "continue"
        duration = 4.0
        action = ""
        speech_cell = ""
        staging = ""

        m = re.match(r"0?(\d+)\s*(NEW|CONTINUE)?", n_raw, re.I)
        if not m:
            continue
        n = int(m.group(1))
        if m.group(2):
            kind = m.group(2).lower()
            # | 01 NEW | 4 | action | speech
            if len(parts) >= 2 and re.match(r"^\d+(\.\d+)?$", parts[1]):
                duration = float(parts[1])
                if len(parts) == 3:
                    action, speech_cell = parts[2], ""
                elif len(parts) >= 4:
                    action, speech_cell = parts[2], parts[3]
            elif len(parts) >= 3 and re.match(r"^\d+(\.\d+)?$", parts[2] if len(parts) > 2 else ""):
                pass
        else:
            # | 01 | NEW | 4 | ...
            if len(parts) >= 2 and parts[1].upper() in {"NEW", "CONTINUE"}:
                kind = parts[1].lower()
                if len(parts) >= 3 and re.match(r"^\d+(\.\d+)?$", parts[2]):
                    duration = float(parts[2])
                    rest = parts[3:]
                    if len(rest) >= 3:
                        staging, action, speech_cell = rest[0], rest[1], rest[2]
                    elif len(rest) == 2:
                        action, speech_cell = rest[0], rest[1]
                    elif len(rest) == 1:
                        action = rest[0]
            elif len(parts) >= 2 and re.match(r"^\d+(\.\d+)?$", parts[1]):
                # | 01 | 4 | action | speech  (kind implied)
                duration = float(parts[1])
                kind = "new" if n == 1 else "continue"
                rest = parts[2:]
                if len(rest) >= 2:
                    action, speech_cell = rest[0], rest[1]
                elif rest:
                    action = rest[0]

        if n == 1:
            kind = "new"
        action = _strip_md(action)
        staging = _strip_md(staging)
        speech = _speech_line(speech_cell) if speech_cell else None
        # also try bold inside action column
        if speech is None:
            speech = _speech_line(action) if "**" in (speech_cell or "") else _speech_line(
                re.search(r"\*\*([^*]+)\*\*", parts[-1] if parts else "") and parts[-1] or ""
            )
        # re-extract speech from last col more carefully
        if parts:
            last = parts[-1]
            sp2 = _speech_line(last)
            if sp2:
                speech = sp2
            # if last col is speech and action was previous
            if len(parts) >= 4 and kind:
                pass

        rows.append(
            {
                "n": n,
                "kind": kind,
                "duration": max(2.0, min(15.0, duration)),
                "staging": staging,
                "action": action,
                "speech": speech,
                "sfx_note": _strip_md(speech_cell) if speech_cell and speech is None else "",
            }
        )
    # dedupe by n keeping last
    by_n: dict[int, dict] = {}
    for r in rows:
        by_n[r["n"]] = r
    return [by_n[k] for k in sorted(by_n)]


def _cast_blob(md: str) -> str:
    found = []
    for name, desc in CAST.items():
        if re.search(rf"\b{re.escape(name)}\b", md, re.I):
            if desc not in found:
                found.append(desc)
    return "; ".join(found) if found else CAST["Lelé"]


def _logline(md: str) -> str:
    m = re.search(r"## Logline\s*\n+(.+?)(?:\n##|\Z)", md, re.S)
    if m:
        return " ".join(_strip_md(m.group(1)).split())
    return ""


def _build_prompt(row: dict, *, cast: str, session_hint: str, is_new: bool) -> str:
    dur = row["duration"]
    action = row["action"] or "ONE clear preschool claymation beat"
    staging = row["staging"]
    speech = row["speech"]
    sfx = row.get("sfx_note") or ""

    spatial = staging or "Keep same screen positions as previous take."
    lock = (
        f"CONTINUITY LOCK: {CHAR_LOCK}\n"
        f"CAST LOCK: {cast}. Partner/friend never swaps faces.\n"
        f"Spatial: {spatial}\n"
    )
    if is_new:
        lock += (
            "\nintegrated_multimodal_description:\n"
            f"[Shot 1] Handmade claymation preschool backyard/home set, soft daylight, funny gentle tone.\n"
            f"00:00.000–00:{int(dur):02d}.000 "
        )
    else:
        lock += "\nONE action only. Same puppets, same clothes, same camera. No sheet, no void, no text.\n\n"

    if speech:
        audio = (
            "AUDIO LOCK: Quiet until the exact line. Only one mouth moves. Others sealed shut. "
            "After the line, mouth closes ~1s silence. No ad-lib. No ã/ão inventados.\n"
            f"ONE action: {action}. Then clear lip sync for this exact Brazilian Portuguese line only:\n"
            f"<d>[Portuguese] {speech}</d>\n"
            "Soft diegetic air; clear short Brazilian Portuguese childlike claymation voice on that line only. "
            "No music. No other speech."
        )
    elif sfx and any(x in sfx.lower() for x in ("peido", "soluço", "efeito", "silêncio")):
        audio = (
            "AUDIO LOCK: MUTE of dialogue. No words. No lip sync. No <d> lines. All mouths sealed shut.\n"
            f"ONE action: {action}. Sound only: soft outdoor/indoor air + the described cartoon SFX ({sfx}). "
            "No music. No speech."
        )
    else:
        audio = (
            "AUDIO LOCK: MUTE. No dialogue. No speech. No whisper. No <d> lines. Mouths stay closed.\n"
            f"ONE action: {action}. Soft diegetic air only. No music."
        )

    if is_new:
        return lock + f"ONE action: {action}\n\noverall_soundscape:\n" + audio + "\nnon_diegetic_music: N/A"
    return lock + audio


def build_takes(md: str, *, slug: str, session: str, seed: int) -> list[dict]:
    rows = _parse_takes(md)
    if not rows:
        raise ValueError("nenhum take parseado")
    cast = _cast_blob(md)
    out = []
    for row in rows:
        n = row["n"]
        kind = "new" if n == 1 else "continue"
        out.append(
            {
                "n": n,
                "kind": kind,
                "session": session,
                "seed": seed,
                "duration": row["duration"],
                "prefix": f"video/{slug}/t{n:02d}",
                "title": f"Take {n}",
                "prompt": _build_prompt(row, cast=cast, session_hint=session, is_new=(kind == "new")),
            }
        )
    return out


def main() -> None:
    ensure_dirs()
    ensure_inbox()
    db.init_db()
    ensure_seed_styles()

    imported: list[str] = []
    skipped: list[str] = []
    failed: list[str] = []

    for fname, slug, title, session, seed in STORIES:
        path = SOURCE / fname
        if not path.exists():
            print(f"MISSING {fname}")
            failed.append(slug)
            continue
        md = path.read_text(encoding="utf-8")
        try:
            takes = build_takes(md, slug=slug, session=session, seed=seed)
        except Exception as exc:
            print(f"PARSE FAIL {slug}: {exc}")
            failed.append(slug)
            continue

        logline = _logline(md)
        with tempfile.TemporaryDirectory() as td:
            tp = Path(td) / "takes.json"
            tp.write_text(json.dumps(takes, ensure_ascii=False, indent=2), encoding="utf-8")
            meta = {
                "title": title,
                "slug": slug,
                "brief": logline or f"Importado de historias_vila_lele/{fname}",
                "synopsis": logline,
                "model_pack": "sfw",
                "review_mode": "automatico",
                "style_id": STYLE_ID,
                "max_duration_sec": sum(t["duration"] for t in takes),
                "seed_base": seed,
                "width": W,
                "height": H,
            }
            result = import_takes_file(
                tp,
                meta=meta,
                roteiro_md=md,
                source_label=str(path),
            )
        if result.get("skipped"):
            print(f"EXISTS {slug} ({len(takes)} takes)")
            skipped.append(slug)
            continue
        pid = result["project"]["id"]
        db.update_project(
            pid,
            width=W,
            height=H,
            style_id=STYLE_ID,
            model_pack="sfw",
            max_duration_sec=sum(t["duration"] for t in takes),
            stats={"imported_from": str(path), "format": "1024x576", "bank": "historias_vila_lele"},
        )
        print(f"OK {slug} takes={len(takes)} dur={sum(t['duration'] for t in takes):.0f}s")
        imported.append(slug)

    print(f"\nImported: {len(imported)} | Skipped: {len(skipped)} | Failed: {len(failed)}")
    print("Imported:", ", ".join(imported) or "—")
    print("Skipped:", ", ".join(skipped) or "—")
    print("Failed:", ", ".join(failed) or "—")


if __name__ == "__main__":
    main()
