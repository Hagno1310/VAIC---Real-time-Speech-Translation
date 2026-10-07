/**
 * translatorService — lớp bọc WebSocket cho pipeline phiên dịch real-time.
 *
 * Theo kiến trúc phân tầng: service KHÔNG biết gì về UI hay store. Nó chỉ mở
 * kết nối, gửi message đã gõ kiểu, và bắn callback khi có sự kiện từ server.
 * Việc cập nhật state do store (translatorSlice) đảm nhiệm.
 *
 * Dùng WebSocket có sẵn trong React Native (cùng API với trình duyệt).
 */
import type { ClientMessage, ServerEvent } from '@/types/translator';

/** Các callback vòng đời do store cung cấp. */
export interface TranslatorSocketHandlers {
  onOpen: () => void;
  onEvent: (event: ServerEvent) => void;
  onClose: () => void;
  /** `reason` chỉ có khi KHÔNG tạo nổi kết nối (URL sai / bị trình duyệt chặn). */
  onError: (reason?: string) => void;
}

/**
 * Chuẩn hoá URL người dùng gõ (hay gõ thiếu trên điện thoại):
 *   `192.168.1.5:8000` → `ws://192.168.1.5:8000/ws`, `https://x` → `wss://x/ws`.
 * Trang mở qua https (vd devtunnel) bị trình duyệt cấm mở `ws://` → nâng lên `wss://`.
 */
export function normalizeWsUrl(input: string, pageIsHttps: boolean): string {
  let url = input.trim();
  url = url.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
  if (!/^wss?:\/\//i.test(url)) url = `${pageIsHttps ? 'wss' : 'ws'}://${url}`;
  if (pageIsHttps) url = url.replace(/^ws:\/\//i, 'wss://');
  if (!/^wss?:\/\/[^/]+\/./i.test(url)) url = `${url.replace(/\/$/, '')}/ws`;
  return url;
}

function pageIsHttps(): boolean {
  const loc = (globalThis as { location?: { protocol?: string } }).location;
  return loc?.protocol === 'https:';
}

const KNOWN_EVENTS: ReadonlySet<string> = new Set<ServerEvent['type']>([
  'session.started',
  'stt.partial',
  'stt.final',
  'nmt.result',
  'nmt.self',
  'tts.audio',
  'metrics',
  'config.updated',
  'session.ended',
  'error',
  'welcome',
  'server.ready',
  'lobby',
  'invite.incoming',
  'invite.declined',
  'room.joined',
  'room.closed',
]);

/** Thu hẹp payload thô từ WebSocket về ServerEvent (bỏ qua nếu không hợp lệ). */
function parseServerEvent(raw: string): ServerEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== 'string' || !KNOWN_EVENTS.has(type)) return null;
  const data = typeof record.data === 'object' && record.data !== null ? record.data : {};
  return { type, data } as ServerEvent;
}

export class TranslatorSocket {
  private ws: WebSocket | null = null;

  /** Mở kết nối tới `url` và nối các callback. Đóng kết nối cũ trước. */
  connect(url: string, handlers: TranslatorSocketHandlers): void {
    this.close();
    let ws: WebSocket;
    try {
      // Ném lỗi ĐỒNG BỘ khi URL sai hoặc bị chặn — phải bắt, nếu không lỗi sẽ
      // bay ra tận nút bấm (vd "Tiếp tục" đứng im không chuyển màn).
      ws = new WebSocket(normalizeWsUrl(url, pageIsHttps()));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setTimeout(() => handlers.onError(reason), 0);
      return;
    }
    this.ws = ws;

    ws.onopen = () => handlers.onOpen();
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      handlers.onClose();
    };
    ws.onerror = () => handlers.onError();
    ws.onmessage = (ev: WebSocketMessageEvent) => {
      const event = parseServerEvent(ev.data as string);
      if (event) handlers.onEvent(event);
    };
  }

  /** Gửi một message client -> server (chỉ khi kết nối đang mở). */
  send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /** Đóng kết nối (nếu có) và gỡ handler để tránh callback muộn. */
  close(): void {
    if (!this.ws) return;
    this.ws.onopen = null;
    this.ws.onclose = null;
    this.ws.onerror = null;
    this.ws.onmessage = null;
    try {
      this.ws.close();
    } catch {
      /* noop */
    }
    this.ws = null;
  }

  get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
