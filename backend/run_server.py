"""Entry point cho backend đóng gói (PyInstaller) — chạy offline, tự tìm model.

Khi chạy dưới dạng exe (frozen), model được ship trong thư mục `models/` NẰM CẠNH
exe. Lần chạy đầu (chưa có `.env` cạnh exe) script sinh `.env` với mặc định offline
trỏ tới các model đó rồi mở trình duyệt vào trang cấu hình `/setup`. Từ đó `.env`
là nguồn cấu hình duy nhất (sửa qua `/setup`), không dùng biến môi trường ẩn.

Layout khi đóng gói:
    <exe_dir>/
        opennezt-backend.exe
        models/
            nllb-200-distilled-600M-ct2-int8/   (NMT)
            phowhisper-large-ct2/                (STT VI, PhoWhisper CT2)
            whisper-small/                       (STT EN, CT2 faster-whisper)
            tts/vi , tts/en                      (Piper voices)
"""
from __future__ import annotations

import argparse
import os
import sys


def _base_dir() -> str:
    """Thư mục chứa exe (frozen) hoặc thư mục backend (dev)."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def _ensure_env() -> bool:
    """Bản exe: lần đầu chưa có `.env` thì sinh từ `.env.example` + mặc định
    offline trỏ tới model cạnh exe. Trả True nếu vừa tạo (→ mở trang /setup).

    Chế độ dev (chạy bằng python) thì bỏ qua để `.env` của dev điều khiển.
    """
    if not getattr(sys, "frozen", False):
        return False
    from app.core.env_file import ENV_PATH, write_env  # không đụng tới settings

    if ENV_PATH.exists():
        return False
    models = os.path.join(_base_dir(), "models")
    write_env({
        "DEFAULT_MODE": "offline",
        # PhoWhisper (VinAI) for VI + standard Whisper for EN.
        "STT_ENGINE": "phowhisper",
        "TTS_ENGINE": "piper",
        "OFFLINE_NMT_MODEL_DIR": os.path.join(models, "nllb-200-distilled-600M-ct2-int8"),
        "PHOWHISPER_MODEL_DIR": os.path.join(models, "phowhisper-large-ct2"),
        # EN half of phowhisper: reuse the local whisper-small CT2 dir (offline,
        # no HuggingFace download at runtime).
        "WHISPER_EN_MODEL": os.path.join(models, "whisper-small"),
        "PIPER_MODELS_DIR": os.path.join(models, "tts"),
    })
    return True


def main() -> None:
    # Tạo .env TRƯỚC khi import app (config đọc .env lúc import).
    first_run = _ensure_env()

    import uvicorn

    from app.core.config import settings
    from app.main import app  # import sau khi .env đã sẵn

    ap = argparse.ArgumentParser(description="OpenNezt backend (offline, self-contained).")
    ap.add_argument("--host", default=settings.host)
    ap.add_argument("--port", type=int, default=settings.port)
    args = ap.parse_args()

    if first_run:
        import threading
        import webbrowser

        url = f"http://localhost:{args.port}/setup"
        threading.Timer(2.0, webbrowser.open, [url]).start()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
