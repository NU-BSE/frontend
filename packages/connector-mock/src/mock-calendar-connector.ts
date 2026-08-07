import type {
  CalendarConnector,
  CalendarEvent,
  CreateCalendarEventInput,
  ListCalendarEventsInput,
} from "@mobile-agent/connector-core";

const MOCK_EVENTS: CalendarEvent[] = [
  {
    id: "event-1",
    connectionId: "mock-personal",
    title: "MCP test meeting",
    start: "2026-08-07T10:00:00+05:00",
    end: "2026-08-07T11:00:00+05:00",
  },
];

export class MockCalendarConnector
  implements CalendarConnector
{
  private readonly createdEvents: CalendarEvent[] = [];

  private readonly idempotencyIndex = new Map<
    string,
    CalendarEvent
  >();

  private eventCounter = 0;

  async listEvents(
    input: ListCalendarEventsInput,
  ): Promise<CalendarEvent[]> {
    const rangeStart = new Date(input.start).getTime();
    const rangeEnd = new Date(input.end).getTime();

    if (
      !Number.isFinite(rangeStart) ||
      !Number.isFinite(rangeEnd)
    ) {
      throw new Error("Invalid date range");
    }

    if (rangeStart >= rangeEnd) {
      throw new Error(
        "start must be earlier than end",
      );
    }

    const allEvents = [
      ...MOCK_EVENTS,
      ...this.createdEvents,
    ];

    return allEvents
      .filter((event) => {
        if (
          event.connectionId !==
          input.connectionId
        ) {
          return false;
        }

        const eventStart =
          new Date(event.start).getTime();

        const eventEnd =
          new Date(event.end).getTime();

        return (
          eventStart < rangeEnd &&
          eventEnd > rangeStart
        );
      })
      .slice(0, input.maxResults);
  }

  async createEvent(
    input: CreateCalendarEventInput,
  ): Promise<CalendarEvent> {
    const existing =
      this.idempotencyIndex.get(
        input.idempotencyKey,
      );

    if (existing) {
      return existing;
    }

    const start = new Date(input.start).getTime();
    const end = new Date(input.end).getTime();

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end)
    ) {
      throw new Error("Invalid event time");
    }

    if (start >= end) {
      throw new Error(
        "start must be earlier than end",
      );
    }

    this.eventCounter += 1;

    const event: CalendarEvent = {
      id: `mock-created-${this.eventCounter}`,
      connectionId: input.connectionId,
      title: input.title,
      start: input.start,
      end: input.end,
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
    };

    this.createdEvents.push(event);
    this.idempotencyIndex.set(
      input.idempotencyKey,
      event,
    );

    return event;
  }
}
