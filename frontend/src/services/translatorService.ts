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
  onError: () => void;
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
    const ws = new WebSocket(url);
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
