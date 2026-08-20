import * as z from 'zod/v4';
import {
  ConnectorError,
  StoreBackedConnector,
  type ConnectionRecord,
  type ConnectorTool,
  type StoreBackedConnectorOptions,
} from '@mobile-agent/connector-core';

import type { AndroidIntentBridge } from './intent-bridge';

export const INTENT_CONNECTION_ID = 'intent-device';

export interface IntentConnectorOptions extends StoreBackedConnectorOptions {
  bridge: AndroidIntentBridge;
}

const CONNECTION_ID = z.string().min(1);
const PACKAGE = z.string().trim().min(1).max(255);

const MAP_INPUT = z
  .object({
    connectionId: CONNECTION_ID,
    query: z.string().trim().min(1).max(500).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.latitude === undefined) !== (value.longitude === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['latitude'],
        message: 'latitude and longitude must be supplied together.',
      });
    }
    if (!value.query && value.latitude === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'Provide a map query or latitude/longitude.',
      });
    }
  });

const URI = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine(
    (value) => /^(?:https?|mailto|tel|geo):/iu.test(value),
    'URI must use http, https, mailto, tel, or geo.',
  );

function requireOpened(opened: boolean, action: string): void {
  if (!opened) {
    throw new ConnectorError(
      `Android could not ${action}; no compatible app may be available.`,
      'UNSUPPORTED',
    );
  }
}

