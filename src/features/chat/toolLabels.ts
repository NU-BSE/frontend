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
  'android.settings.get_capabilities': 'Reading device capabilities',
  'android.settings.get_brightness': 'Reading screen brightness',
  'android.settings.set_brightness': 'Changing screen brightness',
  'android.settings.get_screen_timeout': 'Reading screen timeout',
  'android.settings.set_screen_timeout': 'Changing screen timeout',
  'android.settings.get_auto_rotate': 'Reading auto-rotate',
  'android.settings.set_auto_rotate': 'Changing auto-rotate',
  'android.settings.open': 'Opening Android settings',
  'android.settings.open_panel': 'Opening Android settings panel',
  'google.calendar.list_events': 'Reading Google Calendar',
  'google.gmail.search': 'Searching Gmail',
  'google.gmail.get_message': 'Reading a Gmail message',
  'google.gmail.get_thread': 'Reading a Gmail thread',
  'google.gmail.list_drafts': 'Listing Gmail drafts',
  'google.gmail.create_draft': 'Creating a Gmail draft',
  'google.gmail.update_draft': 'Updating a Gmail draft',
  'google.gmail.send_draft': 'Sending a Gmail draft',
  'google.gmail.archive': 'Archiving a Gmail message',
  'google.gmail.mark_read': 'Marking a Gmail message read',
  'google.gmail.get_attachment': 'Downloading a Gmail attachment',
  'google.people.search': 'Searching Google contacts',
};

export function toolActivityLabel(toolName: string): string {
  return ACTIVITY_LABELS[toolName] ?? toolName;
}
