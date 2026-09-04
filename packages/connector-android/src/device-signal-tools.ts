import { z } from 'zod';

import type { ConnectorTool } from '@mobile-agent/connector-core';

import { mapAndroidSettingsError } from './android-settings-errors';

const CONNECTION_ID = z.string().min(1);

/** Injected by the app layer; this package never imports React Native. */
export interface DeviceSignalBridge {
  usage: {
    hasPermission(): Promise<boolean>;
    recent(days: number): Promise<{ packageName: string; at: number }[]>;
  };
  notifications: {
    hasPermission(): Promise<boolean>;
    list(): Promise<
      {
        key: string;
        packageName: string;
        title?: string;
        text?: string;
        postedAt: number;
        canReply: boolean;
      }[]
    >;
    reply(key: string, message: string): Promise<boolean>;
  };
  media: {
    nowPlaying(): Promise<{
      packageName: string;
      isPlaying: boolean;
      title?: string;
      artist?: string;
      album?: string;
    } | null>;
    play(): Promise<boolean>;
    pause(): Promise<boolean>;
    next(): Promise<boolean>;
    previous(): Promise<boolean>;
    setVolume(fraction: number): Promise<boolean>;
    getVolume(): Promise<number | null>;
  };
}

export interface DeviceSignalToolsDeps {
  bridge: DeviceSignalBridge;
}

/**
 * Tools for the Phase 4 device signals.
 *
 * Each group is gated on its own grant at call time rather than at
 * registration: the user can revoke usage or notification access from system
 * settings at any moment, and a tool that was registered an hour ago would
 * otherwise report emptiness instead of saying it lost access.
 */
