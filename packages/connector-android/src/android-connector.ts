import * as z from 'zod/v4';
import type {
  ConnectionRecord,
  ConnectorTool,
  ToolImplementationStatus,
} from '@mobile-agent/connector-core';
import { StoreBackedConnector } from '@mobile-agent/connector-core';

/**
 * Android on-device capabilities.
 *
 * Every tool is explicitly marked with its real implementation status —
 * never implicitly. Until the native bridges land, all of them are
 * `development_mock`: the production registry hides them, so the model can
 * never receive a fake "done" from a device API we do not actually call.
 *
 * Native-bridge priority (Phase D+): contacts search, calendar read/write,
 * share intent, open/deep-link intent, notifications, clipboard, file
 * picker. Android permissions get added together with each real bridge.
 */
function tool(
  name: string,
  title: string,
  desc: string,
  risk: ConnectorTool['risk'],
  inputSchema: z.ZodType<any>,
  mock: (input: any) => unknown,
  implementationStatus: ToolImplementationStatus = 'development_mock',
): ConnectorTool {
  return {
    name,
    title,
    description: desc,
    inputSchema,
    risk,
    capabilities: [],
    requiredScopes: [],
    implementationStatus,
    execute: async (input: any) => mock(input),
  };
}

const tools: ConnectorTool[] = [
  tool('android.contacts.search', 'Search contacts', 'Search device contacts by name',
    'read', z.object({ query: z.string().min(1), connectionId: z.string().min(1) }),
    () => [{ id: 'c1', displayName: 'Daniyar', phones: ['+7...'], emails: ['d@example.com'] }]),
  tool('android.calendar.list_events', 'List device calendar', 'List events from the device calendar',
    'read', z.object({ connectionId: z.string().min(1), start: z.string(), end: z.string(), maxResults: z.number().int().min(1).max(100).default(20) }),
    () => [{ id: 'e1', calendarId: 'device', title: 'Team standup', startMs: Date.now(), endMs: Date.now() + 1800_000 }]),
  tool('android.calendar.prepare_event', 'Prepare calendar event', 'Open system calendar UI to create an event',
    'write', z.object({ connectionId: z.string(), title: z.string(), start: z.string(), end: z.string(), location: z.string().optional() }),
    () => ({ status: 'ui_opened' })),
  tool('android.files.pick', 'Pick a file', 'Open system file picker',
    'write', z.object({ connectionId: z.string(), mimeTypes: z.array(z.string()).default(['*/*']) }),
    () => ({ uri: 'content://mock/file.pdf', name: 'report.pdf', mimeType: 'application/pdf' })),
  tool('android.files.create', 'Create a document', 'Open system document creator',
    'write', z.object({ connectionId: z.string(), suggestedName: z.string(), mimeType: z.string() }),
    () => ({ uri: 'content://mock/new.txt' })),
  tool('android.notifications.list', 'List notifications', 'Read active device notifications',
    'read', z.object({ connectionId: z.string() }),
    () => [{ key: 'n1', packageName: 'com.whatsapp', title: 'New message', text: 'Hey!', postedAt: Date.now() }]),
  tool('android.notifications.dismiss', 'Dismiss notification', 'Dismiss a notification by key',
    'write', z.object({ connectionId: z.string(), key: z.string().min(1) }),
    () => ({ dismissed: true })),
  tool('android.location.current', 'Get location', 'Get current device location',
    'read', z.object({ connectionId: z.string() }),
    () => ({ latitude: 43.238, longitude: 76.945, accuracyMeters: 5 })),
  tool('android.clipboard.read', 'Read clipboard', 'Read current clipboard text',
    'read', z.object({ connectionId: z.string() }),
    () => ({ text: 'Mock clipboard content' })),
  tool('android.clipboard.write', 'Write clipboard', 'Set clipboard text',
    'write', z.object({ connectionId: z.string(), text: z.string().min(1).max(10_000) }),
    () => ({ written: true })),
  tool('android.apps.list', 'List apps', 'List installed applications',
    'read', z.object({ connectionId: z.string() }),
    () => [{ packageName: 'com.whatsapp', label: 'WhatsApp' }, { packageName: 'org.telegram.messenger', label: 'Telegram' }]),
  tool('android.apps.open', 'Open app', 'Open an installed application',
    'write', z.object({ connectionId: z.string(), packageName: z.string().min(1) }),
    () => ({ opened: true })),
  tool('android.share.text', 'Share text', 'Open system share sheet with text',
    'external_side_effect', z.object({ connectionId: z.string(), text: z.string().min(1).max(100_000), targetPackage: z.string().optional() }),
    () => ({ shared: true })),
  tool('android.share.file', 'Share file', 'Open system share sheet with a file',
    'external_side_effect', z.object({ connectionId: z.string(), uri: z.string(), mimeType: z.string(), targetPackage: z.string().optional() }),
    () => ({ shared: true })),
  tool('android.media.play', 'Media play', 'Resume media playback',
    'write', z.object({ connectionId: z.string() }),
    () => ({ playing: true })),
  tool('android.media.pause', 'Media pause', 'Pause media playback',
    'write', z.object({ connectionId: z.string() }),
    () => ({ playing: false })),
];

export class AndroidConnector extends StoreBackedConnector {
  readonly id = 'android' as const;
  readonly displayName = 'Android Device';
  readonly implementationStatus = 'mock' as const;

  async getTools(_connection: ConnectionRecord) {
    return tools;
  }
}