function createIntentTools(bridge: AndroidIntentBridge): ConnectorTool<any, any>[] {
  return [
    {
      name: 'intent.open_uri',
      title: 'Open URI',
      description: 'Open an http(s), mailto, tel or geo URI in a compatible Android app.',
      inputSchema: z.object({ connectionId: CONNECTION_ID, uri: URI }),
      outputSchema: z.object({ opened: z.literal(true) }),
      risk: 'write',
      capabilities: ['android.intent.open'],
      requiredScopes: [],
      implementationStatus: 'real',
      execute: async (input: { connectionId: string; uri: string }) => {
        requireOpened(await bridge.openUri(input.uri), 'open that URI');
        return { opened: true as const };
      },
    },
    {
      name: 'intent.open_app',
      title: 'Open app',
      description: 'Launch an installed Android app by package name.',
      inputSchema: z.object({ connectionId: CONNECTION_ID, packageName: PACKAGE }),
      outputSchema: z.object({ opened: z.literal(true), packageName: z.string() }),
      risk: 'write',
      capabilities: ['android.intent.open'],
      requiredScopes: [],
      implementationStatus: 'real',
      execute: async (input: { connectionId: string; packageName: string }) => {
        requireOpened(await bridge.openApp(input.packageName), `open ${input.packageName}`);
        return { opened: true as const, packageName: input.packageName };
      },
    },
    {
      name: 'intent.share_text',
      title: 'Share text',
      description: 'Open the Android Sharesheet, or a specified target app, with text prepared to share.',
      inputSchema: z.object({
        connectionId: CONNECTION_ID,
        text: z.string().min(1).max(100_000),
        targetPackage: PACKAGE.optional(),
      }),
      outputSchema: z.object({ opened: z.literal(true) }),
      risk: 'external_side_effect',
      capabilities: ['android.intent.share'],
      requiredScopes: [],
      implementationStatus: 'real',
      execute: async (input: {
        connectionId: string;
        text: string;
        targetPackage?: string;
      }) => {
        requireOpened(
          await bridge.shareText(input.text, input.targetPackage),
          'open the share flow',
        );
        return { opened: true as const };
      },
    },
    {
      name: 'intent.share_file',
      title: 'Share file',
      description: 'Open the Android Sharesheet with a content:// or android.resource:// file URI.',
      inputSchema: z.object({
        connectionId: CONNECTION_ID,
        fileUri: z
          .string()
          .trim()
          .min(1)
          .max(4096)
          .refine(
            (value) => /^(?:content|android\.resource):\/\//iu.test(value),
            'fileUri must be a content:// or android.resource:// URI.',
          ),
        mimeType: z.string().trim().min(1).max(255).optional(),
        targetPackage: PACKAGE.optional(),
      }),
      outputSchema: z.object({ opened: z.literal(true) }),
      risk: 'external_side_effect',
      capabilities: ['android.intent.share'],
      requiredScopes: [],
      implementationStatus: 'real',
      execute: async (input: {
        connectionId: string;
        fileUri: string;
        mimeType?: string;
        targetPackage?: string;
      }) => {
        requireOpened(
          await bridge.shareFile(input.fileUri, input.mimeType, input.targetPackage),
          'open the file share flow',
        );
        return { opened: true as const };
      },
    },
    {
      name: 'intent.compose_email',
      title: 'Compose email',
      description: 'Open an Android email composer with optional recipient, subject and body. This does not send the message.',
      inputSchema: z.object({
        connectionId: CONNECTION_ID,
        to: z.string().trim().max(320).optional(),
        subject: z.string().max(998).optional(),
        body: z.string().max(100_000).optional(),
      }),
      outputSchema: z.object({ opened: z.literal(true) }),
      risk: 'external_side_effect',
      capabilities: ['android.intent.compose'],
      requiredScopes: [],
      implementationStatus: 'real',
      execute: async (input: {
        connectionId: string;
        to?: string;
        subject?: string;
        body?: string;
      }) => {
        requireOpened(
          await bridge.composeEmail(input.to, input.subject, input.body),
          'open an email composer',
        );
        return { opened: true as const };
      },
    },
    {
      name: 'intent.open_map',
      title: 'Open map',
      description: 'Open a map app using a place query or latitude/longitude.',
      inputSchema: MAP_INPUT,
      outputSchema: z.object({ opened: z.literal(true) }),
      risk: 'write',
      capabilities: ['android.intent.navigation'],
      requiredScopes: [],
      implementationStatus: 'real',
      execute: async (input: {
        connectionId: string;
        query?: string;
        latitude?: number;
        longitude?: number;
      }) => {
        requireOpened(
          await bridge.openMap(input.query, input.latitude, input.longitude),
          'open a map',
        );
        return { opened: true as const };
      },
    },
    {
      name: 'intent.open_dialer',
      title: 'Open dialer',
      description: 'Open the Android phone dialer with an optional number. This does not place the call.',
      inputSchema: z.object({
        connectionId: CONNECTION_ID,
        phoneNumber: z.string().trim().max(100).optional(),
      }),
      outputSchema: z.object({ opened: z.literal(true) }),
      risk: 'write',
      capabilities: ['android.intent.navigation'],
      requiredScopes: [],
      implementationStatus: 'real',
      execute: async (input: { connectionId: string; phoneNumber?: string }) => {
        requireOpened(await bridge.openDialer(input.phoneNumber), 'open the dialer');
        return { opened: true as const };
      },
    },
  ];
}

/** Real local Android outward-intent connector. */
export class IntentConnector extends StoreBackedConnector {
  readonly id = 'intent' as const;
  readonly displayName = 'Android Intents';
  readonly implementationStatus = 'production' as const;

  private readonly bridge: AndroidIntentBridge;

  constructor(options: IntentConnectorOptions) {
    super(options);
    this.bridge = options.bridge;
  }

  async connect(): Promise<ConnectionRecord> {
    const now = Date.now();
    const existing = await this.store.get(INTENT_CONNECTION_ID);
    const record: ConnectionRecord = {
      id: INTENT_CONNECTION_ID,
      connectorId: this.id,
      displayName: 'Android intents',
      status: 'connected',
      scopes: [],
      capabilities: [
        'android.intent.open',
        'android.intent.share',
        'android.intent.compose',
        'android.intent.navigation',
      ],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.store.save(record);
    return record;
  }

  async getTools(_connection: ConnectionRecord): Promise<ConnectorTool<any, any>[]> {
    return createIntentTools(this.bridge);
  }
}
