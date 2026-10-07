/**
 * webAudioCapture — thu âm bằng Web Audio API cho nền WEB/DESKTOP (Expo Web,
 * Electron). Cho ra WAV 16kHz mono base64 — đúng định dạng backend/Whisper cần.
 *
 * Khác native (expo-audio LINEARPCM chỉ chuẩn trên iOS), trên web ta có sẵn mẫu
 * PCM trong RAM (ScriptProcessor) nên dựng được cửa sổ audio TÍCH LUỸ bất cứ lúc
 * nào MÀ KHÔNG cần dừng thu → không có khoảng hở giữa các đoạn.
 *
 * Port từ bản test chuẩn (backend/static/index.html).
 */
import { fromByteArray } from 'base64-js';

const TARGET_RATE = 16000;

// VAD năng lượng (port từ backend/static/index.html). Chỉnh SPEECH_RMS nếu mic to/nhỏ.
const SPEECH_RMS = 0.012; // ngưỡng coi là đang nói
const SILENCE_MS = 1000; // ngừng bao lâu thì chốt cụm — đặt ở mức ngắt HẾT CÂU
// (không phải ngắt hơi ~650ms) để mỗi cụm ≈ một câu, tránh Whisper chấm câu giữa
// chừng làm cắt câu làm đôi + khựng giữa clip.
const MIN_SEG_MS = 500; // cụm tối thiểu (bỏ tiếng động ngắn)
const MAX_SEG_MS = 6000; // cụm dài liền mạch → cắt cưỡng bức

// Giữ ~0.35s âm thanh TRƯỚC lúc vượt ngưỡng: âm đầu câu (vd "Tôi…") nhỏ hơn
// SPEECH_RMS nên trước đây bị cắt mất. 4 frame × 4096 mẫu @48kHz ≈ 340ms.
const PREROLL_FRAMES = 4;

export class WebMicRecorder {
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private preroll: Float32Array[] = [];
  private inRate = 48000;
  private onSegment?: () => void;
  /** Đang giữ nút nói: chỉ khi đó mới gom âm thành cụm. */
  private armed = false;
  private speaking = false;
  private silenceMs = 0;
  private segMs = 0;

  /**
   * Mở micro + đồ thị audio TRƯỚC khi người dùng bấm nói (xin quyền, dựng
   * AudioContext tốn hàng trăm ms → trước đây làm mất đầu câu đầu tiên).
   */
  async open(): Promise<void> {
    if (this.audioCtx) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const Ctor: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctor();
    this.stream = stream;
    this.audioCtx = ctx;
    this.inRate = ctx.sampleRate;
    this.sourceNode = ctx.createMediaStreamSource(stream);
    this.processor = ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) =>
      this.onFrame(new Float32Array(e.inputBuffer.getChannelData(0)));
    this.sourceNode.connect(this.processor);
    this.processor.connect(ctx.destination);
  }

  private onFrame(frame: Float32Array): void {
    const frameMs = (frame.length / this.inRate) * 1000;
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    if (this.armed && rms > SPEECH_RMS) {
      if (!this.speaking) {
        // Bắt đầu nói: đưa phần đệm trước ngưỡng vào cụm để không mất âm đầu.
        for (const f of this.preroll) {
          this.chunks.push(f);
          this.segMs += (f.length / this.inRate) * 1000;
        }
        this.preroll = [];
      }
      this.speaking = true;
      this.silenceMs = 0;
    } else if (this.speaking) {
      this.silenceMs += frameMs;
    }
    // Chỉ gom frame khi đang nói → cụm là speech-only (bỏ im lặng thừa).
    if (this.armed && this.speaking) {
      this.chunks.push(frame);
      this.segMs += frameMs;
    } else {
      this.preroll.push(frame);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
    }
    // Biên cụm: ngắt hơi đủ lâu (cụm ≥ min) hoặc cụm quá dài → chốt.
    if (
      (this.speaking && this.silenceMs >= SILENCE_MS && this.segMs >= MIN_SEG_MS) ||
      this.segMs >= MAX_SEG_MS
    ) {
      this.speaking = false;
      this.silenceMs = 0;
      this.segMs = 0;
      this.onSegment?.();
    }
  }

  /** Bắt đầu gom cụm (bấm nói). Tự mở micro nếu chưa `open()`. */
  async start(onSegment?: () => void): Promise<void> {
    await this.open();
    // AudioContext tạo ngoài thao tác người dùng bị trình duyệt tạm dừng →
    // resume trong lúc bấm nói (đây là user gesture).
    await this.audioCtx?.resume();
    this.reset();
    this.onSegment = onSegment;
    this.armed = true;
  }

  /** Xoá mẫu đã tích luỹ nhưng VẪN thu tiếp (bắt đầu một segment mới). */
  reset(): void {
    this.chunks = [];
    this.speaking = false;
    this.silenceMs = 0;
    this.segMs = 0;
  }

  /** WAV base64 của TOÀN BỘ audio tích luỹ tới hiện tại (không dừng thu). */
  windowWav(): string | null {
    if (this.chunks.length === 0) return null;
    const merged = mergeChunks(this.chunks);
    const down = downsample(merged, this.inRate, TARGET_RATE);
    return fromByteArray(new Uint8Array(encodeWav(down, TARGET_RATE)));
  }

  /** Thả nút nói: trả WAV chốt (hoặc null), micro VẪN mở cho lượt sau. */
  async stop(): Promise<string | null> {
    const result = this.windowWav();
    this.armed = false;
    this.onSegment = undefined;
    this.reset();
    return result;
  }

  /** Giải phóng micro (rời màn họp). */
  async close(): Promise<void> {
    this.armed = false;
    try {
      this.processor?.disconnect();
      this.sourceNode?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      await this.audioCtx?.close();
    } catch {
      /* noop */
    }
    this.processor = this.sourceNode = this.audioCtx = this.stream = null;
    this.chunks = [];
    this.preroll = [];
  }
}

function mergeChunks(list: Float32Array[]): Float32Array {
  const len = list.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(len);
  let off = 0;
  for (const c of list) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function downsample(buf: Float32Array, inR: number, outR: number): Float32Array {
  if (outR >= inR) return buf;
  const ratio = inR / outR;
  const newLen = Math.round(buf.length / ratio);
  const res = new Float32Array(newLen);
  let iRes = 0;
  let iBuf = 0;
  while (iRes < newLen) {
    const next = Math.round((iRes + 1) * ratio);
    let acc = 0;
    let cnt = 0;
    for (let i = iBuf; i < next && i < buf.length; i++) {
      acc += buf[i];
      cnt++;
    }
    res[iRes++] = cnt ? acc / cnt : 0;
    iBuf = next;
  }
  return res;
}

function encodeWav(f32: Float32Array, rate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + f32.length * 2);
  const v = new DataView(buf);
  const ws = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  ws(0, 'RIFF');
  v.setUint32(4, 36 + f32.length * 2, true);
  ws(8, 'WAVE');
  ws(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ws(36, 'data');
  v.setUint32(40, f32.length * 2, true);
  let o = 44;
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return buf;
}
