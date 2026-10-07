/**
 * audioPlayback — phát clip base64 nhận từ `tts.audio`, theo HÀNG ĐỢI TUẦN TỰ.
 *
 * Khi cắt nhiều segment, backend gửi nhiều `tts.audio`; phát ngay lập tức sẽ
 * CHỒNG tiếng. Nên xếp hàng và phát lần lượt (clip xong mới clip kế) — giống
 * reference client (backend/static/index.html · enqueueAudio/playNext).
 *
 * Backend edge-tts trả **MP3**; mock trả **WAV** (nhận diện qua header base64).
 *
 * Đa nền tảng:
 *   - Native (iOS/Android): ghi file tạm (expo-file-system) rồi phát bằng
 *     expo-audio.
 *   - Web (Expo Web/desktop): expo-file-system KHÔNG hoạt động (không có
 *     cacheDirectory) → phát thẳng qua phần tử <audio> với data URI.
 */
import { createAudioPlayer } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

type Clip = { base64: string; onStart?: (durationMs: number) => void };
const queue: Clip[] = [];
let busy = false;
let seq = 0;

// Mỗi clip TTS kết thúc gần như không có khoảng lặng → các câu phát dính liền,
// nghe như đọc một mạch không lấy hơi. Chèn một nhịp nghỉ cuối câu giữa hai clip
// liền nhau (chỉ phần còn thiếu: clip tới muộn thì khoảng trống đã đủ sẵn).
const SENTENCE_GAP_MS = 380;
let lastEndedAt = 0;

/**
 * Xếp một clip base64 vào hàng đợi; tự phát nếu đang rảnh.
 * `onStart` (tuỳ chọn) được gọi TỐI ĐA MỘT LẦN khi clip thật sự bắt đầu phát,
 * kèm độ dài clip (ms) — dùng để đồng bộ chữ chạy với giọng đọc.
 */
export function playBase64Audio(base64: string, onStart?: (durationMs: number) => void): void {
  if (!base64) return;
  queue.push({ base64, onStart });
  if (!busy) void playNext();
}

async function playNext(): Promise<void> {
  const clip = queue.shift();
  if (!clip) {
    busy = false;
    return;
  }
  busy = true;
  const wait = lastEndedAt + SENTENCE_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  const { base64, onStart } = clip;

  // Chuyển sang clip kế đúng MỘT lần (dù nhận được nhiều sự kiện kết thúc).
  let done = false;
  const advance = (player?: { remove: () => void }) => {
    if (done) return;
    done = true;
    lastEndedAt = Date.now();
    if (player) {
      try {
        player.remove();
      } catch {
        /* noop */
      }
    }
    void playNext();
  };

  const ext = base64.startsWith('UklGR') ? 'wav' : 'mp3';

  // WEB: phát trực tiếp bằng data URI (không ghi file).
  if (Platform.OS === 'web') {
    try {
      const mime = ext === 'wav' ? 'audio/wav' : 'audio/mpeg';
      const audio = new Audio(`data:${mime};base64,${base64}`);
      let started = false;
      const fireStart = () => {
        if (started || !onStart) return;
        const ms = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
        if (ms > 0) {
          started = true;
          onStart(ms);
        }
      };
      audio.onloadedmetadata = fireStart;
      audio.onplay = fireStart;
      audio.onended = () => advance();
      audio.onerror = () => advance();
      // Chốt an toàn nếu không nhận được 'ended'.
      setTimeout(() => advance(), 30000);
      // Có thể bị chặn nếu trang chưa có tương tác người dùng → bỏ qua clip.
      await audio.play();
      fireStart();
    } catch {
      advance();
    }
    return;
  }

  // NATIVE: ghi file tạm rồi phát bằng expo-audio.
  try {
    const path = `${FileSystem.cacheDirectory}tts-${(seq += 1)}.${ext}`;
    await FileSystem.writeAsStringAsync(path, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const player = createAudioPlayer(path);
    let started = false;
    player.addListener('playbackStatusUpdate', (status) => {
      if (!started && onStart && status.playing && (status.duration ?? 0) > 0) {
        started = true;
        onStart((status.duration ?? 0) * 1000);
      }
      if (status.didJustFinish) advance(player);
    });
    // Chốt an toàn: nếu vì lý do gì không nhận được didJustFinish.
    setTimeout(() => advance(player), 30000);
    player.play();
  } catch {
    advance();
  }
}
