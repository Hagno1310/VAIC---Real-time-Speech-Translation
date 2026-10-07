/**
 * useMeetingMic — thu âm push-to-talk cắt CỤM (VAD), ĐA NỀN TẢNG.
 *
 *   - Web/Desktop (Expo Web, Electron): Web Audio API + VAD năng lượng
 *     (WebMicRecorder) → cắt cụm ở chỗ ngắt hơi, mỗi cụm gửi `audio.chunk`.
 *   - iOS/Android: expo-audio; cắt cưỡng bức theo giờ (~NATIVE_SEG_MS) qua stop/
 *     read/restart rồi gộp PCM.
 *
 * Mỗi cụm là một `audio.chunk` (backend STT+NMT+TTS → audio phát cuốn chiếu trên
 * máy người nghe). Không có dịch dự đoán: nghe gì ghi nấy.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { AudioModule, setAudioModeAsync, useAudioRecorder } from 'expo-audio';

import {
  WAV_16K,
  base64ToBytes,
  bytesToBase64,
  concatPcm,
  pcmToWav,
  readFileBase64,
  wavToPcm,
} from '@/services/audioCapture';
import { WebMicRecorder } from '@/services/webAudioCapture';
import { useStore } from '@/store';
import type { Speaker } from '@/types/translator';

const NATIVE_SEG_MS = 4000;
const IS_WEB = Platform.OS === 'web';

export interface MeetingMic {
  recording: boolean;
  error: string | null;
  start: (speaker: Speaker) => Promise<void>;
  /** Chốt cụm hiện tại (audio.chunk → một lượt) rồi thu tiếp cụm mới. */
  cut: () => Promise<void>;
  stop: () => Promise<void>;
}

export function useMeetingMic(): MeetingMic {
  const recorder = useAudioRecorder(WAV_16K); // dùng cho native
  const startTurn = useStore((s) => s.startTurn);
  const commitSegment = useStore((s) => s.commitSegment);
  const endTurn = useStore((s) => s.endTurn);

  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const liveRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakerRef = useRef<Speaker>('vn');
  // Gọi cut() bản mới nhất từ VAD callback / timer mà không đăng ký lại.
  const cutRef = useRef<() => Promise<void>>(async () => {});

  // Web recorder (Web Audio API + VAD).
  const webRef = useRef<WebMicRecorder | null>(null);
  // Native: PCM tích luỹ + xâu chuỗi thao tác recorder.
  const pcmChunksRef = useRef<Uint8Array[]>([]);
  const opChainRef = useRef<Promise<void>>(Promise.resolve());

  const runExclusive = useCallback((fn: () => Promise<void>): Promise<void> => {
    opChainRef.current = opChainRef.current.then(fn, fn);
    return opChainRef.current;
  }, []);

  // --- Native: cắt đoạn, đọc PCM, cộng dồn, thu tiếp ------------------------
  const flushNative = useCallback(
    (restart: boolean) =>
      runExclusive(async () => {
        try {
          await recorder.stop();
        } catch {
          return;
        }
        const uri = recorder.uri;
        if (uri) {
          try {
            const b64 = await readFileBase64(uri);
            const pcm = wavToPcm(base64ToBytes(b64));
            if (pcm.length > 0) pcmChunksRef.current.push(pcm);
          } catch {
            /* bỏ qua lỗi đọc một đoạn */
          }
        }
        if (restart && liveRef.current) {
          try {
            await recorder.prepareToRecordAsync();
            recorder.record();
          } catch (err: any) {
            setError('Ghi âm đoạn tiếp theo thất bại: ' + (err?.message ?? String(err)));
          }
        }
      }),
    [recorder, runExclusive],
  );

  const cut = useCallback(async (): Promise<void> => {
    if (!liveRef.current) return;
    let wav: string | null = null;
    if (IS_WEB) {
      wav = webRef.current?.windowWav() ?? null;
      webRef.current?.reset();
    } else {
      await flushNative(true); // đọc đoạn cuối + thu tiếp cụm mới
      if (pcmChunksRef.current.length > 0) {
        wav = bytesToBase64(pcmToWav(concatPcm(pcmChunksRef.current)));
      }
      pcmChunksRef.current = [];
    }
    if (wav) commitSegment(speakerRef.current, wav);
  }, [flushNative, commitSegment]);
  cutRef.current = cut;

  const start = useCallback(
    async (speaker: Speaker): Promise<void> => {
      setError(null);
      try {
        if (IS_WEB) {
          webRef.current = new WebMicRecorder();
          // VAD phát hiện biên cụm → chốt cụm (audio.chunk).
          await webRef.current.start(() => void cutRef.current());
        } else {
          const perm = await AudioModule.requestRecordingPermissionsAsync();
          if (!perm.granted) {
            setError('Không có quyền micro. Kiểm tra cài đặt quyền của app.');
            return;
          }
          await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
          pcmChunksRef.current = [];
          await recorder.prepareToRecordAsync();
          recorder.record();
        }
        speakerRef.current = speaker;
        startTurn(speaker);
        liveRef.current = true;
        setRecording(true);
        // Native không có VAD → cắt cưỡng bức theo giờ.
        if (!IS_WEB) {
          timerRef.current = setInterval(() => void cutRef.current(), NATIVE_SEG_MS);
        }
      } catch (err: any) {
        liveRef.current = false;
        setError('Không truy cập được micro: ' + (err?.message ?? String(err)));
      }
    },
    [recorder, startTurn],
  );

  const stop = useCallback(async (): Promise<void> => {
    if (!liveRef.current) return;
    liveRef.current = false;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);

    let finalWav: string | null = null;
    if (IS_WEB) {
      finalWav = (await webRef.current?.stop()) ?? null;
      webRef.current = null;
    } else {
      await flushNative(false);
      if (pcmChunksRef.current.length > 0) {
        finalWav = bytesToBase64(pcmToWav(concatPcm(pcmChunksRef.current)));
      }
    }
    if (finalWav) endTurn(speakerRef.current, finalWav);
  }, [flushNative, endTurn]);

  // Dọn khi rời màn hình.
  useEffect(
    () => () => {
      liveRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      if (IS_WEB) void webRef.current?.stop();
      else recorder.stop().catch(() => undefined);
    },
    [recorder],
  );

  return { recording, error, start, cut, stop };
}