export function createDeviceSignalTools({
  bridge,
}: DeviceSignalToolsDeps): ConnectorTool<any, any>[] {
  return [
    {
      name: 'android.notifications.list',
      title: 'Read notifications',
      description:
        'Recent notifications from the phone, newest first. Use to summarise ' +
        'what the user missed, or to find a message worth replying to.',
      inputSchema: z.object({
        connectionId: CONNECTION_ID,
        limit: z.number().int().min(1).max(50).optional(),
      }),
      outputSchema: z.object({
        available: z.boolean(),
        reason: z.string().optional(),
        notifications: z
          .array(
            z.object({
              key: z.string(),
              packageName: z.string(),
              title: z.string().optional(),
              text: z.string().optional(),
              postedAt: z.number(),
              canReply: z.boolean(),
            }),
          )
          .optional(),
      }),
      /*
       * `read`, and among the most sensitive: the shade carries one-time
       * passcodes and banking alerts alongside chat. The native side already
       * narrows what is stored; this is the second gate.
       */
      risk: 'read',
      capabilities: ['android.notifications.read'],
      requiredScopes: ['android.notifications.read'],
      implementationStatus: 'real',
      execute: async (input: { limit?: number }) => {
        try {
          if (!(await bridge.notifications.hasPermission())) {
            return {
              available: false,
              reason: 'Notification access has not been granted on this phone.',
            };
          }
          const all = await bridge.notifications.list();
          return { available: true, notifications: all.slice(0, input.limit ?? 20) };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'reading notifications');
        }
      },
    },

    {
      name: 'android.notifications.reply',
      title: 'Reply to a notification',
      description:
        'Send a reply through a notification’s own reply action, without ' +
        'opening the app. Only works where `canReply` was true.',
      inputSchema: z.object({
        connectionId: CONNECTION_ID,
        key: z.string().min(1),
        message: z.string().min(1),
      }),
      outputSchema: z.object({
        sent: z.boolean(),
        reason: z.string().optional(),
      }),
      /*
       * This sends a message to another person. It is the highest-consequence
       * tool in this file and must always be confirmed — the app's approval
       * flow keys off `risk`, so understating it here would let a model message
       * someone without the user seeing it first.
       */
      risk: 'write',
      capabilities: ['android.notifications.reply'],
      requiredScopes: ['android.notifications.reply'],
      implementationStatus: 'real',
      execute: async (input: { key: string; message: string }) => {
        try {
          if (!(await bridge.notifications.hasPermission())) {
            return {
              sent: false,
              reason: 'Notification access has not been granted on this phone.',
            };
          }
          const sent = await bridge.notifications.reply(input.key, input.message);
          return sent
            ? { sent: true }
            : {
                sent: false,
                // Both ordinary: the conversation may have been opened
                // elsewhere, which retires the reply action.
                reason: 'That notification is gone or offers no reply action.',
              };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'replying to a notification');
        }
      },
    },

    {
      name: 'android.usage.recent',
      title: 'App usage history',
      description:
        'Which apps the user opened recently, oldest first. Use to answer ' +
        'questions about their own habits — never to guess at anything else.',
      inputSchema: z.object({
        connectionId: CONNECTION_ID,
        days: z.number().int().min(1).max(30).optional(),
      }),
      outputSchema: z.object({
        available: z.boolean(),
        reason: z.string().optional(),
        events: z
          .array(z.object({ packageName: z.string(), at: z.number() }))
          .optional(),
      }),
      risk: 'read',
      capabilities: ['android.usage.read'],
      requiredScopes: ['android.usage.read'],
      implementationStatus: 'real',
      execute: async (input: { days?: number }) => {
        try {
          if (!(await bridge.usage.hasPermission())) {
            return {
              available: false,
              reason: 'Usage access has not been granted on this phone.',
            };
          }
          return { available: true, events: await bridge.usage.recent(input.days ?? 14) };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'reading usage history');
        }
      },
    },

    {
      name: 'android.media.now_playing',
      title: 'What is playing',
      description: 'The current media session, or nothing when audio is idle.',
      inputSchema: z.object({ connectionId: CONNECTION_ID }),
      outputSchema: z.object({
        playing: z.boolean(),
        packageName: z.string().optional(),
        title: z.string().optional(),
        artist: z.string().optional(),
        album: z.string().optional(),
      }),
      risk: 'read',
      capabilities: ['android.media.read'],
      requiredScopes: ['android.media.read'],
      implementationStatus: 'real',
      execute: async () => {
        try {
          const now = await bridge.media.nowPlaying();
          if (!now) return { playing: false };
          return {
            playing: now.isPlaying,
            packageName: now.packageName,
            ...(now.title !== undefined ? { title: now.title } : {}),
            ...(now.artist !== undefined ? { artist: now.artist } : {}),
            ...(now.album !== undefined ? { album: now.album } : {}),
          };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'reading media state');
        }
      },
    },

    {
      name: 'android.media.control',
      title: 'Control playback',
      description:
        'Play, pause, skip or change media volume on whatever app is playing.',
      inputSchema: z.object({
        connectionId: CONNECTION_ID,
        action: z.enum(['play', 'pause', 'next', 'previous']).optional(),
        /** 0..1. Provide instead of `action` to change volume. */
        volume: z.number().min(0).max(1).optional(),
      }),
      outputSchema: z.object({
        applied: z.boolean(),
        reason: z.string().optional(),
      }),
      /*
       * `write` rather than higher: it changes what the user hears, which is
       * immediately obvious and trivially reversible by them.
       */
      risk: 'write',
      capabilities: ['android.media.control'],
      requiredScopes: ['android.media.control'],
      implementationStatus: 'real',
      execute: async (input: { action?: string; volume?: number }) => {
        try {
          if (input.volume !== undefined) {
            return { applied: await bridge.media.setVolume(input.volume) };
          }
          switch (input.action) {
            case 'play':
              return { applied: await bridge.media.play() };
            case 'pause':
              return { applied: await bridge.media.pause() };
            case 'next':
              return { applied: await bridge.media.next() };
            case 'previous':
              return { applied: await bridge.media.previous() };
            default:
              return {
                applied: false,
                reason: 'Provide an action or a volume.',
              };
          }
        } catch (error) {
          throw mapAndroidSettingsError(error, 'controlling playback');
        }
      },
    },
  ];
}
