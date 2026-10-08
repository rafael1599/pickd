#!/bin/sh
# PreToolUse(Bash): lo que toca prod o salta la compuerta se le pregunta a Rafael EN EL CHAT.
# Una instrucción en el prompt falla con el contexto lleno; este hook no (7 oct 2026).
# Casos: --no-verify, supabase db push contra el remoto, PROD_DB_URL, deploy de edge functions.
#
# 8 oct 2026 — Rafael: «no quiero que salgan confirmaciones, solo que me preguntes y todo lo
# podamos resolver en el chat». Antes devolvía "ask" (un pop-up); ahora niega con una
# instrucción para el agente: preguntar en el chat y, sólo con un sí de Rafael, repetir el
# comando con el prefijo PICKD_PROD_OK=1. El clasificador de auto mode (soft_deny en
# ~/.claude/settings.json) sigue de segunda capa: busca ese sí en la conversación.
exec python3 -c '
import json, re, sys

cmd = json.load(sys.stdin).get("tool_input", {}).get("command", "")
rules = [
    (r"--no-verify(?![-\w])", "salta la compuerta pre-push / pre-commit"),
    (r"supabase\s+db\s+push(?![^;&|]*--local)", "aplica migraciones a la base remota"),
    (r"PROD_DB_URL", "usa la conexión directa a la base de producción"),
    (r"supabase\s+functions\s+deploy", "despliega una edge function a producción"),
]
hits = [why for pat, why in rules if re.search(pat, cmd)]
if hits and not re.match(r"\s*PICKD_PROD_OK=1\s", cmd):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": (
            "Prod: " + "; ".join(hits) + ". No lo ejecutes todavía: pregúntale a Rafael en el "
            "chat qué vas a hacer y por qué. Sólo si responde que sí en el chat, repite el "
            "mismo comando con el prefijo PICKD_PROD_OK=1 al inicio. Nunca pongas el prefijo "
            "sin ese sí explícito."
        ),
    }}))
'
