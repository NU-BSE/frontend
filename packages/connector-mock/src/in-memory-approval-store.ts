import type {
  ApprovalCheckInput,
  ApprovalIssueInput,
  ApprovalStore,
} from "@mobile-agent/connector-core";

interface IssuedApproval {
  toolName: string;
  payloadKey: string;
  used: boolean;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (
    value !== null &&
    typeof value === "object"
  ) {
    const record = value as Record<
      string,
      unknown
    >;

    const sorted = Object.keys(record)
      .sort()
      .map((key) => [
        key,
        canonicalize(record[key]),
      ] as const);

    return Object.fromEntries(sorted);
  }

  return value;
}

function payloadKey(
  payload: Record<string, unknown>,
): string {
  return JSON.stringify(canonicalize(payload));
}

/**
 * Mock approval store для первой версии.
 *
 * Approval выдаётся UI-слоем после подтверждения
 * пользователя и может быть использован ровно один раз
 * только с тем payload, который был подтверждён.
 */
export class InMemoryApprovalStore
  implements ApprovalStore
{
  private readonly approvals = new Map<
    string,
    IssuedApproval
  >();

  private counter = 0;

  issue(input: ApprovalIssueInput): string {
    this.counter += 1;

    const approvalId =
      `mock-approval-${this.counter}`;

    this.approvals.set(approvalId, {
      toolName: input.toolName,
      payloadKey: payloadKey(input.payload),
      used: false,
    });

    return approvalId;
  }

  async assertApproved(
    input: ApprovalCheckInput,
  ): Promise<void> {
    const approval = this.approvals.get(
      input.approvalId,
    );

    if (!approval) {
      throw new Error("Approval not found");
    }

    if (approval.used) {
      throw new Error(
        "Approval has already been used",
      );
    }

    if (approval.toolName !== input.toolName) {
      throw new Error(
        "Approval was issued for a different tool",
      );
    }

    if (
      approval.payloadKey !==
      payloadKey(input.payload)
    ) {
      throw new Error(
        "Approval does not match the requested payload",
      );
    }

    approval.used = true;
  }
}
