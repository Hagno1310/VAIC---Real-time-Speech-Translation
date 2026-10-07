/**
 * Kiểu dữ liệu cho tính năng phiên dịch real-time.
 *
 * Bám sát "Hợp đồng Message WebSocket" (SRS Mục 7) và handler backend:
 * mọi message đều là envelope `{ type, data }` theo cả hai chiều.
 */

/** Ngôn ngữ hỗ trợ. */
export type Lang = 'vi' | 'en';

/** Chế độ pipeline của backend. */
export type TranslatorMode = 'mock' | 'cloud' | 'offline';

/**
 * Phía nói (quy về màn hình split-screen):
 * - `vn` = đoàn Việt Nam (nói tiếng Việt, dịch sang Anh).
 * - `sg` = đối tác Singapore (nói tiếng Anh, dịch sang Việt).
 */
export type Speaker = 'vn' | 'sg';

/** Trạng thái kết nối WebSocket. */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Số liệu độ trễ cho Latency HUD. */
export interface TurnMetrics {
  sttMs: number;
  nmtMs: number;
  e2eMs: number;
}

/** Một lượt dịch đã hoàn tất (hiển thị trên panel của phía nói). */
export interface TranslatorTurn {
  id: string;
  speaker: Speaker;
  /** Câu gốc (ngôn ngữ của phía nói). */
  srcText: string;
  /** Bản dịch sang ngôn ngữ phía còn lại. */
  dstText: string;
  /** true = lời CHÍNH MÌNH nói (từ stt.final); false/undefined = lời đối tác gửi tới. */
  mine?: boolean;
}

/** Phụ đề tạm thời khi đang nhận dạng. */
export interface PartialLine {
  speaker: Speaker;
  text: string;
}

/** Một thiết bị khác trong lobby (cùng backend LAN). */
export interface Device {
  clientId: string;
  name: string;
  lang: Lang;
  /** Đang trong một phòng khác → không mời được. */
  busy: boolean;
}

/** Đối tác trong phòng 1↔1 hiện tại. */
export interface RoomPeer {
  clientId: string;
  name: string;
  lang: Lang;
}

/** Lời mời đến từ một thiết bị khác. */
export interface IncomingInvite {
  fromClientId: string;
  fromName: string;
  fromLang: Lang;
}

// --------------------------------------------------------------------------
// Client -> Server
// --------------------------------------------------------------------------
export interface SessionStartMessage {
  type: 'session.start';
  data: { mode: TranslatorMode; sourceLang: Lang; targetLang: Lang };
}

export interface AudioChunkMessage {
  type: 'audio.chunk';
  /** `audio` là WAV 16kHz mono base64. `final` = true khi thả nút (kết thúc lượt)
   *  → backend flush nốt câu dở cuối. commitSegment KHÔNG gửi final. */
  data: { speaker: Speaker; audio: string; final?: boolean };
}

export interface TextFinalMessage {
  type: 'text.final';
  /** STT phía client (cloud): đoạn văn bản đã chốt cần dịch. */
  data: { speaker: Speaker; text: string };
}

export interface ConfigUpdateMessage {
  type: 'config.update';
  data: { mode?: TranslatorMode; ttsOn?: boolean; glossaryId?: string };
}

export interface SessionEndMessage {
  type: 'session.end';
  data: Record<string, never>;
}

// -- Lobby / ghép phòng 1↔1 -------------------------------------------------
export interface HelloMessage {
  type: 'hello';
  /** Vào lobby với tên hiển thị + ngôn ngữ của mình. */
  data: { name: string; lang: Lang };
}

export interface InviteMessage {
  type: 'invite';
  data: { toClientId: string };
}

export interface InviteAcceptMessage {
  type: 'invite.accept';
  data: { fromClientId: string };
}

export interface InviteDeclineMessage {
  type: 'invite.decline';
  data: { fromClientId: string };
}

export interface RoomLeaveMessage {
  type: 'room.leave';
  data: Record<string, never>;
}

export type ClientMessage =
  | SessionStartMessage
  | AudioChunkMessage
  | TextFinalMessage
  | ConfigUpdateMessage
  | SessionEndMessage
  | HelloMessage
  | InviteMessage
  | InviteAcceptMessage
  | InviteDeclineMessage
  | RoomLeaveMessage;

// --------------------------------------------------------------------------
// Server -> Client
// --------------------------------------------------------------------------
export interface SessionStartedEvent {
  type: 'session.started';
  data: {
    mode: TranslatorMode;
    sourceLang: Lang;
    targetLang: Lang;
    ttsOn: boolean;
    glossaryId: string | null;
  };
}

export interface SttPartialEvent {
  type: 'stt.partial';
  data: { speaker: Speaker; text: string };
}

export interface SttFinalEvent {
  type: 'stt.final';
  data: { speaker: Speaker; text: string; lang: Lang };
}

export interface NmtResultEvent {
  type: 'nmt.result';
  data: { speaker: Speaker; srcText: string; dstText: string };
}

/** Bản dịch của CHÍNH MÌNH gửi về lại người nói (để bong bóng mình có cả gốc + dịch). */
export interface NmtSelfEvent {
  type: 'nmt.self';
  data: { speaker: Speaker; srcText: string; dstText: string };
}

export interface TtsAudioEvent {
  type: 'tts.audio';
  data: { speaker: Speaker; audio: string };
}

export interface MetricsEvent {
  type: 'metrics';
  data: TurnMetrics;
}

export interface ConfigUpdatedEvent {
  type: 'config.updated';
  data: { mode: TranslatorMode; ttsOn: boolean; glossaryId: string | null };
}

export interface SessionEndedEvent {
  type: 'session.ended';
  data: Record<string, never>;
}

export interface ErrorEvent {
  type: 'error';
  data: { code: string; message: string; canFallback: boolean };
}

// -- Lobby / ghép phòng 1↔1 -------------------------------------------------
export interface WelcomeEvent {
  type: 'welcome';
  /** `serverReady` = backend đã nạp xong model/VAD (thiếu ở backend cũ → coi như sẵn sàng). */
  data: { clientId: string; serverReady?: boolean };
}

/** Backend vừa warmup xong (gửi cho mọi client đang kết nối). */
export interface ServerReadyEvent {
  type: 'server.ready';
  data: Record<string, never>;
}

export interface LobbyEvent {
  type: 'lobby';
  data: { devices: Device[] };
}

export interface InviteIncomingEvent {
  type: 'invite.incoming';
  data: { fromClientId: string; fromName: string; fromLang: Lang };
}

export interface InviteDeclinedEvent {
  type: 'invite.declined';
  data: { fromClientId: string; reason: string };
}

export interface RoomJoinedEvent {
  type: 'room.joined';
  data: { roomId: string; peer: RoomPeer };
}

export interface RoomClosedEvent {
  type: 'room.closed';
  data: { reason: string };
}

export type ServerEvent =
  | SessionStartedEvent
  | SttPartialEvent
  | SttFinalEvent
  | NmtResultEvent
  | NmtSelfEvent
  | TtsAudioEvent
  | MetricsEvent
  | ConfigUpdatedEvent
  | SessionEndedEvent
  | ErrorEvent
  | WelcomeEvent
  | ServerReadyEvent
  | LobbyEvent
  | InviteIncomingEvent
  | InviteDeclinedEvent
  | RoomJoinedEvent
  | RoomClosedEvent;
