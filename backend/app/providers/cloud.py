"""Cloud providers: STT + NMT via Groq, TTS stub. Fall back to Mock when no key.

STT (Whisper) and NMT (Qwen chat) run on Groq's OpenAI-compatible API. Each stage
uses its own key if set (`GROQ_STT_API_KEY` / `GROQ_NMT_API_KEY`) so rate limits
can be split, otherwise the shared `GROQ_API_KEY`. If no key is configured, the
provider transparently falls back to the corresponding MockProvider so the demo
never breaks.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

from ..core.audio_utils import is_silence, looks_like_hallucination, speech_only
from ..core.config import settings
from .base import NMTProvider, STTProvider, STTResult, TTSProvider
from .mock import MockNMTProvider, MockSTTProvider, MockTTSProvider

log = logging.getLogger("providers.cloud")


class CloudSTTProvider(STTProvider):
    """STT via Groq Whisper, or Mock fallback when no key is configured."""

    name = "cloud-stt"

    def __init__(self) -> None:
        self._fallback = MockSTTProvider()
        # Dedicated STT key if set, else the shared key (rate-limit split).
        self._key = settings.groq_stt_api_key or settings.groq_api_key
        self._enabled = bool(self._key)
        if not self._enabled:
            log.warning(
                "GROQ_STT_API_KEY/GROQ_API_KEY not set -> CloudSTTProvider falls back to mock."
            )

    async def transcribe(
        self, audio: bytes, source_lang: str
    ) -> AsyncIterator[STTResult]:
        """Transcribe via Groq Whisper, or delegate to the mock provider."""
        if not self._enabled:
            async for result in self._fallback.transcribe(audio, source_lang):
                yield result
            return

        # Guard: never send a silent/too-short window to Whisper — it hallucinates
        # ("Thank you.", "Let's go!", ...) on silence, polluting the transcript.
        if is_silence(audio):
            yield STTResult(text="", lang=source_lang, is_final=True)
            return
        # Send Whisper ONLY detected human speech — noise alone becomes canned text.
        audio = await asyncio.to_thread(speech_only, audio)
        if audio is None:
            yield STTResult(text="", lang=source_lang, is_final=True)
            return

        from . import groq_client

        text = await groq_client.transcribe_audio(
            self._key or "",
            settings.groq_api_url,
            settings.groq_stt_model,
            audio,
            "audio/wav",
            source_lang,
        )
        # Backstop: drop a transcript that is exactly a canned hallucination.
        if looks_like_hallucination(text):
            log.info("Dropped likely STT hallucination: %r", text)
            text = ""
        yield STTResult(text=text, lang=source_lang, is_final=True)


class CloudNMTProvider(NMTProvider):
    """NMT via a Groq chat model, or Mock fallback when no key is configured."""

    name = "cloud-nmt"

    def __init__(self) -> None:
        self._fallback = MockNMTProvider()
        # Dedicated NMT key if set, else the shared key (rate-limit split).
        self._key = settings.groq_nmt_api_key or settings.groq_api_key
        self._enabled = bool(self._key)
        if not self._enabled:
            log.warning(
                "GROQ_NMT_API_KEY/GROQ_API_KEY not set -> CloudNMTProvider falls back to mock."
            )

    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        """Translate via a Groq chat model (both directions), or the mock."""
        if not self._enabled:
            return await self._fallback.translate(text, source_lang, target_lang)

        from . import groq_client

        return await groq_client.translate_text(
            self._key or "",
            settings.groq_api_url,
            settings.groq_nmt_model,
            text,
            source_lang,
            target_lang,
        )



class CloudTTSProvider(TTSProvider):
    """TTS via an external API, or Mock fallback when no key is configured."""

    name = "cloud-tts"

    def __init__(self) -> None:
        self._fallback = MockTTSProvider()
        self._enabled = bool(settings.tts_api_key)
        if not self._enabled:
            log.warning("TTS_API_KEY not set -> CloudTTSProvider falls back to mock.")

    async def synthesize(self, text: str, lang: str) -> str:
        """Synthesize via cloud API, or delegate to the mock provider."""
        if not self._enabled:
            return await self._fallback.synthesize(text, lang)

        # ------------------------------------------------------------------
        # TODO(cloud-tts): Call your TTS vendor here (ElevenLabs, Google,
        #   Azure, ...). Return base64-encoded audio.
        # ------------------------------------------------------------------
        raise NotImplementedError(
            "CloudTTSProvider: wire up your TTS vendor (TTS_API_URL)."
        )
