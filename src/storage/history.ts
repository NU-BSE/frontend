import AsyncStorage from '@react-native-async-storage/async-storage';

const HISTORY_KEY = 'creepyim.history.v2';
const MAX_ENTRIES = 200;

export interface HistoryEntry {
  id: string;
  /** Scenario id, or 'general' when opened from "Ask Creepy". */
  threadId: string;
  /** Display label for the tag pill — the scenario title. */
  category: string;
  prompt: string;
  reply: string;
  /** Epoch ms. A number so JSON round-trips cleanly. */
  createdAt: number;
  /** Which engine produced it, so the privacy claim stays auditable. */
  engine: string;
}

async function readAll(): Promise<HistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // A corrupted or version-skewed blob must not crash the screen.
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is HistoryEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as HistoryEntry).id === 'string' &&
        typeof (entry as HistoryEntry).createdAt === 'number',
    );
  } catch {
    return [];
  }
}

export async function listHistory(): Promise<HistoryEntry[]> {
  const entries = await readAll();
  return entries.sort((a, b) => b.createdAt - a.createdAt);
}

export async function appendHistory(
  entry: Omit<HistoryEntry, 'id' | 'createdAt'>,
): Promise<HistoryEntry> {
  const record: HistoryEntry = {
    ...entry,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };

  const existing = await readAll();
  const next = [record, ...existing].slice(0, MAX_ENTRIES);

  try {
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Non-fatal.
  }

  return record;
}

export async function clearHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(HISTORY_KEY);
  } catch {
    // Non-fatal.
  }
}
