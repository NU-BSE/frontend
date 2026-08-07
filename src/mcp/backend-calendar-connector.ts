/**
 * Calendar connector that proxies to the Creepy.IM backend API
 * instead of using mock data.
 *
 * Implements the CalendarConnector interface from @mobile-agent/connector-core.
 * OAuth tokens live on the backend — this connector only passes the
 * connectionId and relies on the backend's stored credentials.
 */
import type {
  CalendarConnector,
  CalendarEvent,
  CreateCalendarEventInput,
  ListCalendarEventsInput,
} from '@mobile-agent/connector-core';

import {
  listCalendarEvents as apiListEvents,
  createCalendarEvent as apiCreateEvent,
} from '@/api/client';

export class BackendCalendarConnector implements CalendarConnector {
  async listEvents(input: ListCalendarEventsInput): Promise<CalendarEvent[]> {
    const result = await apiListEvents({
      connectionId: input.connectionId,
      start: input.start,
      end: input.end,
      maxResults: input.maxResults,
    });

    return result.events.map((e) => ({
      id: e.id,
      connectionId: e.connectionId,
      title: e.title,
      start: e.start,
      end: e.end,
      description: e.description ?? undefined,
    }));
  }

  async createEvent(input: CreateCalendarEventInput): Promise<CalendarEvent> {
    const result = await apiCreateEvent({
      connectionId: input.connectionId,
      title: input.title,
      start: input.start,
      end: input.end,
      description: input.description,
      approvalId: 'backend-approval', // approval is handled by MCP server before this call
      idempotencyKey: input.idempotencyKey,
    });

    return {
      id: result.event.id,
      connectionId: result.event.connectionId,
      title: result.event.title,
      start: result.event.start,
      end: result.event.end,
      description: result.event.description ?? undefined,
    };
  }
}
