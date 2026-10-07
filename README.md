# OpenNezt-PTIT — Trình dịch hội thoại thời gian thực (Việt ⇄ Anh)

Ứng dụng dịch song ngữ **Tiếng Việt ⇄ Tiếng Anh** cho các cuộc họp, thời gian thực.
Gồm hai phần độc lập giao tiếp qua **một WebSocket duy nhất** (`ws://<host>:8000/ws`):

| Thư mục | Công nghệ | Vai trò |
|---------|-----------|---------|
| `backend/` | FastAPI + WebSocket (Python) | Pipeline **STT → NMT → TTS** (nhận diện giọng nói → dịch → tổng hợp giọng nói) |
| `frontend/` | Expo / React Native | App di động — luồng **RTT** (Real-Time Translation) là giao diện dịch trực tiếp |

**Sản phẩm chính = ghép cặp 1:1 trong mạng LAN ("chat nội bộ").** Hai thiết bị cùng
trỏ tới một backend trong mạng LAN, tìm thấy nhau ở sảnh chờ (lobby), ghép cặp vào
một phòng 1:1 và dịch cho nhau: khi A nói (tiếng A), B nhận được bản dịch (tiếng B)
**kèm âm thanh TTS**, và ngược lại.

---

## 1. Yêu cầu môi trường

- **Python 3.10+** (cho backend)
- **Node.js 18+** và npm (cho frontend)
- **Expo Go** trên điện thoại (Android/iOS) nếu muốn chạy trên máy thật
- (Tùy chọn) Tài khoản **Groq** miễn phí để dùng chế độ cloud — lấy key tại
  https://console.groq.com/keys (key bắt đầu bằng `gsk_...`)

---

## 2. Chạy Backend

Từ thư mục `backend/`:

### Windows (PowerShell)
```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### macOS / Linux
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

> **Một lệnh cài đủ mọi thứ.** `requirements.txt` đã bao gồm dependency cho **cả ba
> chế độ** (mock / cloud / offline): `faster-whisper`, `ctranslate2`, `sherpa-onnx`,
> `edge-tts`, `piper-tts` và `torch` (bản CPU — dùng để build model offline). Không
> cần cài thêm gói Python nào. (Đã kiểm thử với Python 3.13; 3.10+ đều chạy.)

### Cấu hình `.env`
Sao chép file mẫu rồi điền cấu hình:
```bash
cp .env.example .env      # Windows: copy .env.example .env
```
Các thiết lập quan trọng trong `.env`:

| Biến | Ý nghĩa | Gợi ý |
|------|---------|-------|
| `DEFAULT_MODE` | Chế độ pipeline: `mock` \| `cloud` \| `offline` | `mock` để chạy thử ngay (không cần model/key); `cloud` cần Groq key |
| `GROQ_API_KEY` | Key Groq (cho chế độ cloud) | Bắt buộc nếu `DEFAULT_MODE=cloud` |
| `TTS_ENGINE` | Giọng đọc: `edge` (mặc định, online) \| `piper` (offline) \| `mock` | Xem mục **5.3** để chọn & cài voice |
| `HOST` / `PORT` | Địa chỉ lắng nghe | `0.0.0.0` / `8000` để các máy khác trong LAN kết nối được |

> **Không có key Groq?** Cứ để `DEFAULT_MODE=mock` — pipeline vẫn chạy đầy đủ với dữ
> liệu giả để kiểm thử luồng. Chế độ `cloud` tự động lùi về mock khi thiếu key.

### Khởi động server
```bash
# Chạy phát triển (chỉ máy này truy cập được)
uvicorn app.main:app --reload

# Chạy để các thiết bị khác trong mạng LAN kết nối (dùng cho ghép cặp)
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Sau khi chạy:
- Health check (JSON): http://localhost:8000/
- Console test trong trình duyệt: http://localhost:8000/app
- WebSocket: `ws://localhost:8000/ws`

### Kiểm tra nhanh
```bash
python tools/check_groq_key.py     # kiểm tra Groq key có hoạt động không
```

---

## 3. Chạy Frontend (Expo / React Native)

Từ thư mục `frontend/`:
```bash
cd frontend
npm install
npm start          # mở Expo (nhấn a=Android, i=iOS, w=web)
```
Hoặc chạy thẳng nền tảng:
```bash
npm run android
npm run ios
npm run web
```

