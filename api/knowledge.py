"""Carrega a base de conhecimento oficial da Korczak AI."""

import json
from pathlib import Path

KNOWLEDGE_PATH = Path(__file__).resolve().parent.parent / "DB" / "KNOWLEDGE" / "empresa.json"


def load_knowledge():
    try:
        with KNOWLEDGE_PATH.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return {}


def knowledge_prompt():
    data = load_knowledge()
    if not data:
        return "BASE DE CONHECIMENTO EMPRESARIAL: indisponível. Não invente informações empresariais."

    return (
        "BASE OFICIAL DE CONHECIMENTO DA KORCZAK AI:\n"
        + json.dumps(data, ensure_ascii=False, indent=2)
        + "\n\nREGRAS DA BASE DE CONHECIMENTO:\n"
        + str(data.get("instructions", "Não invente informações ausentes."))
    )
