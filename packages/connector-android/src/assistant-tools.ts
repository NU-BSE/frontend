import { z } from 'zod';

import type { ConnectorTool } from '@mobile-agent/connector-core';

import type { AndroidAssistantBridge } from './assistant-bridge';
import { mapAndroidSettingsError } from './android-settings-errors';

const CONNECTION_ID = z.string().min(1);

export interface AssistantToolsDeps {
  bridge: AndroidAssistantBridge;
}

/**
 * Assistant-role tools.
 *
 * These exist so "make yourself my assistant" is one system dialog rather than
 * a guided walk through Settings. The role dialog is the only way an app can
 * be granted ROLE_ASSISTANT — there is no silent path, by design — so the tool
 * asks the platform to ask the user, and reports what the user decided.
 */
export function createAssistantTools({
  bridge,
}: AssistantToolsDeps): ConnectorTool<any, any>[] {
  return [
    {
      name: 'android.assistant.get_status',
      title: 'Assistant status',
      description:
        'Whether Creepy is the device’s digital assistant, and whether the ' +
        'assistant role is offered by this device at all.',
      inputSchema: z.object({ connectionId: CONNECTION_ID }),
      outputSchema: z.object({
        roleAvailable: z.boolean(),
        isDefault: z.boolean(),
        serviceReady: z.boolean(),
      }),
      risk: 'read',
      capabilities: ['android.assistant.read'],
      requiredScopes: ['android.assistant.read'],
      implementationStatus: 'real',
      execute: async () => {
        try {
          return await bridge.getStatus();
        } catch (error) {
          throw mapAndroidSettingsError(error, 'reading assistant status');
        }
      },
    },

    {
      name: 'android.assistant.request_role',
      title: 'Become the device assistant',
      description:
        'Ask the user to make Creepy the device’s digital assistant. Shows the ' +
        'system chooser; the user decides. Use this instead of opening Settings ' +
        'when the intent is to become the assistant.',
      inputSchema: z.object({ connectionId: CONNECTION_ID }),
      outputSchema: z.object({
        granted: z.boolean(),
        /** What the caller should say or do next. */
        outcome: z.enum(['granted', 'declined', 'already_default', 'unavailable']),
      }),
      /*
       * `write`: it changes a device-wide setting and puts a dialog in front of
       * the user. It is not higher than that — the platform owns the decision,
       * the grant is reversible from Settings, and nothing leaves the device.
       */
      risk: 'write',
      capabilities: ['android.assistant.manage'],
      requiredScopes: ['android.assistant.manage'],
      implementationStatus: 'real',
      execute: async () => {
        try {
          const before = await bridge.getStatus();
          if (before.isDefault) {
            return { granted: true, outcome: 'already_default' as const };
          }
          if (!before.roleAvailable) {
            /*
             * No role API on this device. Opening the settings screen is the
             * only remaining route, and it cannot report back, so the outcome
             * is reported honestly as unavailable rather than as a refusal.
             */
            await bridge.openSettings();
            return { granted: false, outcome: 'unavailable' as const };
          }
          const granted = await bridge.requestRole();
          return {
            granted,
            outcome: granted ? ('granted' as const) : ('declined' as const),
          };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'requesting the assistant role');
        }
      },
    },

    {
      name: 'android.assistant.open_settings',
      title: 'Open assistant settings',
      description:
        'Open Android Default apps, where the user can choose the digital ' +
        'assistant. Android does not expose a public intent for the assistant ' +
        'sub-page itself; use request_role when the goal is to make Creepy the assistant.',
      inputSchema: z.object({ connectionId: CONNECTION_ID }),
      outputSchema: z.object({ opened: z.boolean() }),
      risk: 'write',
      capabilities: ['android.assistant.manage'],
      requiredScopes: ['android.assistant.manage'],
      implementationStatus: 'real',
      execute: async () => {
        try {
          return { opened: await bridge.openSettings() };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'opening assistant settings');
        }
      },
    },

    {
      name: 'android.assistant.get_screen_context',
      title: 'What was on screen',
      description:
        'The screen the user was looking at when Creepy was last summoned as the ' +
        'assistant. Empty unless Creepy was invoked as the assistant recently.',
      inputSchema: z.object({ connectionId: CONNECTION_ID }),
      outputSchema: z.object({
        available: z.boolean(),
        packageName: z.string().nullable().optional(),
        title: z.string().optional(),
        url: z.string().optional(),
        truncated: z.boolean().optional(),
        showSource: z.string().optional(),
        lines: z.array(z.string()).optional(),
      }),
      /*
       * `read`, but the most sensitive read here: it returns text from whatever
       * app the user had open. It is only ever populated by an explicit
       * assistant invocation, the native side collects no ids or input types,
       * and the capture expires — see ScreenContext.kt.
       */
      risk: 'read',
      capabilities: ['android.assistant.screen_context'],
      requiredScopes: ['android.assistant.screen_context'],
      implementationStatus: 'real',
      execute: async () => {
        try {
          const context = await bridge.getScreenContext();
          if (!context) return { available: false };

          const seen = new Set<string>();
          const lines: string[] = [];
          for (const node of context.nodes) {
            const line = (node.text ?? node.contentDescription ?? node.hint ?? '').trim();
            if (!line || seen.has(line)) continue;
            seen.add(line);
            lines.push(line);
          }

          return {
            available: true,
            packageName: context.packageName,
            ...(context.title !== undefined ? { title: context.title } : {}),
            ...(context.url !== undefined ? { url: context.url } : {}),
            truncated: context.truncated,
            showSource: context.showSource,
            lines,
          };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'reading the captured screen');
        }
      },
    },
  ];
}
