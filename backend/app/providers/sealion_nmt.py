"""NMT via AI Singapore's SEA-LION v4 (hosted SEA-LION API).

SEA-LION is pretrained/instruct-tuned on South-East Asian languages, so it
handles Vietnamese noticeably better than a generic chat model. The API is
OpenAI-compatible, so `groq_client`'s request/response helpers — including the
strict "return only the translation" prompt — are reused unchanged.

Selected with `NMT_ENGINE=sealion` in either `mode=offline` (replacing NLLB) or
`mode=cloud` (replacing the Groq chat NMT, keeping Groq Whisper for STT).

    NMT_ENGINE=sealion
    SEALION_API_KEY=...            # free key from https://playground.sea-lion.ai
    SEALION_MODEL=aisingapore/Qwen-SEA-LION-v4.5-27B-IT

Unlike the NLLB/SeaLLM engines this is a NETWORK call, so `mode=offline` is no
longer literally offline when it is enabled. The hosted free tier is also
rate-limited (~10 req/min); point `SEALION_API_URL` at a self-hosted
Ollama/vLLM serving a SEA-LION v4 GGUF to avoid that.
"""
from __future__ import annotations

import logging

from ..core.config import settings
from .base import NMTProvider

log = logging.getLogger("providers.sealion_nmt")


class SeaLionNMTProvider(NMTProvider):
    """NMT via the SEA-LION v4 OpenAI-compatible chat API."""

    name = "sealion-nmt"

    def __init__(self) -> None:
        self._url = settings.sealion_api_url
        self._model = settings.sealion_model
        self._key = settings.sealion_api_key
        if not self._key:
            # Self-hosted OpenAI-compatible servers ignore auth, so a missing key
            # is only fatal for the hosted API — let the first call surface it.
            log.warning(
                "SEALION_API_KEY is not set; requests to %s will fail unless the "
                "endpoint is a self-hosted server that ignores auth.",
                self._url,
            )
        log.info(
            "SeaLionNMTProvider constructed (url=%s, model=%s).", self._url, self._model
        )

    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        """Authoritative translation (audio.chunk / text.final)."""
        from . import groq_client

        return await groq_client.translate_text(
            self._key or "",
            self._url,
            self._model,
            text,
            source_lang,
            target_lang,
        )
