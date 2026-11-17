from __future__ import annotations

import json
import math
import shutil
import subprocess
import tempfile
import time
import uuid
from threading import Event
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from . import db
from .config import PROJECTS_DIR
from .masters import resolve_master_path

ALIGNMENTS = {'top-left': 7, 'top-right': 9, 'bottom-left': 1, 'bottom-right': 3}
COLORS = {'white': '&H00FFFFFF', 'green': '&H0060FF80'}


def _ass_time(seconds: float) -> str:
    centiseconds = round(seconds * 100)
    return f'{centiseconds // 360000}:{centiseconds // 6000 % 60:02d}:{centiseconds // 100 % 60:02d}.{centiseconds % 100:02d}'


def clock_subtitles(start: datetime, duration: float, width: int, height: int,
                    position: str = 'top-left', color: str = 'white') -> str:
    if position not in ALIGNMENTS or color not in COLORS:
        raise ValueError('Posição ou cor inválida')
    size = max(5, round(height * .038))
    margin_x, margin_y = max(2, round(width * .018)), max(2, round(height * .024))
    header = f'''[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: CCTV,Consolas,{size},{COLORS[color]},&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,0.25,0.1,{ALIGNMENTS[position]},{margin_x},{margin_x},{margin_y},1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    lines = [header]
    for second in range(math.ceil(duration)):
        text = (start + timedelta(seconds=second)).strftime('%Y-%m-%d %H:%M:%S')
        lines.append(f'Dialogue: 0,{_ass_time(second)},{_ass_time(min(second+1, duration))},CCTV,,0,0,0,,{text}\n')
    return ''.join(lines)


def _encode(command: list[str], cwd: Path, timeout: float, cancel_event: Event | None) -> None:
    deadline = time.monotonic() + timeout
    process = subprocess.Popen(command, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    try:
        while True:
            if cancel_event and cancel_event.is_set():
                raise RuntimeError('Pós-edição interrompida para liberar a fila')
            if time.monotonic() > deadline:
                raise RuntimeError('Tempo limite da pós-edição excedido')
            try:
                _, error = process.communicate(timeout=.25)
                break
            except subprocess.TimeoutExpired:
                continue
        if process.returncode:
            raise RuntimeError('Falha ao aplicar data/hora: ' + error[-1500:])
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()


def export_timestamp(project_id: str, start: datetime | None = None, position: str = 'top-left',
                     color: str = 'white', source: Path | None = None, cancel_event: Event | None = None) -> dict:
    if cancel_event and cancel_event.is_set():
        raise RuntimeError('Pós-edição cancelada')
    project = db.get_project(project_id)
    if not project or project.get('category') != 'footage':
        raise RuntimeError('Este vídeo precisa estar na categoria Footage')
    if start is None:
        value = project.get('cctv_timestamp_start')
        if not value:
            raise RuntimeError('Defina a data/hora inicial do relógio')
        start = datetime.fromisoformat(value)
    if source is None:
        original = (project.get('stats') or {}).get('original_master')
        source = Path(original) if original and Path(original).is_file() else resolve_master_path(project)
    if not source or not source.is_file():
        raise RuntimeError('O master precisa estar concluído antes do acabamento')
    source = source.resolve()
    ffmpeg, ffprobe = shutil.which('ffmpeg'), shutil.which('ffprobe')
    if not ffmpeg or not ffprobe:
        raise RuntimeError('ffmpeg e ffprobe precisam estar instalados')
    probe = subprocess.run([ffprobe, '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                            'format=duration:stream=width,height', '-of', 'json', str(source)],
                           capture_output=True, text=True, timeout=20, check=True)
    info = json.loads(probe.stdout)
    duration = float(info['format']['duration'])
    width, height = info['streams'][0]['width'], info['streams'][0]['height']
    clock_width = min(480, width)
    clock_height = max(2, round(height * clock_width / width / 2) * 2)
    if not math.isfinite(duration) or not 0 < duration <= 86400:
        raise RuntimeError('Duração inválida para exportar o relógio')
    export_id = uuid.uuid4().hex
    directory = PROJECTS_DIR / project_id / 'exports'
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / f'master_cctv_{export_id}.mp4'
    with tempfile.TemporaryDirectory(prefix='clock-', dir=directory) as temporary:
        temporary = Path(temporary)
        (temporary/'clock.ass').write_text(clock_subtitles(start, duration, clock_width, clock_height, position, color), encoding='utf-8')
        staged = temporary/'render.mp4'
        stamp = (f'[1:v]ass=clock.ass:alpha=1,scale={width}:{height}:flags=neighbor,'
                 'gblur=sigma=0.2,colorchannelmixer=aa=0.9[stamp];'
                 '[0:v][stamp]overlay=shortest=1:format=auto[video]')
        _encode([ffmpeg, '-n', '-v', 'error', '-i', str(source), '-f', 'lavfi', '-i',
                 f'color=c=black@0.0:s={clock_width}x{clock_height}:r=8:d={duration},format=rgba',
                 '-filter_complex', stamp, '-map', '[video]', '-map', '0:a?',
                 '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '2',
                                 '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', str(staged)],
                temporary, max(120, duration*5), cancel_event)
        if cancel_event and cancel_event.is_set():
            raise RuntimeError('Pós-edição cancelada')
        staged.replace(output)
    record = dict(id=export_id, project_id=project_id, path=str(output), source_path=str(source),
                  start_time=start.isoformat(), position=position, color=color, created_at=time.time())
    db.save_footage_export(record)
    # Read again so unrelated settings and generation stats are preserved.
    current = db.get_project(project_id)
    stats = dict(current.get('stats') or {})
    # Keep the first clean master forever; never point original_master at a CCTV render.
    kept = stats.get('original_master')
    if not (kept and Path(str(kept)).is_file()):
        stats['original_master'] = str(source)
    stats['master'] = str(output)
    stats['cctv_active'] = True
    db.update_project(project_id, stats=stats)
    return {**record, 'url': f'/api/projects/{project_id}/footage-exports/{export_id}',
            'cctv_active': True, 'original_master': stats['original_master']}


def _resolved(path: str | Path | None) -> Path | None:
    if not path:
        return None
    try:
        p = Path(path)
    except TypeError:
        return None
    return p.resolve() if p.is_file() else None


def cctv_status(project: dict | None) -> dict[str, Any]:
    """Whether the active master is a CCTV stamp over a preserved original."""
    if not project:
        return {'cctv_active': False, 'has_original_master': False, 'original_master': None}
    stats = project.get('stats') or {}
    original = _resolved(stats.get('original_master'))
    master = _resolved(stats.get('master')) or resolve_master_path(project)
    master_r = master.resolve() if master and master.is_file() else None
    # Path comparison is the source of truth; the flag is just a cache for UIs.
    active = bool(original and master_r and original != master_r)
    return {
        'cctv_active': active,
        'has_original_master': bool(original),
        'original_master': str(original) if original else None,
    }


def remove_timestamp(project_id: str) -> dict:
    """Restore the preserved original as the active master."""
    project = db.get_project(project_id)
    if not project or project.get('category') != 'footage':
        raise RuntimeError('Este vídeo precisa estar na categoria Footage')
    status = cctv_status(project)
    original = _resolved(status.get('original_master') or (project.get('stats') or {}).get('original_master'))
    if not original:
        raise RuntimeError('Não há master original preservado para restaurar')
    current = db.get_project(project_id)
    stats = dict(current.get('stats') or {})
    stats['master'] = str(original)
    stats['original_master'] = str(original)
    stats['cctv_active'] = False
    db.update_project(project_id, stats=stats)
    return {
        'ok': True,
        'master': str(original),
        'original_master': str(original),
        'cctv_active': False,
    }
