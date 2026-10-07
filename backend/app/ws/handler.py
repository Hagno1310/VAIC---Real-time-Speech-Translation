"""WebSocket event parsing and per-turn pipeline orchestration.

The handler is transport-only: it parses incoming events, drives the
STT -> NMT -> (TTS) pipeline via provider abstractions, measures latency, and
emits response events. It never imports a concrete provider, so changing the
provider mode requires no changes here.

Wire protocol (JSON):
    Client -> Server: {"type": <event>, "data": {...}}
    Server -> Client: {"type": <event>, "data": {...}}
"""
from __future__ import annotations

import base64
import binascii
import logging
from typing import TYPE_CHECKING

from fastapi import WebSocket

from ..core.glossary import apply_glossary
from ..core.metrics import Stopwatch, TurnMetrics
from ..core.session import SessionState

if TYPE_CHECKING:
    from .rooms import ConnectionManager

log = logging.getLogger("ws.handler")


async def send(ws: WebSocket, event: str, data: dict) -> None:
    """Send a `{type, data}` envelope to the client."""
    await ws.send_json({"type": event, "data": data})


async def _emit(
    ws: WebSocket,
    session: SessionState,
    manager: "ConnectionManager | None",
    event: str,
    data: dict,
    *,
    to_peer: bool = False,
) -> None:
    """Emit a result event, optionally routing it to this client's room peer.

    When `to_peer` and the client is paired in a room, the event goes to the
    OTHER member (translation + audio land on the listener's device). Otherwise
    it goes back to `ws` — which also preserves the solo `/app` console (no peer
    → self-loop, unchanged).
    """
    if to_peer and manager is not None and session.client_id:
        peer_id = manager.peer_id_of(session.client_id)
        if peer_id:
            await manager.send_to(peer_id, event, data)
            return
    await send(ws, event, data)


async def _emit_translation(
    ws: WebSocket,
    session: SessionState,
    manager: "ConnectionManager | None",
    speaker: str,
    src_text: str,
    dst_text: str,
) -> None:
    """Deliver a finalized translation of the speaker's turn.

    In a 1:1 room the translation lands on the PEER (`nmt.result`, their left
    bubble) AND a copy returns to the SPEAKER (`nmt.self`) so their own bubble can
    show both the original and its translation. With no peer (the `/app` console),
    it falls back to a single `nmt.result` to self — the self-loop, unchanged.
    """
    payload = {"speaker": speaker, "srcText": src_text, "dstText": dst_text}
    peer_id = (
        manager.peer_id_of(session.client_id)
        if manager is not None and session.client_id
        else None
    )
    if peer_id:
        await manager.send_to(peer_id, "nmt.result", payload)
        await send(ws, "nmt.self", payload)
    else:
        await send(ws, "nmt.result", payload)


async def send_error(
    ws: WebSocket, code: str, message: str, can_fallback: bool = True
) -> None:
    """Emit an `error` event. `can_fallback` hints the UI to switch mode."""
    log.warning("error code=%s msg=%s", code, message)
    await send(ws, "error", {"code": code, "message": message, "canFallback": can_fallback})


async def dispatch(
    ws: WebSocket,
    session: SessionState,
    message: dict,
    manager: "ConnectionManager | None" = None,
) -> None:
    """Route one parsed client message to the right handler.

    `manager` is the lobby/room registry. It is None only for callers that never
    use pairing (e.g. legacy tests); the pipeline then behaves as a self-loop.
    """
    event = message.get("type")
    data = message.get("data") or {}

    if event == "session.start":
        await _on_session_start(ws, session, data)
    elif event == "audio.chunk":
        await _on_audio_chunk(ws, session, data, manager)
    elif event == "text.final":
        await _on_text_final(ws, session, data, manager)
    elif event == "config.update":
        await _on_config_update(ws, session, data)
    elif event == "session.end":
        await _on_session_end(ws, session, data)
    # -- lobby / 1:1 room pairing --------------------------------------- #
    elif event == "hello":
        await _on_hello(ws, session, data, manager)
    elif event == "invite":
        await _on_invite(ws, session, data, manager)
    elif event == "invite.accept":
        await _on_invite_accept(ws, session, data, manager)
    elif event == "invite.decline":
        await _on_invite_decline(ws, session, data, manager)
    elif event == "room.leave":
        await _on_room_leave(ws, session, data, manager)
    else:
        await send_error(ws, "unknown_event", f"Unknown event: {event}", can_fallback=False)


# --------------------------------------------------------------------------- #
# Lobby / room event handlers
# --------------------------------------------------------------------------- #
async def _on_hello(
    ws: WebSocket, session: SessionState, data: dict, manager: "ConnectionManager | None"
) -> None:
    """Register this connection in the lobby and announce it to others."""
    if manager is None:
        await send_error(ws, "no_lobby", "Lobby unavailable on this server.", can_fallback=False)
        return
    name = (data.get("name") or "").strip() or "Thiết bị"
    lang = data.get("lang") or session.source_lang
    session.source_lang = lang
    if session.client_id is None:
        session.client_id = manager.register(ws, session, name, lang)
    else:
        # Re-`hello` on an existing connection = the device is CHANGING its pick
        # (e.g. it selected the wrong language). Update the registry so the new
        # language propagates to every other device via the lobby rebroadcast.
        manager.update_identity(session.client_id, name, lang)
    await send(ws, "welcome", {"clientId": session.client_id})
    await manager.broadcast_lobby()


