export interface TelegramFileMeta {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface TelegramPhotoSize extends TelegramFileMeta {
  width: number;
  height: number;
}

export interface TelegramAudio extends TelegramFileMeta {
  duration: number;
  file_name?: string;
  mime_type?: string;
}

export interface TelegramDocument extends TelegramFileMeta {
  file_name?: string;
  mime_type?: string;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string; title?: string; username?: string };
  from?: { id?: number; is_bot?: boolean; username?: string };
  text?: string;
  caption?: string;
  reply_to_message?: {
    message_id?: number;
    from?: { is_bot?: boolean };
    text?: string;
    caption?: string;
  };
  voice?: TelegramFileMeta & { duration: number; mime_type?: string };
  audio?: TelegramAudio;
  document?: TelegramDocument;
  photo?: TelegramPhotoSize[];
  forward_from?: {
    id: number;
    is_bot?: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  forward_from_chat?: {
    id: number;
    type: string;
    title?: string;
    username?: string;
  };
  forward_date?: number;
  forward_origin?: {
    type: string;
    sender_user?: { id: number; first_name: string; last_name?: string; username?: string };
    sender_user_name?: string;
    sender_chat?: { id: number; title: string; type: string; username?: string };
    chat?: { id: number; title: string; type: string; username?: string };
    date?: number;
  };
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number; is_bot?: boolean; username?: string };
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}
