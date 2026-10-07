"""Audio guards to suppress Whisper hallucinations.

Whisper (and Groq's hosted Whisper) reliably *hallucinates* text on silence or
near-silent noise — classic outputs are "Thank you.", "Let's go!", "I don't hear
anything", or the Vietnamese "Ghiền Mì Gõ". In a streaming translator the client
sends many audio windows, some of which are silence; feeding those to STT injects
garbage into the transcript/history.

Root-cause fix: never send a silent/too-short window to STT. `is_silence()` parses
the WAV, measures RMS energy + duration, and reports whether it is below the
speech threshold. `looks_like_hallucination()` is a small exact-match backstop for
the handful of canned phrases Whisper emits on non-silent noise.
"""
from __future__ import annotations

import logging
import struct

from .config import settings

log = logging.getLogger("core.audio_utils")


def _parse_wav(wav: bytes) -> tuple[int, bytes] | None:
    """Return (sample_rate, pcm_data_bytes) for a 16-bit PCM WAV, or None.

    Returning None means "not a WAV I understand" — callers must treat that as
    'not silence' so real audio is never dropped on a parse miss.
    """
    if len(wav) < 44 or wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
        return None
    sample_rate = 16000
    data = b""
    i = 12
    n = len(wav)
    while i + 8 <= n:
        chunk_id = wav[i : i + 4]
        (size,) = struct.unpack("<I", wav[i + 4 : i + 8])
        body = wav[i + 8 : i + 8 + size]
        if chunk_id == b"fmt " and len(body) >= 16:
            (sample_rate,) = struct.unpack("<I", body[4:8])
        elif chunk_id == b"data":
            data = body
        i += 8 + size + (size & 1)  # chunks are word-aligned
    if not data:
        return None
    return sample_rate, data


def _rms_and_ms(sample_rate: int, pcm: bytes) -> tuple[float, float]:
    """Normalized RMS (0..1) and duration in ms for 16-bit mono PCM."""
    count = len(pcm) // 2
    if count == 0 or sample_rate <= 0:
        return 0.0, 0.0
    samples = struct.unpack(f"<{count}h", pcm[: count * 2])
    total = 0
    for s in samples:
        total += s * s
    rms = (total / count) ** 0.5 / 32768.0
    duration_ms = count / sample_rate * 1000.0
    return rms, duration_ms


def is_silence(wav: bytes) -> bool:
    """True if `wav` is below the speech-energy threshold or too short.

    Non-WAV / unparseable input returns False (never drop real audio on a miss).
    """
    parsed = _parse_wav(wav)
    if parsed is None:
        return False
    sample_rate, pcm = parsed
    rms, duration_ms = _rms_and_ms(sample_rate, pcm)
    if duration_ms < settings.stt_min_speech_ms:
        return True
    return rms < settings.stt_silence_rms


def speech_only(wav: bytes) -> bytes | None:
    """Keep only the human-speech parts of `wav` (Silero VAD); None = no speech.

    The energy gate cannot tell a fan, keyboard or room noise from a voice, and
    Groq Whisper turns pure noise into confident YouTube outros ("Cảm ơn các bạn
    đã theo dõi", no_speech_prob only ~0.2-0.45). So Whisper must only ever hear
    detected speech. Returns `wav` unchanged when VAD is unavailable (deploy
    image without faster-whisper) or the input is not 16 kHz PCM WAV.
    """
    parsed = _parse_wav(wav)
    if parsed is None or parsed[0] != 16000:
        return wav
    try:
        import numpy as np
        from faster_whisper.vad import VadOptions, get_speech_timestamps
    except ImportError:
        return wav
    audio = np.frombuffer(parsed[1][: len(parsed[1]) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0
    spans = get_speech_timestamps(
        audio,
        VadOptions(threshold=settings.stt_vad_threshold, min_silence_duration_ms=500, speech_pad_ms=200),
    )
    speech = np.concatenate([audio[s["start"] : s["end"]] for s in spans]) if spans else audio[:0]
    if len(speech) / 16000 * 1000 < settings.stt_min_speech_ms:
        return None
    pcm = (np.clip(speech, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    header = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt "
    header += struct.pack("<IHHIIHH", 16, 1, 1, 16000, 32000, 2, 16) + b"data" + struct.pack("<I", len(pcm))
    return header + pcm


# Exact phrases Whisper/Groq emit on non-silent noise (lowercased, punctuation
# stripped). Backstop only — the energy gate handles the common silence case.
_HALLUCINATION_PHRASES: frozenset[str] = frozenset(
    {
        "thank you",
        "thank you very much",
        "thanks for watching",
        "thank you for watching",
        "please subscribe",
        "you",
        "bye",
        "bye bye",
        "cảm ơn các bạn đã theo dõi",
        "hẹn gặp lại các bạn",
        "ghiền mì gõ",
        "hãy subscribe cho kênh",
        "ừ",
    }
)


# Multi-word markers distinctive enough to flag a transcript that merely CONTAINS
# them (Whisper pads them: "Hãy subscribe cho kênh Ghiền Mì Gõ Để không bỏ lỡ…").
# Never add short/common words here — that would drop real meeting speech.
_HALLUCINATION_MARKERS: tuple[str, ...] = (
    "ghiền mì gõ",
    "subscribe cho kênh",
    "đăng ký kênh",
    "video tiếp theo",
    "video hấp dẫn",
    "cảm ơn các bạn đã theo dõi",
    "thanks for watching",
    "thank you for watching",
    "like and subscribe",
)


def looks_like_hallucination(text: str) -> bool:
    """True if the transcript is a known canned hallucination."""
    norm = "".join(c for c in (text or "").lower().strip() if c.isalnum() or c.isspace())
    norm = " ".join(norm.split())
    return norm in _HALLUCINATION_PHRASES or any(m in norm for m in _HALLUCINATION_MARKERS)
