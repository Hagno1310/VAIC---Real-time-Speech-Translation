"""Edge-TTS provider: Microsoft online neural voices (free, no API key).

Synthesizes audio SERVER-SIDE so any client (web console, mobile app) just plays
the returned base64 MP3 — no device/browser TTS voice needed. This is what makes
Vietnamese audio work everywhere, including React Native (via expo-av).

Docs: https://github.com/rany2/edge-tts
"""
from __future__ import annotations

import base64
import logging

from ..core.config import settings
from .base import TTSProvider

log = logging.getLogger("providers.tts_edge")

_ATTEMPTS = 4


class EdgeTTSProvider(TTSProvider):
    """TTS via edge-tts online neural voices; returns base64-encoded MP3."""

    name = "edge-tts"

    def _voice(self, lang: str) -> str:
        """Map a language code to a configured neural voice."""
        return settings.edge_voice_vi if (lang or "").lower().startswith("vi") else settings.edge_voice_en

    async def synthesize(self, text: str, lang: str) -> str:
        """Synthesize `text` in `lang` to base64 MP3 via edge-tts.

        The Microsoft endpoint intermittently answers with no audio
        (`NoAudioReceived`) for the same text that works on the next try, so
        retry a couple of times before giving up on the clip.
        """
        import asyncio

        import edge_tts

        voice = self._voice(lang)
        last: Exception | None = None
        for attempt in range(_ATTEMPTS):
            try:
                audio = bytearray()
                async for chunk in edge_tts.Communicate(text, voice).stream():
                    if chunk.get("type") == "audio":
                        audio.extend(chunk.get("data", b""))
                if audio:
                    return base64.b64encode(bytes(audio)).decode("ascii")
                last = RuntimeError("empty audio")
            except Exception as exc:  # noqa: BLE001 - flaky service, retry
                last = exc
            log.info("edge-tts attempt %d/%d failed (voice=%s): %s", attempt + 1, _ATTEMPTS, voice, last)
            await asyncio.sleep(0.2 * (attempt + 1))
        raise RuntimeError(f"edge-tts returned no audio after {_ATTEMPTS} tries (voice={voice}): {last}")
