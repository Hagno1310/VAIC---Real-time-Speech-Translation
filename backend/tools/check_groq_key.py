"""Kiểm tra nhanh một Groq API key: hợp lệ chưa, gọi chat được không.

Gửi đúng MỘT request chat/completions tối thiểu và diễn giải kết quả ra tiếng
Việt, để bạn biết key có dùng được cho chế độ cloud (Groq) hay không TRƯỚC khi
chạy cả pipeline.

Cách dùng (từ backend/):
    python tools/check_groq_key.py                 # đọc GROQ_API_KEY trong .env
    python tools/check_groq_key.py gsk_XXXX...      # kiểm tra key truyền trực tiếp
    python tools/check_groq_key.py --model llama-3.1-8b-instant
"""
from __future__ import annotations

import argparse
import os
import sys

import httpx

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

_BASE_URL = "https://api.groq.com/openai/v1"


def load_key_from_env() -> str | None:
    """Đọc GROQ_API_KEY từ .env (đơn giản, không cần pydantic)."""
    key = os.environ.get("GROQ_API_KEY")
    if key:
        return key
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    try:
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("GROQ_API_KEY=") and "=" in line:
                    return line.split("=", 1)[1].strip() or None
    except OSError:
        pass
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Kiểm tra Groq API key.")
    parser.add_argument("key", nargs="?", default=None,
                        help="API key cần kiểm tra (mặc định: đọc từ .env).")
    parser.add_argument("--model", default="qwen/qwen3.8-27b",
                        help="Model để thử (mặc định: qwen/qwen3.8-27b).")
    args = parser.parse_args()

    key = args.key or load_key_from_env()
    if not key:
        print("❌ Không tìm thấy key. Truyền trực tiếp hoặc điền GROQ_API_KEY trong .env.")
        sys.exit(2)

    fmt = "gsk_ (chuẩn Groq)" if key.startswith("gsk_") else "KHÁC (không phải gsk_...)"
    print(f"→ Key: {key[:6]}...  (dài {len(key)} ký tự, dạng: {fmt})")
    print(f"→ Model: {args.model}\n")

    url = f"{_BASE_URL}/chat/completions"
    payload = {
        "model": args.model,
        "messages": [
            {"role": "system", "content": "You are a Vietnamese-to-English interpreter. Return ONLY the translation."},
            {"role": "user", "content": "Xin chào, rất vui được gặp bạn."},
        ],
        "temperature": 0.0,
    }
    try:
        resp = httpx.post(url, headers={"Authorization": f"Bearer {key}"}, json=payload, timeout=45.0)
    except httpx.HTTPError as e:
        print(f"❌ Không gọi được API: {e}")
        sys.exit(1)

    body = resp.json()
    if resp.status_code == 200:
        try:
            text = body["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError):
            text = "(không đọc được nội dung nhưng HTTP 200)"
        print(f"✅ KEY DÙNG ĐƯỢC. Dịch thử 'Xin chào...' -> {text!r}")
        print("   → Điền key vào GROQ_API_KEY (hoặc GROQ_STT/NMT_API_KEY) trong .env.")
        return

    err = body.get("error", {})
    msg = err.get("message", "") if isinstance(err, dict) else str(err)
    print(f"❌ HTTP {resp.status_code}")
    if resp.status_code == 401:
        print("   → Key sai/không hợp lệ. Kiểm tra lại tại https://console.groq.com/keys")
    elif resp.status_code == 429:
        print("   → Chạm rate limit tạm thời. Đợi chút rồi thử lại.")
    elif resp.status_code == 404:
        print("   → Model không tồn tại. Thử --model llama-3.1-8b-instant.")
    print(f"\n--- Chi tiết ---\n{msg[:500]}")
    sys.exit(1)


if __name__ == "__main__":
    main()
