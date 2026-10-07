# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Real-Time Vietnamese ⇄ English business-meeting translator. Two independent apps
that talk over a **single WebSocket** (`ws://<host>:8000/ws`) using a
`{"type": <event>, "data": {...}}` envelope in both directions:

- `backend/` — FastAPI + WebSocket STT → NMT → TTS pipeline (Python). Cloud mode
  runs on **Groq** (Whisper STT + Qwen chat NMT).
- `frontend/` — **Expo / React Native (mobile)** app. The **RTT** flow
  (`src/screens/{Language,Devices,Invite,Meeting,EndSession}`, wired in
  `navigation/TranslatorStack.tsx` — push-to-talk and the history panel live in
  the Meeting screen) is the live translator UI.

**Primary product = LAN 1:1 pairing ("chat nội bộ").** Two devices point at the
*same* backend on the LAN, discover each other in a lobby, pair into a 1:1 room,
and translate for each other: when A speaks (langA), B receives the translation
(langB) **and** its TTS audio, and vice-versa. See "Lobby + 1:1 room pairing"
below. The single-connection self-loop (speak → get your own translation back)
still works for the `/app` browser console and any client that never sends
`hello`. Design spec: `docs/superpowers/specs/2026-07-18-lan-lobby-translation-rooms-design.md`.

> To run two real machines: start the backend with `--host 0.0.0.0`, find the
> host LAN IPv4 (`ipconfig`), open the firewall for TCP 8000, and set the WS URL
> on both clients to `ws://<lan-ip>:8000/ws` (Language screen → "Cài đặt backend"). Browser
> mic capture only works on `localhost`/https, so use Expo Go on phones or run
> Expo Web on each machine's own localhost (only the WS URL needs the LAN IP).

## Commands

