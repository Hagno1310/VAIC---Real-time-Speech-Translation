"""`/setup` — local configuration page instead of hand-editing `.env`.

Only reachable from the machine running the server: the backend listens on
0.0.0.0 for LAN pairing, but any LAN device (or a web page in this machine's
browser, since CORS is "*") must not be able to read or rewrite API keys.

Saved values go to `.env` (the single source of truth) and take effect on
restart; `POST /api/setup/restart` re-launches the process for the user.
"""
from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

from dotenv import dotenv_values
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from .core.config import Settings, settings
from .core.env_file import ENV_PATH, write_env
from .ws.rooms import manager

log = logging.getLogger("app.setup")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}

# (KEY, label, group, kind, options). kind: select | secret | text | number.
FIELDS: list[tuple[str, str, str, str, list[str]]] = [
    ("DEFAULT_MODE", "Chế độ dịch", "Chung", "select", ["mock", "cloud", "offline"]),
    ("GROQ_API_KEY", "Groq API key (dùng chung STT + NMT)", "Groq (cloud)", "secret", []),
    ("GROQ_STT_API_KEY", "Groq key riêng cho STT (tuỳ chọn)", "Groq (cloud)", "secret", []),
    ("GROQ_NMT_API_KEY", "Groq key riêng cho NMT (tuỳ chọn)", "Groq (cloud)", "secret", []),
    ("NMT_ENGINE", "Engine dịch", "Dịch (NMT)", "select", ["nllb", "seallm", "sealion"]),
    ("SEALION_API_KEY", "SEA-LION API key", "Dịch (NMT)", "secret", []),
    ("OFFLINE_NMT_DEVICE", "Thiết bị NMT offline", "Dịch (NMT)", "select", ["cpu", "cuda"]),
    ("OFFLINE_NMT_COMPUTE_TYPE", "Độ chính xác NMT offline", "Dịch (NMT)", "select", ["int8", "float16", "float32"]),
    ("STT_ENGINE", "Engine nhận dạng giọng nói (offline)", "Nhận dạng (STT)", "select", ["whisper", "sherpa", "phowhisper"]),
    ("STT_DEVICE", "Thiết bị STT offline", "Nhận dạng (STT)", "select", ["cpu", "cuda"]),
    ("STT_COMPUTE_TYPE", "Độ chính xác STT offline", "Nhận dạng (STT)", "select", ["int8", "float16", "float32"]),
    ("STT_SILENCE_RMS", "Ngưỡng im lặng (tăng nếu tạp âm ra chữ)", "Nhận dạng (STT)", "number", []),
    ("STT_VAD_THRESHOLD", "Bộ lọc giọng người 0..1 (tăng nếu tạp âm ra chữ)", "Nhận dạng (STT)", "number", []),
    ("STT_MIN_SPEECH_MS", "Đoạn nói ngắn nhất (ms)", "Nhận dạng (STT)", "number", []),
    ("TTS_ENGINE", "Engine đọc", "Đọc (TTS)", "select", ["edge", "piper", "mock"]),
    ("EDGE_VOICE_VI", "Giọng tiếng Việt (edge)", "Đọc (TTS)", "text", []),
    ("EDGE_VOICE_EN", "Giọng tiếng Anh (edge)", "Đọc (TTS)", "text", []),
]
_FIELD = {f[0]: f for f in FIELDS}


def require_local(request: Request) -> None:
    """403 unless the request comes from, and targets, this machine."""
    client = request.client.host if request.client else ""
    origin = request.headers.get("origin")
    if (
        client not in LOCAL_HOSTS
        or request.url.hostname not in LOCAL_HOSTS  # blocks DNS rebinding
        or (origin and urlparse(origin).hostname not in LOCAL_HOSTS)  # blocks CSRF
    ):
        raise HTTPException(403, "Trang cấu hình chỉ mở được trên máy chạy server (localhost).")


router = APIRouter(dependencies=[Depends(require_local)])


def effective_values() -> dict[str, str]:
    """Every setting as saved in .env (falls back to the running value)."""
    saved = {k.upper(): v for k, v in dotenv_values(ENV_PATH).items()} if ENV_PATH.exists() else {}
    vals = {}
    for name in Settings.model_fields:
        key = name.upper()
        running = getattr(settings, name)
        vals[key] = saved[key] if key in saved else ("" if running is None else str(running))
    return vals


def mask(secret: str) -> str:
    return f"{secret[:4]}…{secret[-4:]}" if len(secret) > 10 else ("••••" if secret else "")


def _is_dir(p: str | None) -> bool:
    return bool(p) and Path(p).is_dir()


