import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.env_file import write_env
from app.main import app
from app.setup_api import config_warnings, restart_command, validate


def test_write_env_keeps_comments_and_appends(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# guide\nDEFAULT_MODE=mock\n# GROQ_API_KEY=commented\nGROQ_API_KEY=\n", encoding="utf-8")
    write_env({"DEFAULT_MODE": "cloud", "GROQ_API_KEY": "gsk_x", "TTS_ENGINE": "edge"}, path=env)
    assert env.read_text(encoding="utf-8") == (
        "# guide\nDEFAULT_MODE=cloud\n# GROQ_API_KEY=commented\nGROQ_API_KEY=gsk_x\nTTS_ENGINE=edge\n"
    )


def test_write_env_starts_from_template(tmp_path):
    tpl = tmp_path / ".env.example"
    tpl.write_text("# hi\nDEFAULT_MODE=mock\n", encoding="utf-8")
    write_env({"DEFAULT_MODE": "offline"}, path=tmp_path / ".env", template=tpl)
    assert (tmp_path / ".env").read_text(encoding="utf-8") == "# hi\nDEFAULT_MODE=offline\n"


def test_write_env_rejects_newline_injection(tmp_path):
    with pytest.raises(ValueError):
        write_env({"GROQ_API_KEY": "x\nDEFAULT_MODE=mock"}, path=tmp_path / ".env")


def test_validate():
    assert validate({"DEFAULT_MODE": "cloud", "GROQ_API_KEY": "", "STT_SILENCE_RMS": "0.01"}) == {
        "DEFAULT_MODE": "cloud", "STT_SILENCE_RMS": "0.01",  # empty secret = keep old
    }
    for bad in ({"DEFAULT_MODE": "turbo"}, {"STT_SILENCE_RMS": "abc"}, {"OFFLINE_NMT_MODEL_DIR": "x"}):
        with pytest.raises(HTTPException):
            validate(bad)


def test_warnings():
    assert config_warnings({"DEFAULT_MODE": "cloud"})  # no Groq key -> mock fallback
    assert not config_warnings({"DEFAULT_MODE": "cloud", "GROQ_API_KEY": "k", "TTS_ENGINE": "edge"})


def test_restart_command():
    assert restart_command(["uvicorn", "app.main:app", "--reload"], "py", False) is None
    assert restart_command(["C:/venv/Scripts/uvicorn.exe", "app.main:app"], "py", False) == ["py", "-m", "uvicorn", "app.main:app"]
    assert restart_command(["run_server.py", "--port", "8000"], "py", False) == ["py", "run_server.py", "--port", "8000"]
    assert restart_command(["C:/x/opennezt-backend.exe"], "C:/x/opennezt-backend.exe", True) == ["C:/x/opennezt-backend.exe"]


def test_setup_is_localhost_only():
    # TestClient's peer is "testclient", i.e. not this machine -> 403.
    client = TestClient(app)
    assert client.get("/api/setup").status_code == 403
    assert client.post("/api/setup", json={"DEFAULT_MODE": "mock"}).status_code == 403