Kiểm tra chất lượng code trước khi commit:
```bash
npm run typecheck  # tsc --noEmit
npm run lint       # eslint src/**/*.{ts,tsx}
```

---

## 4. Kết nối hai máy thật trong mạng LAN (ghép cặp 1:1)

1. Chạy backend với `--host 0.0.0.0`:
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```
2. Tìm địa chỉ IPv4 của máy chạy backend:
   - Windows: `ipconfig` → tìm dòng `IPv4 Address` (ví dụ `192.168.1.10`)
   - macOS/Linux: `ifconfig` hoặc `ip addr`
3. **Mở tường lửa** cho cổng TCP 8000 trên máy backend.
4. Trên **cả hai** thiết bị, mở app và vào màn **Chọn ngôn ngữ → "Cài đặt backend"**, đặt WS URL:
   ```
   ws://<lan-ip>:8000/ws
   ```
   (thay `<lan-ip>` bằng IP ở bước 2, ví dụ `ws://192.168.1.10:8000/ws`)
5. Cả hai vào sảnh chờ → thấy nhau → mời & chấp nhận → ghép cặp → nói và nghe bản dịch.

> **Lưu ý về micro trên web:** trình duyệt chỉ cho phép thu âm trên `localhost`/https.
> Vì vậy trên máy thật hãy dùng **Expo Go** (điện thoại), hoặc chạy **Expo Web** trên
> localhost của chính từng máy (chỉ WS URL cần trỏ tới IP LAN).

---

## 5. Ba chế độ pipeline

Cấu hình bằng `DEFAULT_MODE` trong `.env` (hoặc đổi giữa phiên qua `config.update`):

| Chế độ | STT | NMT | Yêu cầu |
|--------|-----|-----|---------|
| **mock** | giả | giả | Không cần gì — chạy ngay |
| **cloud** | Groq Whisper | Groq Llama | `GROQ_API_KEY` |
| **offline** | Faster-Whisper / sherpa / PhoWhisper | NLLB (CTranslate2) / SeaLLM | Model tải về máy |

TTS tách rời khỏi chế độ STT/NMT — luôn chọn theo `TTS_ENGINE`. Vì vậy dù dùng cloud
hay offline, âm thanh vẫn phát bình thường (xem mục 5.3).

### 5.1. Chuẩn bị model STT/NMT cho chế độ offline

> Các lệnh `python tools/...` dưới đây chạy trong thư mục `backend/` **đã kích hoạt venv**
> (xem mục 2). Chúng chỉ cần khi `DEFAULT_MODE=offline`.

```bash
python tools/prepare_nllb.py            # build NLLB (CTranslate2 int8) cho dịch offline
python tools/prepare_phowhisper.py      # build PhoWhisper (STT tiếng Việt offline)
python tools/download_sherpa_models.py  # tải model sherpa-onnx (STT offline)
```
Sau khi build, trỏ đường dẫn tương ứng trong `.env` và đặt engine phù hợp:

| Biến | Ý nghĩa |
|------|---------|
| `STT_ENGINE` | `whisper` (Faster-Whisper đa ngôn ngữ, mặc định) \| `sherpa` \| `phowhisper` |
| `NMT_ENGINE` | `nllb` (NLLB CTranslate2, mặc định) \| `seallm` (LLM local qua Ollama/vLLM) |
| `OFFLINE_NMT_MODEL_DIR` | Thư mục model NLLB đã build (vd `models/nllb-200-distilled-600M-ct2-int8`) |
| `PHOWHISPER_MODEL_DIR` | Thư mục PhoWhisper (khi `STT_ENGINE=phowhisper`) |

### 5.2. Tăng tốc / độ chính xác bằng GPU (offline)

Mặc định STT/NMT offline chạy **CPU + int8** (an toàn, không cần GPU). Trên máy có
**GPU NVIDIA**, sửa `.env` để nhanh hơn nhiều và chính xác hơn:

```dotenv
STT_MODEL_SIZE=large-v3     # to hơn = chính xác hơn (tiny/base/small/medium/large-v3)
STT_DEVICE=cuda
STT_COMPUTE_TYPE=float16
OFFLINE_NMT_DEVICE=cuda
OFFLINE_NMT_COMPUTE_TYPE=float16
OFFLINE_NMT_BEAM_FINAL=5
```

