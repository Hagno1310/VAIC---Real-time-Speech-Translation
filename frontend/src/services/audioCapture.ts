/**
 * audioCapture — tiện ích thu âm & đóng gói WAV 16kHz mono cho STT.
 *
 * RN không có Web Audio API để resample, nên cấu hình expo-audio ghi trực tiếp
 * LINEARPCM 16kHz (iOS xuất WAV thật). Vòng lặp thu nằm ở tầng mic controller.
 */
import { fromByteArray, toByteArray } from 'base64-js';
import {
  AudioQuality,
  IOSOutputFormat,
  RecordingPresets,
  type RecordingOptions,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';

export const SAMPLE_RATE = 16000;

/** Preset ghi âm WAV 16kHz mono cho STT (Whisper). */
export const WAV_16K: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: '.wav',
  sampleRate: SAMPLE_RATE,
  numberOfChannels: 1,
  bitRate: 256000,
  ios: {
    ...RecordingPresets.HIGH_QUALITY.ios,
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
};

/** Đọc file âm thanh đã ghi (theo uri) → base64. */
export async function readFileBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

export function base64ToBytes(b64: string): Uint8Array {
  return toByteArray(b64);
}
export function bytesToBase64(bytes: Uint8Array): string {
  return fromByteArray(bytes);
}

/** Lấy phần dữ liệu PCM (bỏ header) từ một WAV — dò đúng chunk `data`. */
export function wavToPcm(bytes: Uint8Array): Uint8Array {
  for (let i = 12; i + 8 <= bytes.length; ) {
    const id = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
    const size = bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24);
    if (id === 'data') {
      const start = i + 8;
      const end = size > 0 ? Math.min(bytes.length, start + (size >>> 0)) : bytes.length;
      return bytes.subarray(start, end);
    }
    i += 8 + size + (size & 1);
  }
  return bytes.subarray(44);
}

/** Nối các mảng PCM thành một. */
export function concatPcm(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Gói PCM 16-bit mono thành một file WAV hợp lệ. */
export function pcmToWav(pcm: Uint8Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const dv = new DataView(out.buffer);
  const ws = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  ws(0, 'RIFF');
  dv.setUint32(4, 36 + pcm.length, true);
  ws(8, 'WAVE');
  ws(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  ws(36, 'data');
  dv.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}
