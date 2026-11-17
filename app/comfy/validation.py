from __future__ import annotations

from typing import Any

import httpx


def correction_hint(kind: str, input_name: str = '', detail: str = '') -> str:
    text = f'{kind} {input_name} {detail}'.lower()
    if any(word in text for word in ('unet_name', 'clip_name', 'vae_name', 'ckpt_name', 'lora_name')):
        return ('Abra Configurações → ComfyUI → Modelos MiniMax H3, baixe o modelo faltante '
                'do pacote usado e confira o destino exibido. Se já estiver instalado, confira a pasta '
                'do ComfyUI configurada e reinicie o ComfyUI para atualizar a lista.')
    if any(word in text for word in ('dasiwa', 'minimaxh3director')):
        return ('Instale/atualize ComfyUI-DaSiWa-Nodes na seção ComfyUI das configurações, '
                'instale as dependências dele no ambiente Python do ComfyUI e reinicie o ComfyUI. '
                'Se persistir, confira os erros de importação no terminal.')
    if 'value_not_in_list' in text or 'required_input_missing' in text:
        return 'Atualize o ComfyUI e os custom nodes, reinicie e confira se a versão do workflow é compatível.'
    return ('Confira a entrada indicada e as conexões do workflow; atualize o ComfyUI e os nodes '
            'envolvidos e reinicie. Consulte o terminal do ComfyUI se o problema persistir.')


def describe_rejection(detail: Any, prompt: dict) -> str:
    """Preserve server diagnostics and attach actionable, error-specific guidance."""
    lines = []
    if isinstance(detail, dict):
        error = detail.get('error')
        if error:
            lines.append(str(error))
            if isinstance(error, dict):
                lines.append('Como corrigir: ' + correction_hint(
                    str(error.get('extra_info', {}).get('class_type', ''))
                    if isinstance(error.get('extra_info'), dict) else '', detail=str(error)))
        for node_id, node in (detail.get('node_errors') or {}).items():
            if not isinstance(node, dict):
                lines.append(f'Node {node_id}: {node}')
                continue
            kind = node.get('class_type') or prompt.get(str(node_id), {}).get('class_type', str(node_id))
            for error in node.get('errors') or []:
                extra = (error.get('extra_info') or {}) if isinstance(error, dict) else {}
                name = extra.get('input_name', '') if isinstance(extra, dict) else ''
                lines.append(f'{kind} (node {node_id}): {error}')
                lines.append('Como corrigir: ' + correction_hint(kind, name, str(error)))
    if not lines:
        lines = [str(detail), 'Como corrigir: ' + correction_hint('', detail=str(detail))]
    return '\n'.join(lines)


def validate_prompt(prompt: dict, catalog: dict) -> list[str]:
    """Check loaded nodes and their advertised inputs without queuing a render."""
    errors = []
    for node_id, node in prompt.items():
        kind = node['class_type']
        info = catalog.get(kind)
        if not info:
            errors.append(f'Node {kind} não carregado no ComfyUI. Como corrigir: ' + correction_hint(kind))
            continue
        schema = info.get('input', {})
        inputs = node.get('inputs', {})
        for name in schema.get('required', {}):
            if name not in inputs:
                errors.append(f'{kind}: entrada obrigatória {name} ausente; versão incompatível. Como corrigir: ' + correction_hint(kind, name, 'required_input_missing'))
        for name, spec in {**schema.get('required', {}), **schema.get('optional', {})}.items():
            value = inputs.get(name)
            if name not in inputs or isinstance(value, list):
                continue
            choices = spec[0] if spec else None
            if isinstance(choices, list) and value not in choices:
                errors.append(f'{kind}.{name}: {value!r} não disponível no ComfyUI. Como corrigir: ' + correction_hint(kind, name, 'value_not_in_list'))
    return errors


async def check_runtime(project: dict[str, Any] | None = None) -> dict:
    # Local import avoids the setup/client/runner import cycle.
    from ..continuity.runner import ContinuityRunner

    runner = ContinuityRunner.__new__(ContinuityRunner)
    from ..config import MODELS_SFW, MODELS_NSFW
    from .client import ComfyClient

    pack_name = (project or {}).get('model_pack', 'sfw')
    pack = MODELS_NSFW if pack_name == 'nsfw' else MODELS_SFW
    runner.unet = str(pack['unet']).replace('/', '\\')
    runner.clip, runner.vae_v, runner.vae_a = pack['clip'], pack['vae_v'], pack['vae_a']
    runner.width = int((project or {}).get('width') or 640)
    runner.height = int((project or {}).get('height') or 640)
    runner.steps = int((project or {}).get('steps') or 20)
    prompt = runner.build_prompt(director_prompt='', timeline_data='{}', filename_prefix='preflight', seed=0, duration=5.0)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(f'{ComfyClient().base}/object_info')
            response.raise_for_status()
            errors = validate_prompt(prompt, response.json())
    except (httpx.HTTPError, ValueError) as exc:
        errors = [f'Não foi possível verificar o ComfyUI em execução: {exc}. Inicie o ComfyUI e confira o endereço e a porta nas configurações.']
    return {'ok': not errors, 'errors': errors, 'model_pack': pack_name}