async def _on_invite(
    ws: WebSocket, session: SessionState, data: dict, manager: "ConnectionManager | None"
) -> None:
    """Forward an invite to the target client."""
    if manager is None or not session.client_id:
        return
    to_id = data.get("toClientId")
    target = manager.client(to_id)
    if target is None:
        await send_error(ws, "invite_target_gone", "Thiết bị không còn trực tuyến.", can_fallback=False)
        return
    if target.room_id is not None:
        await send(ws, "invite.declined", {"fromClientId": to_id, "reason": "busy"})
        return
    me = manager.client(session.client_id)
    if me is None:
        return
    await manager.send_to(to_id, "invite.incoming", {
        "fromClientId": session.client_id,
        "fromName": me.name,
        "fromLang": me.lang,
    })


async def _on_invite_accept(
    ws: WebSocket, session: SessionState, data: dict, manager: "ConnectionManager | None"
) -> None:
    """Accept an invite from `fromClientId`, forming a 1:1 room."""
    if manager is None or not session.client_id:
        return
    from_id = data.get("fromClientId")
    if not from_id:
        return
    room_id = await manager.form_room(from_id, session.client_id)
    if room_id is None:
        await send_error(ws, "room_failed", "Không thể tạo phòng (thiết bị bận hoặc đã rời).")


async def _on_invite_decline(
    ws: WebSocket, session: SessionState, data: dict, manager: "ConnectionManager | None"
) -> None:
    """Tell the inviter their invite was declined."""
    if manager is None or not session.client_id:
        return
    from_id = data.get("fromClientId")
    if not from_id:
        return
    await manager.send_to(from_id, "invite.declined", {
        "fromClientId": session.client_id,
        "reason": "declined",
    })


async def _on_room_leave(
    ws: WebSocket, session: SessionState, data: dict, manager: "ConnectionManager | None"
) -> None:
    """Leave the current room, closing it for the peer."""
    if manager is None or not session.client_id:
        return
    await manager.leave_room(session.client_id, reason="left")


# --------------------------------------------------------------------------- #
# Event handlers
# --------------------------------------------------------------------------- #
async def _on_session_start(ws: WebSocket, session: SessionState, data: dict) -> None:
    """Handle session.start: initialize state and build providers."""
    session.start(
        mode=data.get("mode", session.mode),
        source_lang=data.get("sourceLang", session.source_lang),
        target_lang=data.get("targetLang", session.target_lang),
    )
    await send(
        ws,
        "session.started",
        {
            "mode": session.mode,
            "sourceLang": session.source_lang,
            "targetLang": session.target_lang,
            "ttsOn": session.tts_on,
            "glossaryId": session.glossary_id,
        },
    )


async def _on_config_update(ws: WebSocket, session: SessionState, data: dict) -> None:
    """Handle config.update: change mode / ttsOn / glossary mid-session."""
    if "mode" in data and data["mode"]:
        session.set_mode(data["mode"])
    if "ttsOn" in data and data["ttsOn"] is not None:
        session.tts_on = bool(data["ttsOn"])
    if "glossaryId" in data:
        session.glossary_id = data["glossaryId"]

    await send(
        ws,
        "config.updated",
        {
            "mode": session.mode,
            "ttsOn": session.tts_on,
            "glossaryId": session.glossary_id,
        },
    )


async def _on_session_end(ws: WebSocket, session: SessionState, data: dict) -> None:
    """Handle session.end: zero-retention cleanup and acknowledge."""
    session.cleanup()
    await send(ws, "session.ended", {})


async def _on_text_final(
    ws: WebSocket, session: SessionState, data: dict, manager: "ConnectionManager | None" = None
) -> None:
    """Translate a confirmed text segment (browser-side STT, Cloud mode)."""
    if not session.started or session.providers is None:
        await send_error(ws, "no_session", "session.start must be sent first.", can_fallback=False)
        return
    speaker = data.get("speaker", "unknown")
    text = (data.get("text") or "").strip()
    if not text:
        return
    metrics = TurnMetrics()
    try:
        with Stopwatch() as sw_nmt:
            dst_text = await session.providers.nmt.translate(
                text, session.source_lang, session.target_lang
            )
        dst_text = apply_glossary(dst_text, session.glossary_id, session.target_lang)
        metrics.nmt_ms = sw_nmt.ms
        await _emit_translation(ws, session, manager, speaker, text, dst_text)
    except Exception as exc:  # noqa: BLE001
        await send_error(ws, "nmt_failed", f"NMT provider failed: {exc}")
        return
    metrics.finish()
    await send(ws, "metrics", metrics.as_event())


