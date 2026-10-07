"""Location + line-preserving writer for the backend `.env` file.

Kept free of `settings` on purpose: `run_server.py` must create `.env` BEFORE
`core.config` is imported (pydantic-settings reads the file at import time).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# `.env` sits next to the exe (frozen) or in backend/ (dev). Absolute, so the
# server finds it whatever the CWD and /setup writes the file actually read.
BASE_DIR = (
    Path(sys.executable).parent
    if getattr(sys, "frozen", False)
    else Path(__file__).resolve().parents[2]
)
ENV_PATH = BASE_DIR / ".env"
# `.env.example` is bundled into the exe's temp dir (sys._MEIPASS) when frozen.
TEMPLATE_PATH = Path(getattr(sys, "_MEIPASS", BASE_DIR)) / ".env.example"

_KEY_LINE = re.compile(r"\s*([A-Za-z_][A-Za-z0-9_]*)\s*=")


def write_env(updates: dict[str, str], path: Path = ENV_PATH, template: Path = TEMPLATE_PATH) -> None:
    """Set `updates` in the .env file, keeping comments and unrelated lines.

    Existing `KEY=` lines are rewritten in place; missing keys are appended. A
    missing file starts from the template (so the setup guide comments survive).
    """
    for key, value in updates.items():
        if "\n" in value or "\r" in value:
            raise ValueError(f"{key}: value must be a single line")
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines()
    elif template.exists():
        lines = template.read_text(encoding="utf-8").splitlines()
    else:
        lines = []
    pending = {k.upper(): v for k, v in updates.items()}
    for i, line in enumerate(lines):
        m = _KEY_LINE.match(line)
        key = m.group(1).upper() if m else None
        if key in pending:
            lines[i] = f"{key}={pending.pop(key)}"
    lines += [f"{k}={v}" for k, v in pending.items()]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
