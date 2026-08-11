import type { TdChat, TdMessage, TdSentMessage } from './types';

/**
 * Normalizes a raw TDLib chat object into the public `TdChat` interface.
 * Only a subset of fields ever leaves this layer — the raw object is never
 * passed to MCP or the model.
 */
export function normalizeChat(raw: Record<string, unknown>): TdChat {
  const rawType = raw.type as Record<string, unknown> | undefined;
  const typeStr = String(rawType?.['@type'] ?? rawType ?? '');

  let chatType: TdChat['type'] = 'unknown';
  if (typeStr.includes('Private')) {
    chatType = 'private';
  } else if (typeStr.includes('BasicGroup')) {
    chatType = 'group';
  } else if (typeStr.includes('Supergroup')) {
    // is_channel lives on the Supergroup object, not the Chat root.
    // Without a separate getSupergroup() call we cannot reliably
    // distinguish a channel from a group — fall back to unknown.
    chatType = 'unknown';
  } else if (typeStr.includes('Channel')) {
    chatType = 'channel';
  }

  return {
    id: String(raw.id ?? ''),
    title:
      typeof raw.title === 'string' && raw.title.length > 0
        ? (raw.title as string)
        : [raw.first_name, raw.last_name].filter(Boolean).join(' ') ||
          `Chat ${String(raw.id ?? '')}`,
    username: extractUsername(raw),
    type: chatType,
  };
}

/**
 * Normalizes a raw TDLib message object into a bounded `TdMessage`.
 *
 * Only text content and safe metadata are extracted. Media messages get a
 * placeholder description — raw file metadata, local paths and TDLib
 * internals never leave this layer.
 */
export function normalizeMessage(
  raw: Record<string, unknown>,
): TdMessage {
  const content = raw.content as Record<string, unknown> | undefined;
  const contentType = String(content?.['@type'] ?? content?._ ?? '');

  let text: string;
  switch (contentType) {
    case 'messageText':
      text =
        typeof content?.text === 'object' && content.text != null
          ? String(
              (content.text as Record<string, unknown>).text ??
                content.text ??
                '',
            )
          : String(content?.text ?? '');
      break;

    case 'messagePhoto':
      text = extractCaption(content) || '[Photo]';
      break;

    case 'messageVideo': {
      const cap = extractCaption(content);
      text = cap || '[Video]';
      break;
    }

    case 'messageVoiceNote':
      text = '[Voice message]';
      break;

    case 'messageSticker':
      text =
        typeof content?.sticker === 'object' && content.sticker != null
          ? `[Sticker: ${String((content.sticker as Record<string, unknown>).emoji ?? '')}]`
          : '[Sticker]';
      break;

    case 'messageAnimation': {
      const cap = extractCaption(content);
      text = cap || '[GIF]';
      break;
    }

    case 'messageDocument': {
      const cap = extractCaption(content);
      text = cap || '[Document]';
      break;
    }

    case 'messageAudio': {
      const cap = extractCaption(content);
      text = cap || '[Audio]';
      break;
    }

    case 'messageLocation':
      text = '[Location]';
      break;

    case 'messageContact':
      text = '[Contact]';
      break;

    default:
      text = '[Unsupported message type]';
  }

  // sender_id is a TDLib reference (messageSenderUser/messageSenderChat),
  // not a user object. We do not make additional TDLib requests here,
  // so sender name stays undefined unless we later add sender resolution.
  return {
    id: String(raw.id ?? ''),
    chatId: String(raw.chat_id ?? ''),
    senderName: undefined,
    text: text || '',
    timestamp: normalizeTimestamp(raw.date),
    outgoing: Boolean(raw.is_outgoing),
  };
}

/**
 * Constructs a `TdSentMessage` from the raw `sendMessage` response.
 */
export function normalizeSentMessage(
  chatId: string,
  text: string,
  raw: Record<string, unknown>,
): TdSentMessage {
  return {
    messageId: String(raw.id ?? ''),
    chatId: String(raw.chat_id ?? chatId),
    text,
    sentAt: normalizeTimestamp(raw.date),
  };
}

// ------------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------------

function extractCaption(content: Record<string, unknown> | undefined): string | undefined {
  const caption = content?.caption;
  if (!caption || typeof caption !== 'object') return undefined;
  const captionObj = caption as Record<string, unknown>;
  const text = typeof captionObj.text === 'string' ? captionObj.text : undefined;
  return text && text.length > 0 ? text : undefined;
}

function extractUsername(raw: Record<string, unknown>): string | undefined {
  const usernamesRaw = raw.usernames as Record<string, unknown> | undefined;
  const active = Array.isArray(usernamesRaw?.active_usernames)
    ? (usernamesRaw.active_usernames as string[])
    : [];

  if (typeof active[0] === 'string') return active[0];
  if (typeof raw.username === 'string') return raw.username as string;
  return undefined;
}

/**
 * Converts a TDLib Unix timestamp to an ISO 8601 string.
 * Falls back to the current time when the value is invalid.
 */
function normalizeTimestamp(unixSeconds: unknown): string {
  const ts = Number(unixSeconds);
  if (Number.isFinite(ts) && ts > 0) {
    return new Date(ts * 1000).toISOString();
  }
  return new Date().toISOString();
}
