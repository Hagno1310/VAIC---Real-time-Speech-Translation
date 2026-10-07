"""Local NMT via an OpenAI-compatible chat endpoint (Ollama/vLLM serving SeaLLM).

Mirrors CloudNMTProvider, but points the (already OpenAI-shaped) groq_client at a
local server instead of Groq. Used in `mode=offline` when `nmt_engine == "seallm"`
(see factory.py). The strict "return only the translation" prompt from
groq_client is reused unchanged so a chat model does not add explanations.

Set up the server first, e.g. with Ollama:
    ollama create seallm-v3 -f Modelfile        # FROM ./SeaLLMs-v3-7B-Chat.Q4_K_M.gguf
Then in .env:
    DEFAULT_MODE=offline
    NMT_ENGINE=seallm
    LOCAL_NMT_API_URL=http://localhost:11434/v1
    LOCAL_NMT_MODEL=seallm-v3
"""
from __future__ import annotations

import logging

from ..core.config import settings
from .base import NMTProvider

log = logging.getLogger("providers.local_nmt")


class LocalNMTProvider(NMTProvider):
    """NMT via a local OpenAI-compatible chat server (e.g. Ollama + SeaLLM)."""

    name = "local-nmt"

    def __init__(self) -> None:
        self._url = settings.local_nmt_api_url
        self._model = settings.local_nmt_model
        self._key = settings.local_nmt_api_key
        log.info(
            "LocalNMTProvider constructed (url=%s, model=%s).", self._url, self._model
        )

    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        """Authoritative translation (audio.chunk / text.final)."""
        from . import groq_client

        return await groq_client.translate_text(
            self._key,
            self._url,
            self._model,
            text,
            source_lang,
            target_lang,
        )
