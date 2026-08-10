/**
 * Human-friendly activity labels for tool steps shown in the chat timeline.
 * Lets the UI say "Searching Telegram chats…" instead of a raw tool name.
 */
const ACTIVITY_LABELS: Record<string, string> = {
  'system.health': 'Checking agent health',
  'calendar.list_events': 'Reading calendar',
  'calendar.create_event': 'Creating calendar event',
  'telegram.user.search_chats': 'Searching Telegram chats',
  'telegram.user.get_recent_messages': 'Reading Telegram messages',
  'telegram.user.send_message': 'Sending Telegram message',
  'telegram.bot.get_me': 'Checking Telegram bot',
  'telegram.bot.send_message': 'Sending Telegram bot message',
  'telegram.bot.edit_message': 'Editing Telegram bot message',
  'telegram.bot.delete_message': 'Deleting Telegram bot message',
  'telegram.bot.send_document': 'Sending Telegram document',
  'android.contacts.search': 'Searching device contacts',
  'android.calendar.list_events': 'Reading device calendar',
  'android.clipboard.read': 'Reading clipboard',
  'android.clipboard.write': 'Writing to clipboard',
  'android.notifications.list': 'Reading notifications',
  'android.apps.list': 'Listing apps',
  'google.calendar.list_events': 'Reading Google Calendar',
  'google.gmail.search': 'Searching Gmail',
  'google.people.search': 'Searching Google contacts',
};

export function toolActivityLabel(toolName: string): string {
  return ACTIVITY_LABELS[toolName] ?? toolName;
}