async def _on_audio_chunk(
    ws: WebSocket, session: SessionState, data: dict, manager: "ConnectionManager | None" = None
) -> None:
    """Run one full spoken turn: STT -> NMT -> optional TTS -> metrics.

    Every stage is wrapped so a provider failure emits an `error` event with
    canFallback=true instead of crashing the connection.
    """
    if not session.started or session.providers is None:
        await send_error(ws, "no_session", "session.start must be sent first.", can_fallback=False)
        return

    speaker = data.get("speaker", "unknown")
    metrics = TurnMetrics()  # starts the end-to-end clock
    # [LATENCY] t0 = moment the FINAL segment arrives (~when you stop speaking).
    log.info("[LATENCY][turn] speaker=%s audio.chunk received -> starting STT/NMT/TTS", speaker)

    # Decode audio (base64 -> bytes). Content is unused by the mock providers.
    try:
        audio = base64.b64decode(data.get("audio", ""), validate=False)
    except (binascii.Error, ValueError):
        await send_error(ws, "bad_audio", "audio must be valid base64.", can_fallback=False)
        return
    session.remember_audio(speaker, audio)

    # ---- STT -------------------------------------------------------------
    final_text: str | None = None
    final_lang: str = session.source_lang
    try:
        with Stopwatch() as sw_stt:
            async for result in session.providers.stt.transcribe(audio, session.source_lang):
                if result.is_final:
                    final_text = result.text
                    final_lang = result.lang
                    if result.text.strip():
                        session.remember_text(speaker, result.text)
                        await send(ws, "stt.final", {
                            "speaker": speaker,
                            "text": result.text,
                            "lang": result.lang,
                        })
                elif result.text.strip():
                    await send(ws, "stt.partial", {"speaker": speaker, "text": result.text})
        metrics.stt_ms = sw_stt.ms
        log.info("[LATENCY][turn] speaker=%s STT done sttMs=%.0f", speaker, sw_stt.ms)
    except Exception as exc:  # noqa: BLE001 - keep the server alive on any provider failure
        await send_error(ws, "stt_failed", f"STT provider failed: {exc}")
        return

    if not final_text or not final_text.strip():
        # Silent/guarded window (no speech) — skip quietly, no error, no garbage.
        log.info("audio.chunk produced no speech for speaker=%s (silence/guarded)", speaker)
        return

    # ---- Dịch + TTS NGUYÊN cụm STT (streaming voice, đọc cuốn chiếu) ------
    # KHÔNG ngắt câu theo dấu câu: mỗi cụm VAD (một audio.chunk) được dịch và đọc
    # ngay khi tới, nên số thập phân như "2.5" không bị tách ở dấu chấm. VAD phía
    # client đã căn cụm theo nhịp ngắt hơi (SILENCE_MS) nên giọng vẫn liền mạch.
    source_text = final_text.strip()

    # ---- NMT -------------------------------------------------------------
    try:
        with Stopwatch() as sw_nmt:
            dst_text = await session.providers.nmt.translate(
                source_text, session.source_lang, session.target_lang
            )
        dst_text = apply_glossary(dst_text, session.glossary_id, session.target_lang)
        metrics.nmt_ms = sw_nmt.ms
        log.info("[LATENCY][turn] speaker=%s NMT done nmtMs=%.0f", speaker, sw_nmt.ms)
        # Translation goes to the listener (peer) in a room; self on console.
        await _emit_translation(ws, session, manager, speaker, source_text, dst_text)
    except Exception as exc:  # noqa: BLE001
        await send_error(ws, "nmt_failed", f"NMT provider failed: {exc}")
        metrics.finish()
        await send(ws, "metrics", metrics.as_event())
        return

    # ---- TTS (optional) — audio từng cụm, phát cuốn chiếu ----------------
    if session.tts_on:
        try:
            with Stopwatch() as sw_tts:
                audio_b64 = await session.providers.tts.synthesize(
                    dst_text, session.target_lang
                )
            log.info("[LATENCY][turn] speaker=%s TTS done ttsMs=%.0f", speaker, sw_tts.ms)
            await _emit(ws, session, manager, "tts.audio", {
                "speaker": speaker, "audio": audio_b64,
            }, to_peer=True)
        except Exception as exc:  # noqa: BLE001 - TTS failure must not kill the turn
            await send_error(ws, "tts_failed", f"TTS provider failed: {exc}")

    # ---- Metrics ---------------------------------------------------------
    metrics.finish()
    # [LATENCY] e2eMs = you stop speaking -> peer's translation+audio emitted.
    log.info(
        "[LATENCY][turn] speaker=%s DONE e2eMs=%.0f (sttMs=%.0f nmtMs=%.0f tts=%s) -> peer hears it",
        speaker, metrics.e2e_ms, metrics.stt_ms, metrics.nmt_ms,
        "on" if session.tts_on else "off",
    )
    await send(ws, "metrics", metrics.as_event())
