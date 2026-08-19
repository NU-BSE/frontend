import type { PendingApproval } from './types';
import {
  APPROVE_ACTION_ID,
  REJECT_ACTION_ID,
  type SmartCard,
} from '@/notifications/smartCards';

/**
 * The notification for an approval the user cannot currently see.
 *
 * Built from the approval, never written by hand: the tool being approved is
 * the entire point of the card, and a generic "Creepy needs your confirmation"
 * would ask someone to authorise something without saying what.
 *
 * Both buttons are terminal — pressing either ends the card, because the
 * decision is the end of this interaction. Nothing here can lead anywhere
 * else: a follow-up card would have to be built from the run's next state,
 * which does not exist yet at the moment this card is posted.
 */

/** `telegram.user.send_message` -> `Telegram`. */
function providerOf(toolName: string): string {
  const [provider] = toolName.split('.');
  if (!provider) return 'Creepy';
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** `telegram.user.send_message` -> `send message`. */
function actionOf(toolName: string): string {
  const parts = toolName.split('.');
  const verb = parts[parts.length - 1] ?? toolName;
  return verb.replace(/_/gu, ' ');
}

/**
 * A short, safe description of what the tool was asked to do.
 *
 * Only values the user could already see in their own chat are shown, and
 * every one is truncated: a notification is visible on a lock screen, and the
 * arguments can contain the text of a message being sent.
 */
function summarize(args: Record<string, unknown>): string | undefined {
  const interesting = ['chatId', 'to', 'recipient', 'subject', 'title'];
  for (const key of interesting) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      return `${key}: ${value.slice(0, 40)}`;
    }
  }
  return undefined;
}

export function approvalCard(approval: PendingApproval): SmartCard {
  const provider = providerOf(approval.toolName);
  const detail = summarize(approval.args);

  return {
    title: `${provider}: confirm ${actionOf(approval.toolName)}?`,
    text: 'Creepy is waiting for you before it does this.',
    ...(detail ? { detail } : {}),
    actions: [
      { id: APPROVE_ACTION_ID, label: 'Confirm' },
      { id: REJECT_ACTION_ID, label: 'Not now' },
    ],
  };
}
