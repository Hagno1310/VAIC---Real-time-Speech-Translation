"""In-RAM lobby + 1:1 room registry for LAN device pairing.

Every WebSocket that sends `hello` is registered here as a *client*. Clients see
each other in a lobby, invite one another, and pair into a 1:1 *room*. Once two
clients share a room, the handler routes each speaker's translation + TTS audio
to the *other* member (see `handler._emit`).

This module is transport/orchestration only. It holds no audio/text — those stay
in each connection's `SessionState` (zero-retention). The registry itself is a
process-global singleton (`manager`) living purely in memory.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from ..core.config import settings

if TYPE_CHECKING:  # avoid import cycle at runtime
    from fastapi import WebSocket

    from ..core.session import SessionState

log = logging.getLogger("ws.rooms")


@dataclass
class Client:
    """A registered, lobby-visible connection."""

    id: str
    ws: "WebSocket" = field(repr=False)
    session: "SessionState" = field(repr=False)
    name: str
    lang: str
    room_id: str | None = None


class ConnectionManager:
    """Process-global registry of online clients and their 1:1 rooms."""

    def __init__(self) -> None:
        self._clients: dict[str, Client] = {}
        self._rooms: dict[str, tuple[str, str]] = {}  # room_id -> (id_a, id_b)

    # -- registration ------------------------------------------------------ #
    def register(self, ws: "WebSocket", session: "SessionState", name: str, lang: str) -> str:
        """Add a client to the lobby and return its server-assigned id."""
        client_id = uuid.uuid4().hex[:8]
        self._clients[client_id] = Client(
            id=client_id, ws=ws, session=session, name=name, lang=lang
        )
        log.info("Client registered id=%s name=%s lang=%s", client_id, name, lang)
        return client_id

    async def unregister(self, client_id: str | None) -> None:
        """Remove a client (on disconnect); notify + free its peer if roomed."""
        if not client_id or client_id not in self._clients:
            return
        await self.leave_room(client_id, reason="peer_disconnected")
        self._clients.pop(client_id, None)
        log.info("Client unregistered id=%s", client_id)
        await self.broadcast_lobby()

    def update_identity(
        self, client_id: str | None, name: str | None, lang: str | None
    ) -> bool:
        """Update a registered client's display name and/or language in place.

        Used when a device re-sends `hello` to CHANGE its pick (e.g. it chose the
        wrong language). Returns True if the client existed and was updated. A
        no-op (returns False) for an unknown/unregistered client. Does NOT touch
        a client already in a room — changing language mid-room would need both
        sessions re-started, which the lobby flow never does.
        """
        c = self._clients.get(client_id) if client_id else None
        if c is None or c.room_id is not None:
            return False
        if name:
            c.name = name
        if lang:
            c.lang = lang
        log.info("Client %s identity updated name=%s lang=%s", client_id, c.name, c.lang)
        return True

    def client(self, client_id: str | None) -> Client | None:
        return self._clients.get(client_id) if client_id else None

    def peer_id_of(self, client_id: str | None) -> str | None:
        """The other member of this client's room, or None if not roomed."""
        c = self._clients.get(client_id) if client_id else None
        if c is None or c.room_id is None:
            return None
        a, b = self._rooms.get(c.room_id, (None, None))
        return b if client_id == a else a

    # -- lobby ------------------------------------------------------------- #
    def lobby_snapshot(self) -> list[dict]:
        return [
            {"clientId": c.id, "name": c.name, "lang": c.lang, "busy": c.room_id is not None}
            for c in self._clients.values()
        ]

    async def broadcast(self, event: str, data: dict) -> None:
        """Send one event to every registered client (lobby or room)."""
        for c in list(self._clients.values()):
            await self._safe_send(c.ws, event, data)

    async def broadcast_lobby(self) -> None:
        """Push the current device list to every client NOT in a room.

        Each recipient's list excludes itself.
        """
        snap = self.lobby_snapshot()
        for c in list(self._clients.values()):
            if c.room_id is not None:
                continue
            devices = [d for d in snap if d["clientId"] != c.id]
            await self._safe_send(c.ws, "lobby", {"devices": devices})

    # -- rooms ------------------------------------------------------------- #
    async def form_room(self, a_id: str, b_id: str) -> str | None:
        """Pair two lobby clients into a 1:1 room and start both sessions.

        Returns the room id, or None if either client is gone or busy in a
        *different* room. Idempotent when the pair is already roomed together
        (handles both sides accepting a mutual invite).
        """
        a = self._clients.get(a_id)
        b = self._clients.get(b_id)
        if a is None or b is None or a_id == b_id:
            return None
        if a.room_id and a.room_id == b.room_id:
            return a.room_id  # already paired — idempotent
        if a.room_id or b.room_id:
            return None  # one is busy elsewhere

        room_id = uuid.uuid4().hex[:8]
        a.room_id = room_id
        b.room_id = room_id
        self._rooms[room_id] = (a_id, b_id)

        # Each side translates its own language into the peer's language.
        a.session.start(settings.default_mode, a.lang, b.lang)
        b.session.start(settings.default_mode, b.lang, a.lang)
        log.info("Room %s formed: %s(%s) <-> %s(%s)", room_id, a_id, a.lang, b_id, b.lang)

        await self.send_to(a_id, "room.joined", {
            "roomId": room_id,
            "peer": {"clientId": b_id, "name": b.name, "lang": b.lang},
        })
        await self.send_to(b_id, "room.joined", {
            "roomId": room_id,
            "peer": {"clientId": a_id, "name": a.name, "lang": a.lang},
        })
        await self.broadcast_lobby()
        return room_id

    async def leave_room(self, client_id: str, reason: str = "left") -> None:
        """Dissolve the client's room (if any) and notify the peer."""
        c = self._clients.get(client_id)
        if c is None or c.room_id is None:
            return
        room_id = c.room_id
        peer_id = self.peer_id_of(client_id)
        self._rooms.pop(room_id, None)
        c.room_id = None
        peer = self._clients.get(peer_id) if peer_id else None
        if peer is not None:
            peer.room_id = None
            await self.send_to(peer_id, "room.closed", {"reason": reason})
        log.info("Room %s closed (reason=%s)", room_id, reason)
        await self.broadcast_lobby()

    # -- transport --------------------------------------------------------- #
    async def send_to(self, client_id: str | None, event: str, data: dict) -> None:
        c = self._clients.get(client_id) if client_id else None
        if c is None:
            return
        await self._safe_send(c.ws, event, data)

    @staticmethod
    async def _safe_send(ws: "WebSocket", event: str, data: dict) -> None:
        try:
            await ws.send_json({"type": event, "data": data})
        except Exception as exc:  # noqa: BLE001 - a dead socket must not break others
            log.debug("send_to dropped (%s): %s", event, exc)


# Process-global singleton: all connections share one lobby/room registry.
manager = ConnectionManager()