> **Tự động vá lỗi MKL.** CTranslate2 (STT + NMT offline) mặc định dùng Intel-MKL,
> hay lỗi `mkl_malloc: failed to allocate memory` trên một số máy Windows/CPU ít RAM.
> Backend đã **tự đặt `CT2_USE_MKL=0`** (trong `app/__init__.py`) để dùng backend
> oneDNN ổn định. Muốn ép dùng lại MKL: đặt `CT2_USE_MKL=1` trong môi trường.

### 5.3. Giọng đọc (TTS) — chọn `edge` hoặc `piper`

| `TTS_ENGINE` | Đặc điểm | Cần gì |
|--------------|----------|--------|
| `edge` (mặc định) | Giọng neural VN+EN thật, chất lượng cao | **Internet** (endpoint online của Microsoft) — không cần key/model |
| `piper` | Chạy **offline hoàn toàn**, không cần mạng khi vận hành | Tải voice model một lần (lệnh dưới) |
| `mock` | Clip im lặng (chỉ để test luồng) | — |

Dùng Piper offline — tải voice VI + EN (một lần, cần internet lúc tải ~120MB):
```bash
python tools/download_piper_models.py    # -> models/tts/vi/ + models/tts/en/
```
rồi đặt trong `.env`:
```dotenv
TTS_ENGINE=piper
PIPER_MODELS_DIR=models/tts
```
Đổi giọng khác: `python tools/download_piper_models.py --vi-voice vi_VN-25hours_single-low --en-voice en_US-amy-medium`

---

## 6. Cấu trúc dự án

```
OpenNezt-PTIT/
├── backend/          # FastAPI + WebSocket pipeline STT→NMT→TTS
│   ├── app/          # main.py (/ws), ws/handler.py, providers/, core/
│   ├── tools/        # script kiểm tra & chuẩn bị model
│   ├── static/       # console test trình duyệt (phục vụ ở /app)
│   └── .env.example  # mẫu cấu hình
├── frontend/         # App Expo / React Native
│   └── src/screens/       # Language · Devices · Invite · Meeting · EndSession
└── CLAUDE.md         # tài liệu kiến trúc chi tiết cho lập trình viên
```

Muốn hiểu sâu kiến trúc (mô hình provider, luồng ghép cặp, giao thức WebSocket),
đọc [CLAUDE.md](CLAUDE.md) và [frontend/claude.md](frontend/claude.md).

---

## 7. Xử lý sự cố thường gặp

| Vấn đề | Cách xử lý |
|--------|-----------|
| Hai máy không thấy nhau | Kiểm tra cùng mạng LAN, backend chạy `--host 0.0.0.0`, đã mở tường lửa cổng 8000, WS URL đúng IP |
| Không có âm thanh dịch | Bật TTS (client gửi `config.update {ttsOn}`). Với `edge`: cần internet. Với `piper`: phải chạy `python tools/download_piper_models.py` để có voice trong `models/tts/` (thiếu voice → lỗi bị nuốt, mất tiếng âm thầm) |
| Lỗi thiếu Groq key | Đặt `GROQ_API_KEY` trong `.env`, hoặc dùng `DEFAULT_MODE=mock` để chạy thử |
| Micro không hoạt động trên web | Dùng `localhost` hoặc https; trên máy thật dùng Expo Go |
| `Unable to open file 'model.bin' in model '...-ct2-int8'` | Chưa build model offline — chạy `python tools/prepare_nllb.py` (torch CPU đã có sẵn trong `requirements.txt`). Hoặc đổi `DEFAULT_MODE=mock`/`cloud` nếu không cần offline |
| `mkl_malloc: failed to allocate memory` (offline) | Đã tự vá (`CT2_USE_MKL=0` trong `app/__init__.py`). Nếu vẫn gặp, đảm bảo đã restart backend; hoặc chạy `python -m pip install piper-tts` đúng **venv** đang chạy |
| Đổi Piper mà không ra tiếng | Cài `piper-tts` vào **đúng venv** (`python -m pip install piper-tts`, không phải `pip` global) và tải voice bằng `python tools/download_piper_models.py` |
| In tiếng Việt bị lỗi ký tự (Windows) | Đặt biến môi trường `PYTHONIOENCODING=utf-8` |