Backend (from `backend/`, Windows venv shown):
```bash
python -m venv .venv && .venv\Scripts\Activate.ps1   # or: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload          # http://localhost:8000; WS /ws; health JSON at /; test console at /app
uvicorn app.main:app --host 0.0.0.0 --port 8000   # reachable by other LAN devices (pairing)
python tools/check_groq_key.py         # verify a Groq key works (STT+NMT via one gsk_ key)
python tools/talk_translate.py --mode cloud --src vi --tgt en         # mic → server → transcript+translation
python tools/record_stt.py             # mic → real Faster-Whisper STT → Markdown (no server)
python tools/prepare_nllb.py           # build CTranslate2 int8 NLLB dir for offline NMT (offline_nmt_model_dir)
python tools/prepare_phowhisper.py     # build CT2 PhoWhisper VI model for STT_ENGINE=phowhisper
python tools/download_sherpa_models.py # fetch sherpa-onnx models for STT_ENGINE=sherpa
python tools/download_piper_models.py  # fetch Piper voices -> models/tts/{vi,en} for TTS_ENGINE=piper
```
Tests: `tests/` has **pytest unit tests** for pure helpers (`test_ct2_nmt.py`,
`test_offline_nmt_config.py`, `test_offline_*`) — run `python -m pytest tests/`
or a single file/test (`python -m pytest tests/test_ct2_nmt.py -q`,
`... -k test_to_flores_known`). **pytest is not in `requirements.txt`** — install
it separately. `tests/test_client.py` is instead a manual end-to-end WS client.
Run one-off backend checks with an in-process `fastapi.testclient.TestClient`
websocket for the **single-connection** pipeline. **Do NOT use TestClient to
verify pairing/routing** — it cannot deliver cross-connection sends (a handler
sending to another client's socket is silently dropped). Verify multi-client
routing against a **live uvicorn** server with two real `websockets` clients.

Frontend (from `frontend/`):
```bash
npm install
npm start            # expo start (a=Android, i=iOS, w=web); or npm run android|ios|web
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src/**/*.{ts,tsx}
```
`frontend/claude.md` is a strict, mandatory architecture/style constitution for
all frontend work (Expo/RN, NativeWind, Zustand slices, layered imports) — read
it before touching `frontend/`. This root file does not repeat its rules.

Pairing-specific frontend facts (protocol-spanning, not in `frontend/claude.md`):
`store/slices/translatorSlice.ts` owns one `TranslatorSocket` plus the lobby/room
state (`devices`, `room`, `incomingInvite`, `myClientId`) and drives the flow —
Language `enterLobby`→`hello`, Devices lobby+`invite`, Invite `accept`, Meeting
(push-to-talk via `useMeetingMic` + the in-meeting history panel), EndSession.
Because translation routes to the peer, the **speaker records its own words from
`stt.final`** (`turn.mine=true`); the **listener records the peer's from
`nmt.result`** (`mine=false`). `services/audioPlayback.ts` is platform-split: web
plays a `data:` URI via `Audio` (expo-file-system is a no-op on web), native
writes a temp file for expo-audio.

## Backend architecture — the one pattern that matters

**Modular provider pattern.** Each pipeline stage (STT / NMT / TTS) is an
abstract contract in `app/providers/base.py`. Concrete trios implement it:

- `mock.py` — works instantly, no models/keys. Default mode.
- `cloud.py` — **Groq only** (Whisper STT + Qwen chat NMT). Falls back to the
  matching mock provider when the key is missing. (Gemini has been removed.)
- `offline.py` — local models, **all three stages now implemented** (the
  module docstring calling NMT/TTS stubs is stale). `factory.py` picks the
  concrete offline STT/NMT by env engine, not by class:
  - **STT** by `STT_ENGINE`: `whisper` (default) → `OfflineSTTProvider`
    (Faster-Whisper via `whisper_engine.py`), `sherpa` → `SherpaSTTProvider`
    (`sherpa.py`/`sherpa_engine.py`), `phowhisper` → `PhoWhisperSTTProvider`
    (`phowhisper.py`: PhoWhisper for VI, Whisper for EN).
  - **NMT** by `NMT_ENGINE`: `nllb` (default) → `OfflineNMTProvider`
    (CTranslate2 int8 + NLLB-200 via `ct2_nmt.py`), `seallm` → `LocalNMTProvider`
    (`local_nmt.py`, OpenAI-compatible local chat — Ollama/vLLM), `sealion` →
    `SeaLionNMTProvider` (`sealion_nmt.py`, AI Singapore SEA-LION v4).
    **`sealion` is the one engine that also applies in `mode=cloud`** — it
    replaces the Groq chat NMT there, so you get Groq Whisper STT + SEA-LION
    translation. It defaults to the hosted `api.sea-lion.ai` (needs
    `SEALION_API_KEY`, so `mode=offline` is no longer literally offline, and the
    free tier's ~10 req/min can be exceeded by a busy meeting); point
    `SEALION_API_URL` at a local Ollama serving a SEA-LION v4 GGUF to avoid
    both. Verify a key with `python tools/check_sealion_key.py`.
    All three chat-based NMT providers (`cloud`, `local_nmt`, `sealion_nmt`) are
    thin wrappers over `groq_client`'s pure OpenAI-shaped helpers — a new
    OpenAI-compatible NMT backend is a ~40-line file plus a `factory.py` branch.
  - **TTS** is Piper (`piper_engine.py`), but reached via `build_tts()` /
    `TTS_ENGINE=piper` (see below), not the offline trio.
  - **Device/precision is config-driven** (previously hard-coded CPU/int8):
    STT reads `STT_DEVICE`/`STT_COMPUTE_TYPE`/`STT_MODEL_SIZE`, NMT reads
    `OFFLINE_NMT_DEVICE`/`OFFLINE_NMT_COMPUTE_TYPE` — default CPU+int8, set
    `cuda`+`float16` on a GPU box.
  - **MKL guard.** Both offline STT (faster-whisper) and NMT (NLLB) run on
    **CTranslate2**, so `app/__init__.py` sets **`CT2_USE_MKL=0`** (oneDNN
    backend) *before any ctranslate2 import* — the Intel-MKL default throws
    `mkl_malloc: failed to allocate memory` on some Windows/low-RAM machines.
    Override with `CT2_USE_MKL=1`.

The active trio is chosen by session `mode` (`mock`/`cloud`/`offline`) in
`app/providers/factory.py` — **the only file that knows concrete provider
classes exist.** `app/ws/handler.py` (transport + per-turn orchestration) and
`app/main.py` (`/ws` lifecycle) talk only to the abstract base classes. To
add/swap a real model, implement the base-class methods in a provider and wire
it in `factory.py`. Never import a concrete provider into the handler.

TTS is decoupled from the STT/NMT mode (`build_tts()` in `factory.py`, chosen by
`TTS_ENGINE`, **default `edge`**): `edge` → `tts_edge.py` (Microsoft edge-tts
online neural voices — free, no key, real Vietnamese voice `vi-VN-HoaiMyNeural`);
`piper` → local Piper (`piper_engine.py`; **offline**, needs the `piper-tts`
package + voices — fetch with `python tools/download_piper_models.py` into
`models/tts/{vi,en}` and set `PIPER_MODELS_DIR`); else Mock. So a cloud STT/NMT
session still gets edge-tts audio. `session.tts_on` still defaults **False**; the RN client enables it via
`config.update {ttsOn}` (the pairing flow does this on `room.joined`).

`STTProvider.transcribe` is an **async generator**: it yields partial
`STTResult`s (`is_final=False` → `stt.partial`) then exactly one final
(`is_final=True` → `stt.final`).

### Groq cloud (`cloud.py` + `groq_client.py`)
- STT = `whisper-large-v3` (multipart `/audio/transcriptions`); NMT =
  `qwen/qwen3.8-27b` (`/chat/completions`), bidirectional.
- **Split rate limits:** `GROQ_STT_API_KEY` / `GROQ_NMT_API_KEY` each fall back to
  the shared `GROQ_API_KEY`. `groq_client.py`'s request/response builders are
  pure functions; only `_transcribe`/`_chat` do I/O.

### No predictive translation (deliberate — "nghe gì ghi nấy")
There is **no** `audio.partial` / `text.partial` / `nmt.partial` path anymore
(removed along with `NMTProvider.translate_partial`). Input is either per-VAD-
segment `audio.chunk` (→ `stt.final` + `nmt.result`) or `text.final` (client
already has the transcript; backend only translates). Unknown events get an
`unknown_event` error. Do not reintroduce draft/predicted translations.

### Turn flow (`_on_audio_chunk`)
`audio.chunk` → STT (times `sttMs`) → NMT (times `nmtMs`, then `apply_glossary`)
→ optional TTS (only if `session.tts_on`) → `metrics` (`e2eMs`). Each stage is
wrapped in try/except: a failure emits an `error` event with `canFallback` and
keeps the connection alive; a TTS failure never aborts the turn.

**Per-segment, no sentence-splitting (deliberate).** Each `audio.chunk` is one
VAD segment, translated + TTS'd on its own (streaming "cuốn chiếu"). There is
**no source buffering / sentence splitting** — `OfflineNMTProvider.translate`
translates the whole segment as one unit, because splitting on "." breaks
decimals like `2.5` ("two point five"). Do NOT reintroduce sentence-splitting in
the source/NMT path (there is no `text_utils.py` / `_nmt_buffer` anymore).

### STT hallucination + echo guards (`core/audio_utils.py`, `groq_client.py`)
Whisper turns non-speech into confident canned text ("Cảm ơn các bạn đã theo dõi",
"Ghiền Mì Gõ") — measured on pure noise, Groq's `no_speech_prob` stays ~0.2-0.45,
so it can NOT be trusted. Layers, in order (cloud + phowhisper providers):
1. `is_silence(wav)` — cheap RMS/duration gate (`STT_SILENCE_RMS`, `STT_MIN_SPEECH_MS`).
2. `speech_only(wav)` — **Silero VAD** (bundled with faster-whisper) keeps only
   detected speech; no speech → empty final. Knob: `STT_VAD_THRESHOLD`. Falls back
   to passthrough when faster-whisper is absent (deploy image).
3. **Language gate** (`groq_client.transcribe_audio`): Whisper runs with
   auto-detect and a window detected as the OTHER paired language is dropped.
   Forcing the language made Whisper "translate" the peer device's TTS (picked
   up by the speaker's open mic in a shared room) back into the source language
   → endless drifting echo loop. Unknown detections retry with forced language.
4. `looks_like_hallucination()` — canned-phrase/marker backstop.
An empty final is skipped silently (no `error`, nothing stored).

## Lobby + 1:1 room pairing (LAN) — `app/ws/rooms.py`

`ConnectionManager` (a process-global singleton, RAM only) is the registry the
self-loop never had. `app/main.py` passes it into `dispatch`; on disconnect the
`/ws` `finally` calls `manager.unregister()` (notifies peer + rebroadcasts lobby)
**before** `session.cleanup()`. `SessionState` gains only `client_id`.

- **Events (added to `handler.dispatch`)** — C→S: `hello{name,lang}`,
  `invite{toClientId}`, `invite.accept{fromClientId}`, `invite.decline`,
  `room.leave`. S→C: `welcome{clientId}`, `lobby{devices:[{clientId,name,lang,busy}]}`,
  `invite.incoming`, `invite.declined`, `room.joined{roomId,peer}`, `room.closed{reason}`.
- **`hello`** registers the connection (server-assigned `client_id`) and sets
  `session.source_lang`. **`form_room`** pairs two clients, then calls
  `session.start(default_mode, ownLang, peerLang)` for **both** sessions so each
  translates its own language into the peer's — this is why the app needs no
  explicit `session.start`.
- **Routing is the core** (`handler._emit(..., to_peer=True)`): in a room,
  `nmt.result` / `tts.audio` go to the **peer**; `stt.*` +
  `metrics` stay on the **speaker**. With no peer (`client_id` unset → the `/app`
  console), everything falls back to `send(ws, ...)` — the self-loop, unchanged.
  So the speaker sees only their own transcript; the listener gets the
  translation + audio.

### Startup warmup (`core/warmup.py`)

Local engines cache their model process-wide (`ct2_nmt._CACHE`,
`whisper_engine.get_engine`/`piper_engine.get_piper_engine` `lru_cache`) but load
**lazily**, so without warmup the first speaker of the first meeting paid the
full NLLB+Whisper+Piper load inside their turn (~13s measured). `main.py`'s
lifespan fires `run_warmup()` as a **background task** — startup completes and
`/ws` accepts connections immediately; a client connecting mid-warm just waits on
the same cache entry. Failures are logged and swallowed, never fatal. Disable
with `WARMUP_ON_STARTUP=false`. Silero VAD is warmed in **every** mode (importing
faster-whisper alone is ~11-15s cold). Readiness is exposed to clients:
`welcome.serverReady` + a `server.ready` broadcast when warmup ends; the Meeting
screen shows a "preparing" overlay (mic opened + server ready) before allowing
the first turn.

**Gotcha:** the cached getters only build a wrapper — `WhisperEngine.__init__`
sets `_model = None` and `PiperEngine` holds an empty `_voices` dict. Warmup must
call `.load()` (Whisper) / `.load(lang)` per voice (Piper) or it silently no-ops
(the giveaway is a "ready in 0.0s" log line). Warms STT+NMT only when
`default_mode == "offline"`, but Piper TTS whenever `TTS_ENGINE=piper`, since
`build_tts()` is mode-independent.

### Two invariants — do not break
- **Zero retention.** All audio/text lives in RAM only (`core/session.py`
  buffers). `SessionState.cleanup()` runs in the `/ws` `finally` block on
  `session.end` *or* disconnect. Never write audio to disk in the server path.
- **Config via `core/config.py`** (pydantic-settings, `.env`). No hard-coded
  keys; read settings through the `settings` singleton, not `os.environ`.

Mode can change mid-session via `config.update {mode}`; providers rebuild without
reconnecting (`SessionState.set_mode`). Business glossary (`core/glossary.py`) is
applied as whole-word replacement to NMT output, selected per-session. It is
**direction-aware**: `apply_glossary(text, glossary_id, target_lang)` stores
pairs as EN→VI and inverts them when `target_lang == "en"`. Passing the wrong
target (or dropping the arg) silently rewrites correct EN output back into
Vietnamese — that was a real bug on every VI→EN turn. An unrecognized
`target_lang` is a passthrough by design; never guess a direction.

`backend/static/index.html` is a self-contained browser client for manually
driving the WS (served at **`/app`**; `/` is a health JSON). It never sends
`hello`, so it exercises the self-loop path, not pairing.

## Cross-cutting notes
- Language handling: the sherpa engine has one model per language, so the source
  language must be explicit — `auto` detection only works with the Whisper engine.
- Windows consoles are cp1252; tools call `sys.stdout.reconfigure(encoding="utf-8")`
  to print Vietnamese. When running ad-hoc Python that prints Vietnamese, set
  `PYTHONIOENCODING=utf-8`.
