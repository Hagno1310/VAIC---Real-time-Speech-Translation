from app.core.audio_utils import looks_like_hallucination
from app.providers.groq_client import extract_transcript


def test_padded_canned_phrases_are_dropped():
    assert looks_like_hallucination(
        "Hãy subscribe cho kênh Ghiền Mì Gõ Để không bỏ lỡ những video hấp dẫn"
    )
    assert looks_like_hallucination("Hẹn gặp lại các bạn trong những video tiếp theo.")


def test_real_speech_is_kept():
    assert not looks_like_hallucination("Chúng ta cần subscribe gói dịch vụ cloud mới.")
    assert not looks_like_hallucination("Thank you for the report, revenue grew 2.5%.")


def test_no_speech_segments_are_filtered():
    resp = {
        "text": "Doanh thu tăng. Hẹn gặp lại",
        "segments": [
            {"text": " Doanh thu tăng.", "no_speech_prob": 0.02},
            {"text": " Hẹn gặp lại", "no_speech_prob": 0.9},
        ],
    }
    assert extract_transcript(resp) == "Doanh thu tăng."
    assert extract_transcript({"text": "x", "segments": [{"text": "x", "no_speech_prob": 0.8}]}) == ""


def test_noise_never_reaches_whisper():
    import io, wave

    import numpy as np
    from app.core.audio_utils import speech_only

    noise = np.random.default_rng(1).normal(0, 0.03, 48000)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1), w.setsampwidth(2), w.setframerate(16000)
        w.writeframes((noise * 32767).astype("<i2").tobytes())
    assert speech_only(buf.getvalue()) is None  # loud, but no voice


def test_peer_language_echo_is_rejected():
    from app.providers.groq_client import spoken_in

    assert spoken_in({"language": "Vietnamese"}, "vi") is True
    assert spoken_in({"language": "English"}, "vi") is False  # peer TTS echo
    assert spoken_in({"language": "english"}, "en") is True
    assert spoken_in({"language": "Chinese"}, "vi") is None  # unsure -> forced retry
