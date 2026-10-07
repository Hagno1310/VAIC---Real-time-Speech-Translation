"""Offline providers: empty stubs reserved for local models.

These intentionally raise NotImplementedError. Replace the bodies with local
inference:
  * OfflineSTTProvider -> Faster-Whisper
  * OfflineNMTProvider -> NLLB (No Language Left Behind)
  * OfflineTTSProvider -> Piper

Load the heavy models ONCE (e.g. in __init__ or a lazy loader) and keep them in
memory; do not reload per request.
"""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from .base import NMTProvider, STTProvider, STTResult, TTSProvider

log = logging.getLogger("providers.offline")


class OfflineSTTProvider(STTProvider):
    """Local STT via Faster-Whisper (shared WhisperEngine)."""

    name = "offline-stt"

    def __init__(self, model_size: str | None = None) -> None:
        # The heavy model is loaded lazily on first transcribe and cached by
        # get_engine, so constructing the provider is cheap. Size/device/precision
        # come from settings so a GPU box can run large-v3 + float16 for accuracy.
        from ..core.config import settings
        from .whisper_engine import get_engine

        self._engine = get_engine(
            model_size=model_size or settings.stt_model_size,
            device=settings.stt_device,
            compute_type=settings.stt_compute_type,
        )
        log.info(
            "OfflineSTTProvider constructed size=%s device=%s compute=%s "
            "(model loads on first use).",
            model_size or settings.stt_model_size,
            settings.stt_device,
            settings.stt_compute_type,
        )

    async def transcribe(
        self, audio: bytes, source_lang: str
    ) -> AsyncIterator[STTResult]:
        """Transcribe 16 kHz / 16-bit mono PCM WAV bytes to a final result.

        The audio.chunk payload is expected to be a mono 16-bit PCM WAV at
        16 kHz (what the recording tool and a browser MediaRecorder->WAV step
        produce). For other/compressed formats, decode via ffmpeg/PyAV first.
        """
        import asyncio
        import io

        import numpy as np
        import soundfile as sf

        log.info("OfflineSTTProvider transcribing %d bytes.", len(audio))
        # Decode WAV bytes -> float32 mono array (blocking work off the loop).
        data, sr = await asyncio.to_thread(sf.read, io.BytesIO(audio), dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)  # downmix to mono
        # TODO(offline-stt): resample here if sr != 16000 (e.g. via soxr/librosa).

        result = await asyncio.to_thread(
            self._engine.transcribe_array, np.asarray(data, dtype="float32"), source_lang
        )
        yield STTResult(text=result.text, lang=result.language, is_final=True)


class OfflineNMTProvider(NMTProvider):
    """Local NMT via CTranslate2 int8 + NLLB-200 (see providers/ct2_nmt.py)."""

    name = "offline-nmt"

    def __init__(self) -> None:
        from ..core.config import settings

        self._dir = settings.offline_nmt_model_dir
        self._threads = settings.offline_nmt_intra_threads
        self._beam_final = settings.offline_nmt_beam_final
        self._device = settings.offline_nmt_device
        self._compute_type = settings.offline_nmt_compute_type
        log.info(
            "OfflineNMTProvider constructed device=%s compute=%s beam=%d "
            "(model loads on first use).",
            self._device,
            self._compute_type,
            self._beam_final,
        )

    def _require_dir(self) -> str:
        if not self._dir:
            raise RuntimeError(
                "Offline NMT model chưa sẵn sàng — chạy tools/prepare_nllb.py "
                "và set OFFLINE_NMT_MODEL_DIR trong .env."
            )
        return self._dir

    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        """Authoritative translation of the whole segment (beam search).

        No sentence-splitting: the client streams short VAD segments (dịch từng
        cụm, đuổi theo giọng), and splitting on "." would break decimals like
        "2.5" ("two point five"). Translating the segment as one unit keeps
        numbers intact.
        """
        import asyncio

        from .ct2_nmt import translate_one

        model_dir = self._require_dir()
        if not text or not text.strip():
            return ""
        return await asyncio.to_thread(
            translate_one,
            model_dir,
            self._threads,
            text,
            source_lang,
            target_lang,
            self._beam_final,
            self._device,
            self._compute_type,
        )



class OfflineTTSProvider(TTSProvider):
    """Local TTS via Piper (shared PiperEngine), one voice per language.

    Used for BOTH cloud and offline sessions (TTS is decoupled from the STT/NMT
    mode in the factory), so the translated text always comes back as a real
    spoken clip in the target language.
    """

    name = "offline-tts"

    def __init__(self) -> None:
        # The heavy voice is loaded lazily on first synthesize and cached by
        # get_piper_engine, so constructing the provider is cheap.
        from ..core.config import settings
        from .piper_engine import get_piper_engine

        self._engine = get_piper_engine(
            models_dir=settings.piper_models_dir,
            length_scale=settings.piper_length_scale,
        )
        log.info("OfflineTTSProvider constructed (Piper voice loads on first use).")

    async def synthesize(self, text: str, lang: str) -> str:
        """Synthesize `text` in `lang` to base64-encoded WAV bytes."""
        import asyncio
        import base64

        log.info("OfflineTTSProvider synthesizing %d chars in %s.", len(text), lang)
        wav = await asyncio.to_thread(self._engine.synthesize, text, lang)
        return base64.b64encode(wav).decode("ascii")
