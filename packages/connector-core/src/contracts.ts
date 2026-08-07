export interface CalendarEvent {
  id: string;
  connectionId: string;
  title: string;
  description?: string;
  start: string;
  end: string;
  htmlLink?: string;
}

export interface ListCalendarEventsInput {
  connectionId: string;
  start: string;
  end: string;
  maxResults: number;
}

export interface CreateCalendarEventInput {
  connectionId: string;
  title: string;
  description?: string;
  start: string;
  end: string;
  idempotencyKey: string;
}

export interface CalendarConnector {
  listEvents(
    input: ListCalendarEventsInput,
  ): Promise<CalendarEvent[]>;

  createEvent(
    input: CreateCalendarEventInput,
  ): Promise<CalendarEvent>;
}

export interface ApprovalCheckInput {
  approvalId: string;
  toolName: string;
  payload: Record<string, unknown>;
}

export interface ApprovalIssueInput {
  toolName: string;
  payload: Record<string, unknown>;
}

export interface ApprovalStore {
  /**
   * Бросает ошибку, если approval не существует,
   * уже использован или не совпадает с payload.
   */
  assertApproved(
    input: ApprovalCheckInput,
  ): Promise<void>;
}

export interface MobileAgentDependencies {
  calendar: CalendarConnector;
  approvals: ApprovalStore;
}
