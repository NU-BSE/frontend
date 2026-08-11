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
  if (typeStr.includes('Private')) chatType = 'private';
  else if (typeStr.includes('BasicGroup') || typeStr.includes('Supergroup'))
    chatType = 'group';
  else if (typeStr.includes('Channel')) chatType = 'channel';

  return {
    id: String(raw.id ?? ''),
    title:
      typeof raw.title === 'string' && raw.title.length > 0
        ? (raw.title as string)
        : [raw.first_name, raw.last_name].filter(Boolean).join(' ') ||
          `Chat ${String(raw.id ?? '')}`,
    username:
      typeof raw.usernames === 'object' && raw.usernames != null
        ? String(
            (raw.usernames as Record<string, unknown>).active_usernames ?? '',
          ) || undefined
        : typeof raw.username === 'string'
          ? (raw.username as string)
          : undefined,
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
  const contentType = String(content?.['@type'] ?? content?.['_'] ?? '');

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
      text =
        typeof content?.caption === 'object' && content.caption != null
          ? String(
              (content.caption as Record<string, unknown>).text ??
                content.caption ??
                '',
            )
          : '[Photo]';
      break;

    case 'messageVideo':
      text = '[Video]';
      break;

    case 'messageVoiceNote':
      text = '[Voice message]';
      break;

    case 'messageSticker':
      text =
        typeof content?.sticker === 'object' && content.sticker != null
          ? `[Sticker: ${String((content.sticker as Record<string, unknown>).emoji ?? '')}]`
          : '[Sticker]';
      break;

    case 'messageAnimation':
      text = '[GIF]';
      break;

    case 'messageDocument':
      text = '[Document]';
      break;

    case 'messageAudio':
      text = '[Audio]';
      break;

    case 'messageLocation':
      text = '[Location]';
      break;

    case 'messageContact':
      text = '[Contact]';
      break;

    default:
      text = '[Unsupported message type]';
  }

  const sender =
    raw.sender_id && typeof raw.sender_id === 'object'
      ? (raw.sender_id as Record<string, unknown>)
      : null;

  return {
    id: String(raw.id ?? ''),
    chatId: String(raw.chat_id ?? ''),
    senderName:
      typeof sender?.first_name === 'string'
        ? [
            sender.first_name as string,
            typeof sender.last_name === 'string'
              ? (sender.last_name as string)
              : '',
          ]
            .filter(Boolean)
            .join(' ') || undefined
        : undefined,
    text: text || '',
    timestamp: new Date(
      Number(raw.date ?? 0) * 1000,
    ).toISOString(),
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
    sentAt: typeof raw.date === 'number'
      ? new Date(raw.date * 1000).toISOString()
      : new Date().toISOString(),
  };
}
