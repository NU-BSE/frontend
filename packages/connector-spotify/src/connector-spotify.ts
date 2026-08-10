import * as z from 'zod/v4';
import type { ConnectionRecord, ConnectorTool } from '@mobile-agent/connector-core';
import { StoreBackedConnector, connId, opt, str, t } from '@mobile-agent/connector-core';

const tools: ConnectorTool[] = [
  t('spotify.user.profile', 'Get profile', 'Get current user profile', 'read',
    connId,
    { id: 'u1', display_name: 'Spotify User', email: 'user@spotify.com' }),
  t('spotify.search', 'Search', 'Search Spotify', 'read',
    z.object({ connectionId: str, query: str, type: z.string().default('track') }),
    { tracks: { items: [{ id: 't1', name: 'Song Name', artists: [{ name: 'Artist' }] }] } }),
  t('spotify.playback.getState', 'Get playback state', 'Get current playback state', 'read',
    connId,
    { is_playing: true, item: { id: 't1', name: 'Song Name' }, progress_ms: 30000 }),
  t('spotify.playback.play', 'Play', 'Resume playback', 'write',
    connId,
    { success: true }),
  t('spotify.playback.pause', 'Pause', 'Pause playback', 'write',
    connId,
    { success: true }),
  t('spotify.playback.next', 'Next track', 'Skip to next track', 'write',
    connId,
    { success: true }),
  t('spotify.playback.previous', 'Previous track', 'Skip to previous track', 'write',
    connId,
    { success: true }),
  t('spotify.playback.addToQueue', 'Add to queue', 'Add item to playback queue', 'write',
    z.object({ connectionId: str, uri: str }),
    { success: true }),
  t('spotify.playlists.list', 'List playlists', 'List user playlists', 'read',
    connId,
    { items: [{ id: 'pl1', name: 'My Playlist', tracks: { total: 42 } }] }),
  t('spotify.playlists.create', 'Create playlist', 'Create a new playlist', 'write',
    z.object({ connectionId: str, name: str, description: opt }),
    { id: 'pl2', name: 'New Playlist' }),
  t('spotify.playlists.addItems', 'Add to playlist', 'Add items to a playlist', 'write',
    z.object({ connectionId: str, playlistId: str, uris: z.array(str) }),
    { snapshot_id: 'snap1' }),
];

export class SpotifyConnector extends StoreBackedConnector {
  readonly id = 'spotify' as const;
  readonly displayName = 'Spotify';
  readonly implementationStatus = 'mock' as const;
  async getTools(_c: ConnectionRecord) { return tools; }
}
