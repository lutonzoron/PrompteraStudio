from __future__ import annotations

import asyncio
import codecs
import json
import logging
import re
import time

from . import db
from .config import DATA_DIR


EVENT_LABELS = {
    "job_queued": "Geração adicionada à fila",
    "job_started": "Geração iniciada",
    "job_done": "Geração concluída",
    "job_failed": "Falha na geração",
    "job_cancelled": "Geração cancelada",
    "job_preempted": "Geração devolvida ao início da espera",
    "job_progress": "Progresso da geração",
    "review_needed": "Aguardando revisão do take",
    "review_submitted": "Revisão enviada",
    "worker_error": "Erro no worker",
    "inbox_pending": "Novo pacote na Inbox",
    "inbox_changed": "Inbox atualizada",
    "inbox_imported": "Pacote importado",
    "inbox_rejected": "Pacote rejeitado",
    "inbox_error": "Erro na Inbox",
    "external_sync": "Geração externa sincronizada",
    "external_sync_error": "Erro na sincronização externa",
    "project_updated": "Vídeo atualizado",
    "queue_changed": "Fila atualizada",
}


def log_event(event: dict) -> None:
    kind = event.get("type", "")
    if kind not in EVENT_LABELS:
        return
    message = EVENT_LABELS[kind]
    for key in ("message", "error", "title", "take", "decision", "status", "reason", "name", "completed", "total", "current_take"):
        value = event.get(key)
        if value is not None and value != "":
            message += f" · {key}: {value}"
    extra = event.get("extra") or {}
    for key in ("take", "total", "prompt_id", "master"):
        if extra.get(key) is not None:
            message += f" · {key}: {extra[key]}"
    db.add_log(message, source=kind, project_id=event.get("project_id"),
               level="error" if event.get("error") or kind.endswith(("_failed", "_error")) else "info")


ACTION_LABELS = {
    "prioritize": "Priorizar vídeo",
    "regenerate": "Regerar vídeo e substituir resultado atual",
    "footage-export": "Aplicar data/hora CCTV",
    "enqueue": "Enfileirar vídeo", "dequeue": "Remover vídeo da fila",
    "generate-story": "Gerar roteiro", "build-master": "Montar vídeo final",
    "review": "Revisar take", "restore": "Restaurar vídeo", "dice": "Sortear história",
    "start": "Iniciar ComfyUI", "interrupt": "Interromper ComfyUI",
    "clone": "Instalar ComfyUI", "dasiwa": "Instalar DaSiWa", "workflows": "Copiar workflows",
    "ensure": "Preparar ComfyUI", "download": "Baixar modelos", "source": "Salvar fonte do modelo",
    "pause": "Pausar fila", "resume": "Retomar fila", "reorder": "Reordenar fila",
    "approve": "Aprovar pacote", "reject": "Rejeitar pacote", "scan": "Verificar Inbox",
    "import-path": "Importar takes", "sync": "Sincronizar gerações externas",
    "test": "Testar IA", "llm": "Configurar IA", "machine": "Configurar máquina",
    "comfyui_root": "Configurar pasta do ComfyUI", "adapt": "Criar estilo",
    "duplicate": "Duplicar estilo",
}


class ActivityMiddleware:
    """Audit actions without retaining request bodies, credentials or generated scripts."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        method = scope.get("method", "")
        if scope["type"] != "http" or not path.startswith("/api/") or method not in {"POST", "PUT", "PATCH", "DELETE"}:
            return await self.app(scope, receive, send)
        match = re.match(r"^/api/projects/([^/]+)", path)
        project_id = match[1] if match and match[1] != "dice" else None
        tail = path.rstrip("/").rsplit("/", 1)[-1]
        if path == "/api/projects":
            action = "Criar vídeo"
        elif project_id and tail == project_id:
            action = "Arquivar/excluir vídeo" if method == "DELETE" else "Editar vídeo"
        else:
            action = ACTION_LABELS.get(tail, "Alterar estilo" if "/styles/" in path else "Ação")
        context = f"{action} · {method} {path}"
        db.add_log(f"Início: {context}", source="action", project_id=project_id)
        started = time.monotonic()
        status = 500
        body = bytearray()

        async def capture(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            elif message["type"] == "http.response.body" and len(body) < 65536:
                body.extend(message.get("body", b"")[:65536 - len(body)])
            await send(message)

        try:
            await self.app(scope, receive, capture)
        except Exception as exc:
            db.add_log(f"Falha: {context} · {exc}", level="error", source="action", project_id=project_id)
            raise
        else:
            try:
                result = json.loads(body)
            except (ValueError, UnicodeError):
                result = {}
            if not isinstance(result, dict):
                result = {}
            project = result.get("project") or {}
            if not isinstance(project, dict):
                project = {}
            if not project_id:
                project_id = project.get("id") or (result.get("id") if path == "/api/projects" else None)
            failed = status >= 400 or result.get("ok") is False
            detail = (result.get("detail") or result.get("error")) if failed else None
            message = f"{'Falha' if failed else 'Concluído'}: {context} · HTTP {status} · {time.monotonic() - started:.2f}s"
            if detail:
                message += f" · {detail}"
            elif isinstance(result.get("message"), str):
                message += f" · {result['message']}"
            db.add_log(message, level="error" if failed else "info", source="action", project_id=project_id)


class ActivityLogHandler(logging.Handler):
    def emit(self, record):
        try:
            db.add_log(self.format(record), level=record.levelname.lower(), source=record.name)
        except Exception:
            self.handleError(record)


async def watch_comfy_log() -> None:
    path = DATA_DIR / "comfyui.log"
    offset = path.stat().st_size if path.exists() else 0
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    pending = ""
    while True:
        try:
            if path.exists():
                if path.stat().st_size < offset:
                    offset = 0
                    pending = ""
                    decoder.reset()
                with path.open("rb") as stream:
                    stream.seek(offset)
                    chunk = stream.read(65536)
                    offset = stream.tell()
                text = pending + decoder.decode(chunk).replace("\r\n", "\n").replace("\r", "\n")
                lines = text.split("\n")
                pending = lines.pop()
                job = db.active_job() if lines else None
                for line in lines:
                    line = re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
                    if line:
                        level = "error" if "error" in line.lower() or "traceback" in line.lower() else "warning" if "[WARNING]" in line else "info"
                        db.add_log(line, source="ComfyUI", level=level,
                                   project_id=job.get("project_id") if job else None)
        except OSError as exc:
            logging.getLogger(__name__).warning("Falha ao ler log do ComfyUI: %s", exc)
        await asyncio.sleep(1)
