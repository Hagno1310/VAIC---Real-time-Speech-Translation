"""Per-language Faster-Whisper STT: PhoWhisper (VinAI) for VI, Whisper for EN.

PhoWhisper is a Vietnamese-only fine-tune of Whisper (VinAI, 844h VN speech), so
it cannot cover English. This provider mirrors the sherpa per-language dispatch
pattern (one model per language code) but reuses the existing WhisperEngine:
  * source_lang "vi" -> PhoWhisper CTranslate2 model (settings.phowhisper_model_dir)
  * source_lang "en" -> standard Faster-Whisper model (settings.whisper_en_model)

Both engines share settings.stt_device / stt_compute_type (set "cuda"/"float16"
on a GPU). Models load lazily on first use and are cached process-wide by
get_engine, so constructing the provider is cheap.

Like the cloud Whisper path, PhoWhisper hallucinates canned phrases on silence,
so the same is_silence() / looks_like_hallucination() guards are applied here.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

from ..core.audio_utils import is_silence, looks_like_hallucination, speech_only
from ..core.config import settings
from .base import STTProvider, STTResult

log = logging.getLogger("providers.phowhisper")


class PhoWhisperSTTProvider(STTProvider):
    """Local STT routing VI -> PhoWhisper, EN -> Whisper (per-language)."""

    name = "phowhisper-stt"

    def __init__(self) -> None:
        # The heavy models load on first transcribe (cached by get_engine), so
        # constructing the provider is cheap. Resolve the VI model dir up front
        # to fail early with a clear message if it is unset.
        self._device = settings.stt_device
        self._compute_type = settings.stt_compute_type
        self._vi_model = settings.phowhisper_model_dir
        self._en_model = settings.whisper_en_model
        log.info(
            "PhoWhisperSTTProvider constructed (vi=%s, en=%s, device=%s, compute=%s; "
            "models load on first use).",
            self._vi_model,
            self._en_model,
            self._device,
            self._compute_type,
        )

    @staticmethod
    def _norm_lang(lang: str | None) -> str:
        """Normalize a language hint to a bare 2-letter code (e.g. 'vi').

        Per-language models cannot auto-detect, so 'auto'/empty is rejected — the
        session must speak its configured language.
        """
        if not lang or lang == "auto":
            raise ValueError(
                "phowhisper STT needs an explicit source language ('vi' or 'en'); "
                "'auto' is unsupported because each language is a separate model."
            )
        return lang.strip().lower().split("-")[0]

    def _engine(self, code: str):
        """Return the cached WhisperEngine for language `code`."""
        from .whisper_engine import get_engine

        if code == "vi":
            if not self._vi_model:
                raise RuntimeError(
                    "PhoWhisper model chưa sẵn sàng — chạy tools/prepare_phowhisper.py "
                    "và set PHOWHISPER_MODEL_DIR trong .env."
                )
            model = self._vi_model
        else:
            # Any non-VI language falls back to the standard Whisper model.
            model = self._en_model
        return get_engine(
            model_size=model, device=self._device, compute_type=self._compute_type
        )

    async def transcribe(
        self, audio: bytes, source_lang: str
    ) -> AsyncIterator[STTResult]:
        """Transcribe one push-to-talk WAV chunk to a single final result.

        Audio is expected as 16 kHz / 16-bit mono PCM WAV (what the recording
        tool and a browser MediaRecorder->WAV step produce).
        """
        code = self._norm_lang(source_lang)

        # Guard: never send a silent/too-short window to Whisper — it hallucinates
        # ("Thank you.", "Ghiền Mì Gõ", ...) on silence, polluting the transcript.
        # Done before importing/loading the model so silence is cheap.
        if is_silence(audio):
            yield STTResult(text="", lang=code, is_final=True)
            return
        # Send Whisper ONLY detected human speech — noise alone becomes canned text.
        audio = await asyncio.to_thread(speech_only, audio)
        if audio is None:
            yield STTResult(text="", lang=code, is_final=True)
            return

        import io

        import numpy as np
        import soundfile as sf

        engine = self._engine(code)
        log.info("PhoWhisperSTTProvider transcribing %d bytes as %s.", len(audio), code)

        # Decode WAV bytes -> float32 mono array (blocking work off the loop).
        data, _sr = await asyncio.to_thread(
            sf.read, io.BytesIO(audio), dtype="float32"
        )
        if data.ndim > 1:
            data = data.mean(axis=1)  # downmix to mono

        result = await asyncio.to_thread(
            engine.transcribe_array, np.asarray(data, dtype="float32"), code
        )
        text = result.text
        # Backstop: drop a transcript that is exactly a canned hallucination.
        if looks_like_hallucination(text):
            log.info("Dropped likely STT hallucination: %r", text)
            text = ""
        yield STTResult(text=text, lang=code, is_final=True)
