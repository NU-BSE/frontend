import type { MemoryProfile } from '@/storage/prefs';

import { ON_DEVICE_MODEL_PATH } from './config';

const env = process.env;

export type LocalMemoryProfile = Exclude<MemoryProfile, 'cloud'>;

export const LOCAL_MODEL_PATHS: Record<LocalMemoryProfile, string> = {
  efficient:
    env.EXPO_PUBLIC_LLM_MODEL_EFFICIENT_PATH?.trim() || ON_DEVICE_MODEL_PATH,
  balanced:
    env.EXPO_PUBLIC_LLM_MODEL_BALANCED_PATH?.trim() || ON_DEVICE_MODEL_PATH,
  performance:
    env.EXPO_PUBLIC_LLM_MODEL_PERFORMANCE_PATH?.trim() || ON_DEVICE_MODEL_PATH,
};

export const LOCAL_MODEL_RUNTIME: Record<
  LocalMemoryProfile,
  { contextSize: number; maxTokens: number }
> = {
  efficient: { contextSize: 1024, maxTokens: 192 },
  balanced: { contextSize: 2048, maxTokens: 320 },
  performance: { contextSize: 3072, maxTokens: 480 },
};
