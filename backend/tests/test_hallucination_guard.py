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
