"""Async helpers over the Groq OpenAI-compatible REST API.

Shared by the cloud STT and NMT providers. Groq's free tier serves Whisper for
speech-to-text and chat LLMs (Qwen) for translation, behind `gsk_...` key(s).

Request-building and response-parsing helpers are pure functions (unit-testable
without network or a key); only `_transcribe`/`_chat` do I/O.

Docs: https://console.groq.com/docs/speech-to-text
      https://console.groq.com/docs/text-chat
"""
from __future__ import annotations

import logging

import httpx

log = logging.getLogger("providers.groq_client")

_TIMEOUT = 45.0
# Whisper segments with no_speech_prob at/above this are treated as noise.
NO_SPEECH_PROB_MAX = 0.5

# BCP-47-ish language code -> human-readable name used in translation prompts.
_LANG_NAMES = {"vi": "Vietnamese", "en": "English"}


def language_name(code: str) -> str:
    """Map a language code to a human-readable name for prompts."""
    return _LANG_NAMES.get((code or "").lower(), code or "the source language")


def build_translate_messages(text: str, source_lang: str, target_lang: str) -> list[dict]:
    """Build OpenAI-style chat messages for translating text (both directions).

    Basic, context-free translation prompt (no interpreter persona, no
    business-context or entity-preservation instructions).
    """
    src = language_name(source_lang)
    tgt = language_name(target_lang)
    system = (
        f"Translate the following {src} text into {tgt}. "
        "Return only the translation, with no explanations, notes, or quotes."
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": text},
    ]


def extract_transcript(response_json: dict) -> str:
    """Pull the transcript text out of an audio/transcriptions response."""
    if "error" in response_json:
        err = response_json["error"]
        msg = err.get("message", "unknown error") if isinstance(err, dict) else str(err)
        raise RuntimeError(f"Groq STT error: {msg}")
    segments = response_json.get("segments")
    if segments is not None:
        # verbose_json: drop segments Whisper itself rates as non-speech — that is
        # where noise-born hallucinations ("Ghiền Mì Gõ", outros) come from. All
        # dropped -> "" (silence, skipped by the handler), not an error.
        return " ".join(
            (s.get("text") or "").strip()
            for s in segments
            if s.get("no_speech_prob", 0.0) < NO_SPEECH_PROB_MAX
        ).strip()
    text = (response_json.get("text") or "").strip()
    if not text:
        raise RuntimeError("Groq STT returned empty text.")
    return text


def extract_chat_text(response_json: dict) -> str:
    """Pull the assistant's text out of a chat/completions response."""
    if "error" in response_json:
        err = response_json["error"]
        msg = err.get("message", "unknown error") if isinstance(err, dict) else str(err)
        raise RuntimeError(f"Groq chat error: {msg}")
    choices = response_json.get("choices") or []
    if not choices:
        raise RuntimeError("Groq chat returned no choices.")
    text = (choices[0].get("message", {}).get("content") or "").strip()
    if not text:
        raise RuntimeError("Groq chat returned empty content.")
    return text


async def _transcribe(
    api_key: str, base_url: str, model: str, audio: bytes, mime: str, source_lang: str
) -> dict:
    """POST audio to /audio/transcriptions (multipart) and return parsed JSON."""
    url = f"{base_url.rstrip('/')}/audio/transcriptions"
    data = {"model": model, "response_format": "verbose_json", "temperature": "0"}
    # "auto" / empty -> let Whisper detect the language.
    if source_lang and source_lang.lower() != "auto":
        data["language"] = source_lang.lower()
    files = {"file": ("audio.wav", audio, mime or "audio/wav")}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                url, headers={"Authorization": f"Bearer {api_key}"}, data=data, files=files
            )
    except httpx.HTTPError as e:
        raise RuntimeError(f"Groq STT request failed: {e}") from e
    if resp.status_code != 200:
        raise RuntimeError(f"Groq STT HTTP {resp.status_code}: {resp.text[:200]}")
    try:
        return resp.json()
    except ValueError as e:
        raise RuntimeError(f"Groq STT non-JSON body: {resp.text[:200]}") from e


async def _chat(api_key: str, base_url: str, model: str, messages: list[dict]) -> dict:
    """POST chat messages to /chat/completions and return parsed JSON."""
    url = f"{base_url.rstrip('/')}/chat/completions"
    payload = {"model": model, "messages": messages, "temperature": 0.0}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                url, headers={"Authorization": f"Bearer {api_key}"}, json=payload
            )
    except httpx.HTTPError as e:
        raise RuntimeError(f"Groq chat request failed: {e}") from e
    if resp.status_code != 200:
        raise RuntimeError(f"Groq chat HTTP {resp.status_code}: {resp.text[:200]}")
    try:
        return resp.json()
    except ValueError as e:
        raise RuntimeError(f"Groq chat non-JSON body: {resp.text[:200]}") from e


def spoken_in(response_json: dict, lang: str) -> bool | None:
    """Did Whisper hear `lang`? None when it detected a language we don't pair
    (unknown verdict — e.g. a short clip misdetected as Chinese)."""
    detected = (response_json.get("language") or "").strip().lower()
    names = {code: name.lower() for code, name in _LANG_NAMES.items()}
    if detected in (lang.lower(), names.get(lang.lower())):
        return True
    if detected in names or detected in names.values():
        return False
    return None


async def transcribe_audio(
    api_key: str, base_url: str, model: str, audio: bytes, mime: str, source_lang: str
) -> str:
    """Transcribe raw audio bytes to text via Groq Whisper — only speech that is
    actually IN `source_lang`.

    Whisper runs with language auto-detect first. Forcing the language made it
    "translate" any other-language audio into `source_lang`: in a shared room the
    speaker's mic picks up the PEER device reading the English translation aloud,
    which came back as fresh Vietnamese text, got translated and read again — an
    endless echo loop. Audio detected as the other paired language is dropped
    (""), so the speaker's own device only ever records the speaker's language.
    """
    if not source_lang or source_lang.lower() == "auto":
        return extract_transcript(await _transcribe(api_key, base_url, model, audio, mime, ""))
    raw = await _transcribe(api_key, base_url, model, audio, mime, "auto")
    match = spoken_in(raw, source_lang)
    if match is False:
        log.info("Dropped STT window spoken in %r (expected %s): %r",
                 raw.get("language"), source_lang, (raw.get("text") or "")[:80])
        return ""
    if match is None:  # odd detection: fall back to the forced-language transcript
        raw = await _transcribe(api_key, base_url, model, audio, mime, source_lang)
    return extract_transcript(raw)


async def translate_text(
    api_key: str, base_url: str, model: str, text: str, source_lang: str, target_lang: str
) -> str:
    """Translate text from source_lang to target_lang via a Groq chat model."""
    messages = build_translate_messages(text, source_lang, target_lang)
    return extract_chat_text(await _chat(api_key, base_url, model, messages))

