import type {
  AgentMessage,
  AgentModel,
  AgentModelInput,
  AgentModelResult,
  AgentToolCall,
  AgentToolResult,
  ConnectionSummary,
} from '../types';

/**
 * A fully controllable planner for tests: the script function sees the same
 * input a real model sees and decides the next step.
 */
export function createScriptedPlanner(
  script: (input: AgentModelInput) => AgentModelResult | Promise<AgentModelResult>,
  id = 'scripted-planner',
): AgentModel {
  return {
    id,
    capabilities: {
      textGeneration: true,
      toolCalling: true,
      structuredOutput: true,
    },
    async run(input) {
      return script(input);
    },
  };
}

interface SendIntent {
  person: string;
  text: string;
}

/*
 * No `\b` anchors: JavaScript word boundaries are ASCII-based and never
 * match around Cyrillic letters, so they would silently reject every
 * Russian request.
 */
const SEND_VERB_RE =
  /(?:напишите|напиши|отправьте|отправь|сообщите|сообщи|скиньте|скинь)/iu;
const TELEGRAM_RE = /(?:telegram|телеграм|телеграме|телегу)/iu;

/**
 * Extracts "who" and "what" from imperative Russian requests such as
 * "Напиши Данияру в Telegram, что буду через 20 минут".
 * Deliberately conservative: when unsure it returns null and the planner
 * falls back to a plain answer instead of guessing.
 */
export function parseSendIntent(rawText: string): SendIntent | null {
  const text = rawText.trim();
  if (!SEND_VERB_RE.test(text)) return null;

  const withoutVerb = text.replace(SEND_VERB_RE, '');

  // Message body: after "что" or after the last comma.
  let personPart = withoutVerb;
  let messagePart: string | null = null;

  const whatMatch = withoutVerb.match(/[, ]+(?:что|чтобы)\s+(.+)$/iu);
  if (whatMatch) {
    messagePart = whatMatch[1].trim();
    personPart = withoutVerb.slice(0, whatMatch.index).trim();
  } else {
    const commaIndex = withoutVerb.lastIndexOf(',');
    if (commaIndex >= 0 && commaIndex < withoutVerb.length - 1) {
      messagePart = withoutVerb.slice(commaIndex + 1).trim();
      personPart = withoutVerb.slice(0, commaIndex).trim();
    }
  }

  // Drop the "в Telegram" locator from the person part.
  personPart = personPart
    .replace(/\s*в\s+(?:telegram|телеграм|телеграме|телегу)\s*/iu, ' ')
    .replace(/[, ]+$/u, '')
    .replace(/^[, ]+/u, '')
    .trim();

  if (!personPart || !messagePart) return null;

  return { person: personPart, text: messagePart };
}

function toolResultsSinceLastUser(
  messages: readonly AgentMessage[],
): { toolName: string; result: AgentToolResult }[] {
  const out: { toolName: string; result: AgentToolResult }[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'user') break;
    if (message.role === 'tool') {
      out.unshift({ toolName: message.toolName, result: message.result });
    }
  }
  return out;
}

function findConnection(
  connections: readonly ConnectionSummary[],
  provider: string,
): ConnectionSummary | undefined {
  return connections.find((connection) => connection.provider === provider);
}

let callCounter = 0;
function nextCallId(): string {
  callCounter += 1;
  return `call_det_${callCounter.toString(36)}`;
}

function toolCall(toolName: string, args: Record<string, unknown>): AgentModelResult {
  return {
    kind: 'tool_calls',
    toolCalls: [{ id: nextCallId(), toolName, args } as AgentToolCall],
  };
}

/**
 * Deterministic development planner.
 *
 * Drives the production-shaped loop (search chat → send message → approval
 * → confirm → final answer) without any model, so the whole vertical slice
 * is verifiable in dev builds and CI. It never pretends: when the required
 * connector is not connected it says so instead of hallucinating success.
 */
export function createDeterministicPlanner(): AgentModel {
  return {
    id: 'deterministic-planner',
    capabilities: {
      textGeneration: true,
      toolCalling: true,
      structuredOutput: true,
    },
    async run({ messages, tools, connections }): Promise<AgentModelResult> {
      const lastUser = [...messages]
        .reverse()
        .find((message) => message.role === 'user');
      const userText =
        lastUser && lastUser.role === 'user' ? lastUser.content : '';

      const toolNames = new Set(tools.map((tool) => tool.name));
      const hasTelegramTools =
        toolNames.has('telegram.user.search_chats') &&
        toolNames.has('telegram.user.send_message');
      const telegramConnection = findConnection(connections, 'telegram-user');
      const wantsTelegram = TELEGRAM_RE.test(userText);

      const intent = parseSendIntent(userText);

      if (intent && (wantsTelegram || hasTelegramTools)) {
        if (!hasTelegramTools || !telegramConnection) {
          return {
            kind: 'final',
            text:
              'Telegram is not connected. Connect your Telegram account in ' +
              'Account → Connectors, then ask me again.',
          };
        }

        const history = toolResultsSinceLastUser(messages);
        const search = history.find(
          (entry) => entry.toolName === 'telegram.user.search_chats',
        );

        if (!search) {
          return toolCall('telegram.user.search_chats', {
            connectionId: telegramConnection.id,
            query: intent.person,
          });
        }

        if (search.result.status !== 'success') {
          return {
            kind: 'final',
            text: `Не получилось найти чат: ${search.result.error ?? 'unknown error'}`,
          };
        }

        const chats = (search.result.data as { chats?: unknown[] })?.chats;
        if (!Array.isArray(chats) || chats.length === 0) {
          return {
            kind: 'final',
            text: `Я не нашёл чат «${intent.person}» в Telegram. Уточни имя или ник.`,
          };
        }

        const send = history.find(
          (entry) => entry.toolName === 'telegram.user.send_message',
        );

        if (!send) {
          const chat = chats[0] as { id: string; title?: string };
          return toolCall('telegram.user.send_message', {
            connectionId: telegramConnection.id,
            chatId: chat.id,
            chatTitle: chat.title,
            text: intent.text,
          });
        }

        switch (send.result.status) {
          case 'success':
            return {
              kind: 'final',
              text: `Готово — отправил сообщение в Telegram.`,
            };
          case 'user_denied':
            return {
              kind: 'final',
              text: 'Хорошо, ничего не отправил.',
            };
          case 'error':
            return {
              kind: 'final',
              text: `Не получилось отправить сообщение: ${send.result.error ?? 'unknown error'}`,
            };
          default:
            return {
              kind: 'final',
              text: 'Что-то пошло не так — попробуй ещё раз.',
            };
        }
      }

      return {
        kind: 'final',
        text:
          'Я локальный агент Creepy.IM. Могу, например, написать сообщение ' +
          'в Telegram от твоего имени — скажи, кому и что отправить.',
      };
    },
  };
}
