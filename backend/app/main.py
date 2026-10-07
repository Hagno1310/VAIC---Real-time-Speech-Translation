"""FastAPI application: HTTP health + the /ws WebSocket route.

Run with:  uvicorn app.main:app --reload
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

# Static test console (served at /app so getUserMedia has a secure context).
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

from .core.config import settings
from .core.glossary import list_glossaries
from .core.session import SessionState
from .core.warmup import run_warmup
from .providers.factory import VALID_MODES
from .setup_api import router as setup_router
from .ws.handler import dispatch
from .ws.rooms import manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("app.main")

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Kick off model warmup, then serve.

    Warmup is a fire-and-forget background task on purpose: `/ws` must accept
    connections immediately, and a client that connects mid-warm just waits on
    the same shared cache entry the warmup is filling. Cancelled on shutdown so
    a half-finished load never holds the process open.
    """
    async def warm_then_announce() -> None:
        await run_warmup()
        await manager.broadcast("server.ready", {})  # clients waiting on a cold server

    task = asyncio.create_task(warm_then_announce())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(
    title="Real-Time VI<->EN Business Meeting Translator",
    version="0.1.0",
    description="Modular STT/NMT/TTS pipeline over WebSocket.",
    lifespan=lifespan,
)

# Open CORS for local hackathon development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(setup_router)  # /setup page + /api/setup (localhost only)


@app.get("/")
async def root() -> dict:
    """Health check + quick capabilities summary."""
    return {
        "status": "ok",
        "service": "vi-en-meeting-translator",
        "modes": list(VALID_MODES),
        "defaultMode": settings.default_mode,
        "glossaries": list_glossaries(),
        "ws": "/ws",
        "setup": "/setup",
    }


@app.get("/app")
async def test_console() -> FileResponse:
    """Serve the single-file browser test console (mic → STT/NMT/TTS → playback)."""
    return FileResponse(STATIC_DIR / "index.html")


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    """Main WebSocket endpoint. One SessionState per connection.

    The connection lifecycle owns cleanup: whether the client sends
    session.end or simply drops, `session.cleanup()` runs in `finally`,
    guaranteeing zero retention of audio/text buffers.
    """
    await ws.accept()
    session = SessionState(mode=settings.default_mode)
    log.info("WebSocket connected.")
    try:
        while True:
            message = await ws.receive_json()
            await dispatch(ws, session, message, manager)
    except WebSocketDisconnect:
        log.info("WebSocket disconnected by client.")
    except Exception as exc:  # noqa: BLE001 - never let the loop crash silently
        log.exception("Unexpected WebSocket error: %s", exc)
    finally:
        # Leave the lobby/room first (notifies peer), then wipe buffers.
        await manager.unregister(session.client_id)
        session.cleanup()  # zero-retention guarantee on any exit path
        log.info("WebSocket closed, session wiped.")
