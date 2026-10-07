"""Abstract provider contracts for STT, NMT and TTS.

Every concrete backend (mock / cloud / offline) implements these interfaces.
The WebSocket handler only ever talks to these abstractions, so swapping a
provider NEVER requires touching the transport or UI code.

To plug a real model later, implement these same methods inside the
OfflineProvider (Faster-Whisper / NLLB / Piper) or CloudProvider.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass


@dataclass
class STTResult:
    """One transcription result emitted by an STT provider.

    `is_final=False` -> corresponds to a `stt.partial` websocket event.
    `is_final=True`  -> corresponds to a `stt.final` websocket event.
    """

    text: str
    lang: str
    is_final: bool = False


class STTProvider(ABC):
    """Speech-to-Text contract.

    `transcribe` is an async generator so real streaming engines can emit
    partial hypotheses before the final transcript. A minimal implementation
    may simply yield a single final result.
    """

    name: str = "base-stt"

    @abstractmethod
    async def transcribe(
        self, audio: bytes, source_lang: str
    ) -> AsyncIterator[STTResult]:
        """Yield partial results then exactly one final STTResult.

        Args:
            audio: Raw decoded audio bytes for one push-to-talk chunk.
            source_lang: BCP-47-ish language hint, e.g. "vi" or "en".
        """
        raise NotImplementedError
        yield  # pragma: no cover - marks this as an async generator


class NMTProvider(ABC):
    """Neural Machine Translation contract."""

    name: str = "base-nmt"

    @abstractmethod
    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        """Translate `text` from `source_lang` to `target_lang`."""
        raise NotImplementedError



class TTSProvider(ABC):
    """Text-to-Speech contract."""

    name: str = "base-tts"

    @abstractmethod
    async def synthesize(self, text: str, lang: str) -> str:
        """Return base64-encoded audio for `text` in `lang`."""
        raise NotImplementedError
