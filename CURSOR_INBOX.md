# Cursor → Promptera (sem API OpenAI no app)

## Papéis

| Quem | Faz |
|------|-----|
| **Cursor** | Escreve roteiro + `takes.json` (regras Continuity da skill) |
| **Promptera** | Importa da pasta inbox, fila GPU, revisão, concat |

## Pasta de drop

```
C:\Projetos\Promptera-Studio\data\inbox\<slug>\
  meta.json      # opcional
  takes.json     # obrigatório
  roteiro.md     # opcional
```

O app importa sozinho (~5s) e move para `data/inbox/_processed/`.

### meta.json

```json
{
  "title": "Título da história",
  "slug": "meu_slug",
  "brief": "resumo",
  "model_pack": "sfw",
  "review_mode": "automatico",
  "enqueue": false
}
```

`model_pack`: `sfw` | `nsfw`  
`review_mode`: `automatico` | `com_revisao`

## Checklist do agente Cursor

1. Seguir skill `comfyui-h3-continuity` (NEW/CONTINUE, 1 ação/take, duração 2–15s)
2. Emitir `takes.json` no schema da skill
3. Criar pasta em `data/inbox/<slug>/` com os arquivos
4. Avisar o usuário: “já está no inbox — abra o Promptera e enfileire”

Não precisa chamar ChatGPT API pelo app.
