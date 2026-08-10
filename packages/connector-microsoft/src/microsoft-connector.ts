import * as z from 'zod/v4';
import type { ConnectionRecord, ConnectorTool } from '@mobile-agent/connector-core';
import { StoreBackedConnector, connId, dt, opt, str, t } from '@mobile-agent/connector-core';

const mailRead = [
  t('microsoft.mail.search', 'Search mail', 'Search Outlook messages', 'read',
    z.object({ connectionId: str, query: str, maxResults: z.number().int().min(1).max(50).default(10) }),
    { messages: [{ id: 'm1', subject: 'Hello', from: 'sender@outlook.com' }] }),
  t('microsoft.mail.get', 'Get message', 'Get a single mail message', 'read',
    z.object({ connectionId: str, messageId: str }),
    { id: 'm1', subject: 'Hello', body: { contentType: 'text', content: 'Hello from mock' } }),
];

const mailWrite = [
  t('microsoft.mail.create_draft', 'Create draft', 'Create an email draft', 'write',
    z.object({ connectionId: str, to: str, subject: str, body: str }),
    { id: 'd1', status: 'draft' }),
];

const mailExt = [
  t('microsoft.mail.send_draft', 'Send draft', 'Send an existing draft', 'external_side_effect',
    z.object({ connectionId: str, draftId: str }),
    { id: 'd1', status: 'sent' }),
];

const calRead = [
  t('microsoft.calendar.list_events', 'List events', 'List calendar events in a range', 'read',
    z.object({ connectionId: str, start: dt, end: dt }),
    { events: [{ id: 'ev1', subject: 'Standup', start: { dateTime: '2026-08-07T10:00:00+05:00' }, end: { dateTime: '2026-08-07T11:00:00+05:00' } }] }),
];

const calWrite = [
  t('microsoft.calendar.create_event', 'Create event', 'Create a calendar event', 'write',
    z.object({ connectionId: str, title: str, start: dt, end: dt, location: opt, attendees: z.array(z.object({ email: str })).optional() }),
    { id: 'ev2', status: 'created' }),
  t('microsoft.calendar.update_event', 'Update event', 'Update an existing event', 'write',
    z.object({ connectionId: str, eventId: str, title: opt, start: opt, end: opt, location: opt }),
    { id: 'ev1', status: 'updated' }),
  t('microsoft.calendar.delete_event', 'Delete event', 'Delete a calendar event', 'destructive',
    z.object({ connectionId: str, eventId: str }),
    { deleted: true }),
];

const contactsRead = [
  t('microsoft.contacts.search', 'Search contacts', 'Search Outlook contacts', 'read',
    z.object({ connectionId: str, query: str }),
    { contacts: [{ id: 'c1', displayName: 'John Doe', emailAddresses: [{ address: 'john@example.com' }] }] }),
];

const contactsWrite = [
  t('microsoft.contacts.create', 'Create contact', 'Create a new contact', 'write',
    z.object({ connectionId: str, givenName: str, surname: opt, email: opt, phone: opt }),
    { id: 'c2', displayName: 'New Contact' }),
  t('microsoft.contacts.update', 'Update contact', 'Update an existing contact', 'write',
    z.object({ connectionId: str, contactId: str, givenName: opt, surname: opt, email: opt, phone: opt }),
    { id: 'c1', status: 'updated' }),
];

const driveRead = [
  t('microsoft.drive.search', 'Search Drive', 'Search files in OneDrive', 'read',
    z.object({ connectionId: str, query: str, maxResults: z.number().int().min(1).max(100).default(20) }),
    { files: [{ id: 'f1', name: 'report.docx', size: 204800 }] }),
  t('microsoft.drive.download', 'Download', 'Download a file from OneDrive', 'read',
    z.object({ connectionId: str, fileId: str }),
    { fileId: 'f1', localUri: 'file://mock/report.docx', name: 'report.docx' }),
];

const driveWrite = [
  t('microsoft.drive.upload', 'Upload', 'Upload a file to OneDrive', 'write',
    z.object({ connectionId: str, name: str, parentFolderId: opt }),
    { id: 'f2', name: 'uploaded.txt' }),
];

const driveExt = [
  t('microsoft.drive.share', 'Share', 'Share a file or folder', 'external_side_effect',
    z.object({ connectionId: str, fileId: str, email: str, role: str.default('read') }),
    { shared: true, link: 'https://onedrive.live.com/mock' }),
];

const todoRead = [
  t('microsoft.todo.list', 'List tasks', 'List tasks from Microsoft To Do', 'read',
    z.object({ connectionId: str, listId: opt }),
    { tasks: [{ id: 't1', title: 'Review PR', status: 'notStarted' }] }),
];

const todoWrite = [
  t('microsoft.todo.create', 'Create task', 'Create a new task', 'write',
    z.object({ connectionId: str, title: str, listId: opt, due: opt }),
    { id: 't2', title: 'New task', status: 'notStarted' }),
  t('microsoft.todo.update', 'Update task', 'Update an existing task', 'write',
    z.object({ connectionId: str, taskId: str, title: opt, due: opt }),
    { id: 't1', status: 'updated' }),
  t('microsoft.todo.complete', 'Complete task', 'Mark a task as completed', 'write',
    z.object({ connectionId: str, taskId: str }),
    { id: 't1', status: 'completed' }),
];

export class MicrosoftConnector extends StoreBackedConnector {
  readonly id = 'microsoft' as const;
  readonly displayName = 'Microsoft';
  readonly implementationStatus = 'mock' as const;
  async getTools(_c: ConnectionRecord) {
    return [...mailRead, ...mailWrite, ...mailExt, ...calRead, ...calWrite, ...contactsRead, ...contactsWrite, ...driveRead, ...driveWrite, ...driveExt, ...todoRead, ...todoWrite];
  }
}
