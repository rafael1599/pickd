#!/bin/sh
# PreToolUse(Bash): lo que toca prod o salta la compuerta pide confirmación a Rafael.
# Una instrucción en el prompt falla con el contexto lleno; este hook no (7 oct 2026).
# Casos: --no-verify, supabase db push contra el remoto, PROD_DB_URL, deploy de edge functions.
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
if hits:
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "ask",
        "permissionDecisionReason": "Prod: " + "; ".join(hits),
    }}))
'
