/**
 * Human-readable rendering of a pending approval. The sheet must show the
 * user exactly what will happen — recipient, message, target — before any
 * external side effect executes.
 */

export interface ApprovalField {
  label: string;
  value: string;
}

export interface ApprovalDescription {
  title: string;
  fields: ApprovalField[];
  confirmLabel: string;
  destructive?: boolean;
}

const MAX_VALUE_CHARS = 500;

function asText(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') {
    return value.length > MAX_VALUE_CHARS
      ? `${value.slice(0, MAX_VALUE_CHARS)}…`
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function genericFields(args: Record<string, unknown>): ApprovalField[] {
  return Object.entries(args)
    .filter(([key]) => key !== 'approvalId' && key !== 'connectionId')
    .slice(0, 8)
    .map(([key, value]) => ({ label: key, value: asText(value) }));
}

const DESCRIBERS: Record<
  string,
  (args: Record<string, unknown>) => ApprovalDescription
> = {
  'telegram.user.send_message': (args) => ({
    title: 'Send Telegram message?',
    confirmLabel: 'Send',
    fields: [
      {
        label: 'To',
        value: asText(args.chatTitle ?? args.chatId),
      },
      { label: 'Message', value: asText(args.text) },
    ],
  }),

  'telegram.bot.send_message': (args) => ({
    title: 'Send message as Telegram bot?',
    confirmLabel: 'Send',
    fields: [
      { label: 'Chat', value: asText(args.chatId) },
      { label: 'Message', value: asText(args.text) },
    ],
  }),

  'telegram.bot.edit_message': (args) => ({
    title: 'Edit Telegram bot message?',
    confirmLabel: 'Edit',
    fields: [
      { label: 'Chat', value: asText(args.chatId) },
      { label: 'Message', value: asText(args.messageId) },
      { label: 'New text', value: asText(args.text) },
    ],
  }),

  'telegram.bot.delete_message': (args) => ({
    title: 'Delete Telegram bot message?',
    confirmLabel: 'Delete',
    destructive: true,
    fields: [
      { label: 'Chat', value: asText(args.chatId) },
      { label: 'Message', value: asText(args.messageId) },
    ],
  }),

  'telegram.bot.send_document': (args) => ({
    title: 'Send document as Telegram bot?',
    confirmLabel: 'Send',
    fields: [
      { label: 'Chat', value: asText(args.chatId) },
      { label: 'Document', value: asText(args.document) },
    ],
  }),

  'android.settings.set_brightness': (args) => ({
    title: 'Change screen brightness?',
    confirmLabel: 'Change',
    fields: [{ label: 'Brightness', value: `${asText(args.percent)}%` }],
  }),

  'android.settings.set_screen_timeout': (args) => ({
    title: 'Change screen timeout?',
    confirmLabel: 'Change',
    fields: [
      { label: 'Timeout', value: `${asText(args.milliseconds)} ms` },
    ],
  }),

  'android.settings.set_auto_rotate': (args) => ({
    title: 'Toggle auto-rotate?',
    confirmLabel: 'Change',
    fields: [
      { label: 'Enabled', value: asText(args.enabled) },
    ],
  }),

  'android.settings.open': (args) => ({
    title: 'Open Android settings?',
    confirmLabel: 'Open',
    fields: [{ label: 'Screen', value: asText(args.screen) }],
  }),

  'android.settings.open_panel': (args) => ({
    title: 'Open Android settings panel?',
    confirmLabel: 'Open',
    fields: [{ label: 'Panel', value: asText(args.panel) }],
  }),

  'calendar.create_event': (args) => ({
    title: 'Create calendar event?',
    confirmLabel: 'Create',
    fields: [
      { label: 'Title', value: asText(args.title) },
      { label: 'Start', value: asText(args.start) },
      { label: 'End', value: asText(args.end) },
      ...(args.description
        ? [{ label: 'Description', value: asText(args.description) }]
        : []),
    ],
  }),
};

export function describeApproval(
  toolName: string,
  args: Record<string, unknown>,
): ApprovalDescription {
  const describer = DESCRIBERS[toolName];
  if (describer) return describer(args);

  // Useful generic fallbacks per namespace.
  if (toolName.includes('delete') || toolName.includes('remove')) {
    return {
      title: `Confirm destructive action: ${toolName}?`,
      confirmLabel: 'Delete',
      destructive: true,
      fields: genericFields(args),
    };
  }
  if (toolName.includes('send') || toolName.includes('share')) {
    return {
      title: `Send via ${toolName.split('.')[0]}?`,
      confirmLabel: 'Send',
      fields: genericFields(args),
    };
  }

  return {
    title: `Allow "${toolName}"?`,
    confirmLabel: 'Allow',
    fields: genericFields(args),
  };
}
