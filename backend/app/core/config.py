"""Application configuration loaded from environment / .env via pydantic-settings.

No secret is hard-coded here. All API keys and endpoints are read from the
environment. If a cloud key is missing, the CloudProvider transparently falls
back to the MockProvider (see providers/cloud.py).
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

from .env_file import ENV_PATH


class Settings(BaseSettings):
    """Runtime settings for the translator backend.

    Every field can be overridden with an environment variable of the same
    (case-insensitive) name, or via a `.env` file. See `.env.example`.
    """

    model_config = SettingsConfigDict(
        env_file=ENV_PATH,  # absolute: next to the exe / in backend/
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Server -----------------------------------------------------------
    host: str = "0.0.0.0"
    port: int = 8000

    # Default pipeline mode when a session does not specify one.
    # One of: "mock" | "cloud" | "offline".
    default_mode: str = "mock"

    # CORS allow-list. "*" is fine for local hackathon dev.
    cors_origins: str = "*"

    # Preload the local models at startup (see core/warmup.py) so the first
    # speaker does not pay NLLB/Whisper/Piper load time inside their turn.
    # Runs in the background — it never blocks or crashes startup.
    warmup_on_startup: bool = True

    # --- Offline STT engine selection ------------------------------------
    # Which local STT engine `mode=offline` uses:
    #   "whisper"    -> Faster-Whisper (one multilingual model, auto-detect)
    #   "sherpa"     -> sherpa-onnx per-language Zipformer (gipformer VI + zipformer EN)
    #   "phowhisper" -> per-language Faster-Whisper: PhoWhisper (VinAI) for VI,
    #                   standard Whisper for EN (PhoWhisper is Vietnamese-only)
    stt_engine: str = "whisper"

    # --- Faster-Whisper runtime (shared by "whisper" and "phowhisper") ---
    # "cpu" + "int8" is the safe default; set "cuda" + "float16" when a GPU is
    # available (much faster, needed for real-time PhoWhisper-large).
    stt_device: str = "cpu"
    stt_compute_type: str = "int8"
    # Multilingual Faster-Whisper model size for stt_engine == "whisper":
    # "tiny"/"base" (fastest) .. "small" (default) .. "medium"/"large-v3"
    # (best, GPU recommended). On a GPU bump this up; on CPU drop it for speed.
    stt_model_size: str = "small"

    # --- PhoWhisper STT (used when stt_engine == "phowhisper") -----------
    # CTranslate2 model dir for the Vietnamese PhoWhisper model, built by
    # tools/prepare_phowhisper.py. Unset -> the provider raises a clear error.
    phowhisper_model_dir: str | None = None
    # Faster-Whisper model for English (PhoWhisper does not cover EN). A size
    # name ("small"/"medium") is auto-downloaded; a local CT2 dir also works.
    whisper_en_model: str = "small"

    # --- sherpa-onnx STT (used when stt_engine == "sherpa") --------------
    # Root folder holding one subfolder per language code: <dir>/vi, <dir>/en, ...
    sherpa_models_dir: str = "models"
    # Prefer the int8-quantized ONNX variant when a model ships both.
    sherpa_use_int8: bool = False
    # ONNX Runtime intra-op threads per recognizer.
    sherpa_num_threads: int = 2
    # "greedy_search" (fast) or "modified_beam_search" (slightly better WER).
    sherpa_decoding_method: str = "greedy_search"

    # --- TTS engine ------------------------------------------------------
    # TTS is decoupled from the session mode: the SAME voice engine is used
    # whether STT/NMT run in cloud or offline. Options:
    #   "edge"  -> edge-tts online neural voices (free, no key, real VN + EN);
    #              server-side audio -> works on web AND mobile clients. (default)
    #   "piper" -> local Piper voices (needs models); "mock" -> silent clip.
    tts_engine: str = "edge"
    # edge-tts voices (see `edge-tts --list-voices`).
    edge_voice_vi: str = "vi-VN-HoaiMyNeural"
    edge_voice_en: str = "en-US-AriaNeural"
    # Root folder holding one subfolder per language: <dir>/vi, <dir>/en, ...
    # Each folder contains a Piper voice pair: <name>.onnx + <name>.onnx.json
    # (fetch with tools/download_piper_models.py).
    piper_models_dir: str = "models/tts"
    # Speaking rate. >1.0 = slower, <1.0 = faster. Applied to every language.
    piper_length_scale: float = 1.0

    # --- Cloud TTS (e.g. ElevenLabs, Google TTS, Azure, ...) --------------
    tts_api_key: str | None = None
    tts_api_url: str | None = None

    # --- Groq (console.groq.com) — free tier STT (Whisper) + NMT (LLM) ---
    # `groq_api_key` is the shared/default key. To split rate limits, set a
    # separate key per stage (STT vs NMT); each falls back to groq_api_key.
    groq_api_key: str | None = None
    groq_stt_api_key: str | None = None
    groq_nmt_api_key: str | None = None
    # OpenAI-compatible Groq base URL (rarely changed).
    groq_api_url: str = "https://api.groq.com/openai/v1"
    # Whisper model for speech-to-text.
    groq_stt_model: str = "whisper-large-v3"
    # Chat model used to translate the transcript (both directions).
    groq_nmt_model: str = "qwen/qwen3.8-27b"

    # --- NMT engine selection --------------------------------------------
    # Which NMT engine to use. Applies to `mode=offline` (replacing NLLB) and,
    # for "sealion" only, also to `mode=cloud` (replacing the Groq chat NMT, so
    # you can pair Groq Whisper STT with SEA-LION translation):
    #   "nllb"    -> CTranslate2 NLLB-200 (light, fast, real-time on CPU; default)
    #   "seallm"  -> a local OpenAI-compatible chat endpoint (Ollama/vLLM) serving
    #                SeaLLMs-v3 — better glossary/context following, needs a GPU.
    #   "sealion" -> AI Singapore SEA-LION v4 via the hosted SEA-LION API
    #                (api.sea-lion.ai). SEA-Asian-tuned, best VI quality, but it
    #                is a NETWORK call — not usable without internet.
    nmt_engine: str = "nllb"

    # --- SEA-LION NMT (used when nmt_engine == "sealion") ----------------
    # Hosted SEA-LION API — OpenAI-compatible, so groq_client is reused as-is.
    # Get a free key from the SEA-LION Playground (https://playground.sea-lion.ai).
    # NOTE: the free tier is rate-limited (~10 requests/minute), which a busy
    # meeting can exceed — see .env.example.
    sealion_api_url: str = "https://api.sea-lion.ai/v1"
    sealion_api_key: str | None = None
    # Any model id the API serves. Point this at a self-hosted Ollama/vLLM
    # instead (e.g. aisingapore/Gemma-SEA-LION-v4-27B-IT) by also setting
    # SEALION_API_URL — no rate limit then.
    sealion_model: str = "aisingapore/Qwen-SEA-LION-v4.5-27B-IT"

    # --- Local chat NMT (used when nmt_engine == "seallm") ---------------
    # OpenAI-compatible base URL of the local LLM server (Ollama default shown).
    local_nmt_api_url: str = "http://localhost:11434/v1"
    # Model name as registered in the server (e.g. `ollama create seallm-v3 ...`).
    local_nmt_model: str = "seallm-v3"
    # Ollama ignores auth but the OpenAI-style client still needs a bearer string.
    local_nmt_api_key: str = "ollama"

    # --- Offline NMT (CTranslate2 + NLLB-200) ----------------------------
    # Path to a CTranslate2 int8 NLLB model dir (with tokenizer files), built
    # by tools/prepare_nllb.py. Unset -> offline NMT raises a clear error.
    offline_nmt_model_dir: str | None = None
    # Beam size for the authoritative translation (audio.chunk / text.final).
    # Higher = more accurate, slower. On GPU 5 is cheap; on CPU keep it low.
    offline_nmt_beam_final: int = 4
    # CTranslate2 intra-op threads; 0 = let CTranslate2 choose.
    offline_nmt_intra_threads: int = 0
    # CTranslate2 device/precision for NLLB. "cpu" + "int8" is the safe default;
    # set "cuda" + "float16" on a GPU box (much faster, best accuracy).
    offline_nmt_device: str = "cpu"
    offline_nmt_compute_type: str = "int8"

    # --- STT hallucination guard -----------------------------------------
    # Windows quieter than this normalized RMS (0..1), or shorter than this many
    # ms, are treated as silence and NEVER sent to Whisper (which hallucinates on
    # silence). Raise stt_silence_rms if quiet speech is being dropped; lower it
    # if silence still produces phantom text.
    stt_silence_rms: float = 0.006
    stt_min_speech_ms: int = 300
    # Silero VAD speech probability (0..1) a frame needs to count as voice. Only
    # VAD-detected speech is sent to STT (core/audio_utils.speech_only). Raise it
    # if background noise still turns into text; lower it if soft speech is lost.
    stt_vad_threshold: float = 0.5

    @property
    def cors_origin_list(self) -> list[str]:
        """Parse the comma-separated CORS origins into a list."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings singleton."""
    return Settings()


settings = get_settings()