def config_warnings(v: dict[str, str]) -> list[str]:
    """Missing prerequisites for the chosen options. Warn, never block saving."""
    out = []
    mode = v.get("DEFAULT_MODE")
    has_groq = any(v.get(k) for k in ("GROQ_API_KEY", "GROQ_STT_API_KEY", "GROQ_NMT_API_KEY"))
    if mode == "cloud" and not has_groq:
        out.append("Chế độ cloud chưa có Groq API key → sẽ chạy mock (kết quả giả).")
    if mode in ("cloud", "offline") and v.get("NMT_ENGINE") == "sealion" and not v.get("SEALION_API_KEY"):
        out.append("NMT_ENGINE=sealion nhưng chưa có SEALION_API_KEY.")
    if mode == "offline":
        if v.get("NMT_ENGINE") == "nllb" and not _is_dir(v.get("OFFLINE_NMT_MODEL_DIR")):
            out.append("Offline NMT (nllb) chưa có model: chạy tools/prepare_nllb.py và đặt OFFLINE_NMT_MODEL_DIR.")
        if v.get("STT_ENGINE") == "phowhisper" and not _is_dir(v.get("PHOWHISPER_MODEL_DIR")):
            out.append("STT phowhisper chưa có model: chạy tools/prepare_phowhisper.py và đặt PHOWHISPER_MODEL_DIR.")
    if v.get("TTS_ENGINE") == "piper" and not _is_dir(v.get("PIPER_MODELS_DIR")):
        out.append("TTS piper chưa có giọng: chạy tools/download_piper_models.py.")
    return out


def validate(body: dict) -> dict[str, str]:
    """Turn the posted form into .env updates. Empty secret = keep the old one."""
    updates = {}
    for key, raw in body.items():
        field = _FIELD.get(key)
        if field is None:
            raise HTTPException(400, f"Không hỗ trợ sửa {key} ở đây.")
        _, label, _, kind, options = field
        value = str(raw).strip()
        if "\n" in value or "\r" in value:
            raise HTTPException(400, f"{label}: không được xuống dòng.")
        if kind == "secret" and not value:
            continue
        if kind == "select" and value not in options:
            raise HTTPException(400, f"{label}: giá trị không hợp lệ.")
        if kind == "number":
            try:
                float(value)
            except ValueError:
                raise HTTPException(400, f"{label}: phải là số.") from None
        updates[key] = value
    return updates


@router.get("/setup", include_in_schema=False)
async def setup_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "setup.html")


@router.get("/api/setup")
async def get_setup() -> dict:
    v = effective_values()
    fields = []
    for key, label, group, kind, options in FIELDS:
        item = {"key": key, "label": label, "group": group, "kind": kind, "options": options}
        if kind == "secret":
            item.update(isSet=bool(v[key]), masked=mask(v[key]))
        else:
            item["value"] = v[key]
        fields.append(item)
    return {
        "fields": fields,
        "warnings": config_warnings(v),
        # Process env beats .env in pydantic-settings → these edits won't apply.
        "envOverrides": [k for k, *_ in FIELDS if k in os.environ],
        "connectedDevices": len(manager.lobby_snapshot()),
        "envPath": str(ENV_PATH),
    }


@router.post("/api/setup")
async def save_setup(body: dict) -> dict:
    updates = validate(body)
    write_env(updates)
    log.info("Setup saved: %s", ", ".join(sorted(updates)))
    return {"ok": True, "warnings": config_warnings(effective_values())}


@router.post("/api/setup/test-key")
async def test_key(body: dict) -> dict:
    """Translate one phrase with the given (or saved) key — checks key AND model."""
    from .providers import groq_client

    v = effective_values()
    provider = body.get("provider")
    if provider == "groq":
        key = body.get("key") or v["GROQ_NMT_API_KEY"] or v["GROQ_API_KEY"]
        url, model = v["GROQ_API_URL"], v["GROQ_NMT_MODEL"]
    elif provider == "sealion":
        key = body.get("key") or v["SEALION_API_KEY"]
        url, model = v["SEALION_API_URL"], v["SEALION_MODEL"]
    else:
        raise HTTPException(400, "provider phải là groq hoặc sealion.")
    if not key:
        return {"ok": False, "message": "Chưa nhập key."}
    try:
        out = await groq_client.translate_text(key, url, model, "Xin chào", "vi", "en")
    except Exception as exc:  # noqa: BLE001 - surface any failure to the page
        return {"ok": False, "message": str(exc)[:300]}
    return {"ok": True, "message": f'Dùng được ({model}): "Xin chào" → "{out}"'}


def restart_command(argv: list[str], executable: str, frozen: bool) -> list[str] | None:
    """Command that re-launches this server, or None under `uvicorn --reload`
    (the reloader restarts us when a watched .py file changes)."""
    if "--reload" in argv:
        return None
    if frozen:
        return [executable, *argv[1:]]
    entry = Path(argv[0])
    if entry.stem == "uvicorn" or "uvicorn" in entry.parts:
        return [executable, "-m", "uvicorn", *argv[1:]]
    return [executable, *argv]


def _restart() -> None:
    cmd = restart_command(sys.argv, sys.executable, getattr(sys, "frozen", False))
    if cmd is None:
        log.info("Restart: touching config.py so the --reload watcher restarts the worker.")
        os.utime(Path(__file__).parent / "core" / "config.py")
        return
    log.info("Restart: re-launching %s", cmd)
    # ponytail: new process races the old one for the port; it needs ~1s to import
    # before binding, by which time os._exit has released it.
    subprocess.Popen(cmd)
    os._exit(0)


@router.post("/api/setup/restart")
async def restart() -> dict:
    asyncio.get_running_loop().call_later(0.5, _restart)  # let this response go out first
    return {"ok": True}
