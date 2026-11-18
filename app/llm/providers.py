from __future__ import annotations

import json
import re
from typing import Any, Protocol

import httpx

from .. import db


class RateLimited(RuntimeError):
    """The provider asked us to wait. ``wait_sec`` is how long to pause."""

    def __init__(self, wait_sec: float) -> None:
        self.wait_sec = wait_sec
        super().__init__(f"Limite da API. Aguardando {int(wait_sec)}s.")


def retry_after_seconds(headers: Any, *, default: float = 60.0) -> float:
    """NVIDIA's free window is about 20 calls a minute. Without Retry-After, wait one window."""
    raw = ""
    if headers is not None:
        getter = getattr(headers, "get", None)
        raw = getter("retry-after") if getter else ""
    try:
        seconds = float(raw)
    except (TypeError, ValueError):
        seconds = default
    return max(1.0, min(seconds, 120.0))


def nvidia_endpoint(base_url: str, model: str) -> bool:
    host = (base_url or "").lower()
    name = (model or "").lower()
    return "integrate.api.nvidia.com" in host or "nemotron" in name


class LLMProvider(Protocol):
    async def chat_json(
        self, system: str, user: str, schema_hint: dict | None = None,
        *, temperature: float = 0.8, max_tokens: int | None = None,
    ) -> dict: ...

    async def chat_text(
        self, system: str, user: str, *, temperature: float = 0.8, max_tokens: int | None = None,
    ) -> str: ...


def _extract_json(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if not text:
        raise ValueError("Resposta vazia da IA")
    # strip markdown fences
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        start = text.find("[")
        end = text.rfind("]")
        if start >= 0 and end > start:
            arr = json.loads(text[start : end + 1])
            return {"items": arr}
        raise


class OpenAICompatibleProvider:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout: float = 180.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key or ""
        self.model = model
        self.timeout = timeout

    async def chat_text(
        self, system: str, user: str, *, temperature: float = 0.8, max_tokens: int | None = None,
    ) -> str:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
        }
        if max_tokens:
            body["max_tokens"] = max_tokens
        # Nemotron spends the token budget on reasoning_content and returns
        # content=null. The script has to land in content.
        if nvidia_endpoint(self.base_url, self.model):
            body["chat_template_kwargs"] = {"enable_thinking": False}
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/chat/completions", headers=headers, json=body)
            if r.status_code == 429:
                raise RateLimited(retry_after_seconds(r.headers))
            r.raise_for_status()
            data = r.json()
        message = data["choices"][0]["message"] or {}
        content = message.get("content") or ""
        if not str(content).strip() and message.get("reasoning_content"):
            raise ValueError("A IA devolveu só o raciocínio e o texto final veio vazio")
        return content

    async def chat_json(
        self, system: str, user: str, schema_hint: dict | None = None,
        *, temperature: float = 0.8, max_tokens: int | None = None,
    ) -> dict:
        hint = ""
        if schema_hint:
            hint = (
                "\n\nResponda APENAS com JSON válido seguindo este formato:\n"
                + json.dumps(schema_hint, ensure_ascii=False, indent=2)
            )
        text = await self.chat_text(
            system, user + hint, temperature=temperature, max_tokens=max_tokens,
        )
        return _extract_json(text)


class OllamaProvider:
    def __init__(self, *, base_url: str, model: str, timeout: float = 300.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout

    async def chat_text(
        self, system: str, user: str, *, temperature: float = 0.8, max_tokens: int | None = None,
    ) -> str:
        options: dict[str, Any] = {"temperature": temperature}
        if max_tokens:
            options["num_predict"] = max_tokens
        body = {
            "model": self.model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "options": options,
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/api/chat", json=body)
            r.raise_for_status()
            data = r.json()
        return data.get("message", {}).get("content") or ""

    async def chat_json(
        self, system: str, user: str, schema_hint: dict | None = None,
        *, temperature: float = 0.8, max_tokens: int | None = None,
    ) -> dict:
        hint = ""
        if schema_hint:
            hint = (
                "\n\nResponda APENAS com JSON válido seguindo este formato:\n"
                + json.dumps(schema_hint, ensure_ascii=False, indent=2)
            )
        text = await self.chat_text(
            system, user + hint, temperature=temperature, max_tokens=max_tokens,
        )
        return _extract_json(text)


class AnthropicProvider:
    def __init__(
        self, *, api_key: str, model: str, timeout: float = 180.0
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    async def chat_text(
        self, system: str, user: str, *, temperature: float = 0.8, max_tokens: int | None = None,
    ) -> str:
        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
        }
        body = {
            "model": self.model,
            "max_tokens": max_tokens or 8192,
            "temperature": temperature,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(
                "https://api.anthropic.com/v1/messages", headers=headers, json=body
            )
            r.raise_for_status()
            data = r.json()
        parts = data.get("content") or []
        return "".join(p.get("text", "") for p in parts if p.get("type") == "text")

    async def chat_json(
        self, system: str, user: str, schema_hint: dict | None = None,
        *, temperature: float = 0.8, max_tokens: int | None = None,
    ) -> dict:
        hint = ""
        if schema_hint:
            hint = (
                "\n\nResponda APENAS com JSON válido seguindo este formato:\n"
                + json.dumps(schema_hint, ensure_ascii=False, indent=2)
            )
        text = await self.chat_text(
            system, user + hint, temperature=temperature, max_tokens=max_tokens,
        )
        return _extract_json(text)


def llm_config() -> dict[str, Any]:
    cfg = db.get_setting("llm") or {}
    if not isinstance(cfg, dict):
        cfg = {}
    return cfg


def get_provider() -> LLMProvider:
    cfg = llm_config()
    provider = (cfg.get("provider") or "openai").lower()
    model = cfg.get("model") or "gpt-4o-mini"
    api_key = cfg.get("api_key") or ""
    base_url = cfg.get("base_url") or ""

    if provider == "openai":
        return OpenAICompatibleProvider(
            base_url=base_url or "https://api.openai.com/v1",
            api_key=api_key,
            model=model,
        )
    if provider in {"openai_compatible", "compatible", "lmstudio", "local"}:
        if not base_url:
            raise RuntimeError("base_url obrigatório para provedor OpenAI-compatible")
        return OpenAICompatibleProvider(
            base_url=base_url, api_key=api_key, model=model
        )
    if provider == "ollama":
        return OllamaProvider(
            base_url=base_url or "http://127.0.0.1:11434",
            model=model or "gemma3:12b",
        )
    if provider == "anthropic":
        if not api_key:
            raise RuntimeError("api_key obrigatória para Anthropic")
        return AnthropicProvider(api_key=api_key, model=model or "claude-sonnet-4-20250514")
    raise RuntimeError(f"Provedor desconhecido: {provider}")


async def test_provider(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    if cfg:
        prev = llm_config()
        db.set_setting("llm", {**prev, **cfg})
    try:
        provider = get_provider()
        text = await provider.chat_text(
            "You are a ping test. Reply with exactly: OK",
            "ping",
        )
        return {"ok": True, "reply": (text or "")[:200]}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
