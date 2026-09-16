import AsyncStorage from '@react-native-async-storage/async-storage';

import { AgentRuntime } from '@/agent/AgentRuntime';
import type { AgentModel } from '@/agent/types';
import { createOnDeviceEngine } from '../engines/onDeviceEngine';
import {
  clearMetrics,
  exportMetrics,
  MAX_STORED_EVENTS,
  METRICS_STORAGE_KEY,
  readMetricsLog,
  recordMetricsEvent,
  sanitizeMetricsEvent,
} from '../metrics';

jest.mock('llama.rn', () => ({
  initLlama: jest.fn().mockImplementation(async () => ({
    completion: jest.fn().mockImplementation(async (_params, onToken) => {
      onToken?.({ token: 'Hello' });
      onToken?.({ token: ' world' });
      return { text: 'Hello world' };
    }),
    stopCompletion: jest.fn(),
    release: jest.fn().mockResolvedValue(undefined),
  })),
}), { virtual: true });

describe('Local Inference & Agent Metrics Module', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  describe('Privacy Allowlist Filter (sanitizeMetricsEvent)', () => {
    it('strips all sensitive and prompt/content properties', () => {
      const rawWithSensitiveData = {
        schemaVersion: 1,
        timestamp: 1700000000000,
        eventType: 'inference',
        engine: 'creepyim-on-device',

        // Sensitive / forbidden fields
        prompt: 'What is my social security number?',
        text: 'Your social security number is...',
        output: 'Secret output text',
        toolArgs: { filename: '/etc/passwd', key: 'secret-api-key' },
        toolResults: { data: 'private user data' },
        message: 'Direct user message text',
        filename: 'secret_document.pdf',
        credentials: { token: 'bearer-xyz' },
        user: { name: 'John Doe', email: 'john@example.com' },
        deviceFingerprint: 'unique-hw-uuid-12345',

        // Valid technical fields
        timeToFirstTokenMs: 250,
        generationMs: 1200,
        outputTokens: 45,
        tokensPerSecond: 37.5,
        completionCategory: 'success',
      };

      const sanitized = sanitizeMetricsEvent(rawWithSensitiveData);

      expect(sanitized).not.toBeNull();
      expect(sanitized).toEqual({
        schemaVersion: 1,
        timestamp: 1700000000000,
        eventType: 'inference',
        engine: 'creepyim-on-device',
        timeToFirstTokenMs: 250,
        generationMs: 1200,
        outputTokens: 45,
        tokensPerSecond: 37.5,
        completionCategory: 'success',
      });

      // Explicitly assert forbidden fields do not exist on the sanitized object
      const obj = sanitized as Record<string, unknown>;
      expect(obj.prompt).toBeUndefined();
      expect(obj.text).toBeUndefined();
      expect(obj.output).toBeUndefined();
      expect(obj.toolArgs).toBeUndefined();
      expect(obj.toolResults).toBeUndefined();
      expect(obj.message).toBeUndefined();
      expect(obj.filename).toBeUndefined();
      expect(obj.credentials).toBeUndefined();
      expect(obj.user).toBeUndefined();
      expect(obj.deviceFingerprint).toBeUndefined();
    });

    it('validates engine_load, inference, and agent_run event structures', () => {
      const loadEvent = sanitizeMetricsEvent({
        eventType: 'engine_load',
        engine: 'creepyim-on-device',
        loadDurationMs: 3450,
        completionCategory: 'success',
      });
      expect(loadEvent).toEqual({
        schemaVersion: 1,
        timestamp: expect.any(Number),
        eventType: 'engine_load',
        engine: 'creepyim-on-device',
        loadDurationMs: 3450,
        completionCategory: 'success',
      });

      const runEvent = sanitizeMetricsEvent({
        eventType: 'agent_run',
        engine: 'creepyim-on-device',
        toolCallCount: 3,
        totalSteps: 4,
        completionCategory: 'max_steps_reached',
        errorCategory: 'context_full',
      });
      expect(runEvent).toEqual({
        schemaVersion: 1,
        timestamp: expect.any(Number),
        eventType: 'agent_run',
        engine: 'creepyim-on-device',
        toolCallCount: 3,
        totalSteps: 4,
        completionCategory: 'max_steps_reached',
        errorCategory: 'context_full',
      });
    });

    it('rejects events missing valid eventType or invalid structure', () => {
      expect(sanitizeMetricsEvent(null)).toBeNull();
      expect(sanitizeMetricsEvent(undefined)).toBeNull();
      expect(sanitizeMetricsEvent('invalid string')).toBeNull();
      expect(sanitizeMetricsEvent({})).toBeNull();
      expect(sanitizeMetricsEvent({ eventType: 'invalid_event_type' })).toBeNull();
    });
  });

  describe('Storage & Persistence (store)', () => {
    it('records and reads metrics events in AsyncStorage', async () => {
      await recordMetricsEvent({
        eventType: 'engine_load',
        engine: 'creepyim-on-device',
        loadDurationMs: 1500,
        completionCategory: 'success',
      });

      const events = await readMetricsLog();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventType: 'engine_load',
        engine: 'creepyim-on-device',
        loadDurationMs: 1500,
      });
    });

    it('caps stored events at MAX_STORED_EVENTS (200)', async () => {
      for (let i = 0; i < 220; i += 1) {
        await recordMetricsEvent({
          eventType: 'inference',
          generationMs: 100 + i,
        });
      }

      const events = await readMetricsLog();
      expect(events).toHaveLength(MAX_STORED_EVENTS);
      // Verify oldest 20 were evicted and newest remain
      expect(events[0].generationMs).toBe(120);
      expect(events[199].generationMs).toBe(319);
    });

    it('clears stored metrics when clearMetrics is called', async () => {
      await recordMetricsEvent({ eventType: 'engine_load', loadDurationMs: 500 });
      expect(await readMetricsLog()).toHaveLength(1);

      await clearMetrics();
      expect(await readMetricsLog()).toHaveLength(0);
      expect(await AsyncStorage.getItem(METRICS_STORAGE_KEY)).toBeNull();
    });

    it('exports allowlisted payload with schemaVersion and exportedAt', async () => {
      await recordMetricsEvent({
        eventType: 'inference',
        generationMs: 500,
        sensitiveArg: 'should be stripped in export',
      });

      const exported = await exportMetrics();
      expect(exported.schemaVersion).toBe(1);
      expect(exported.exportedAt).toEqual(expect.any(Number));
      expect(exported.events).toHaveLength(1);
      expect(exported.events[0]).toEqual({
        schemaVersion: 1,
        timestamp: expect.any(Number),
        eventType: 'inference',
        generationMs: 500,
      });
      expect((exported.events[0] as Record<string, unknown>).sensitiveArg).toBeUndefined();
    });
  });

  describe('Engine Lifecycle Integration (onDeviceEngine)', () => {
    it('records engine_load metrics on prepare() and inference metrics on generate()', async () => {
      const engine = createOnDeviceEngine({ modelPath: '/path/to/model.gguf' });
      await engine.prepare();

      let events = await readMetricsLog();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventType: 'engine_load',
        engine: 'creepyim-on-device',
        completionCategory: 'success',
        loadDurationMs: expect.any(Number),
      });

      const tokens: string[] = [];
      for await (const chunk of engine.generate([{ role: 'user', content: 'Hi' }])) {
        tokens.push(chunk);
      }

      expect(tokens).toEqual(['Hello', ' world']);

      // Allow background recordMetricsEvent promise in generate's finally block to settle
      await new Promise((resolve) => setTimeout(resolve, 20));

      events = await readMetricsLog();
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        eventType: 'inference',
        engine: 'creepyim-on-device',
        outputTokens: 2,
        completionCategory: 'success',
        generationMs: expect.any(Number),
        timeToFirstTokenMs: expect.any(Number),
        tokensPerSecond: expect.any(Number),
      });
    });
  });

  describe('Agent Runtime Integration (AgentRuntime)', () => {
    it('records agent_run metrics on sendMessage() completion', async () => {
      const mockModel: AgentModel = {
        id: 'test-agent-model',
        label: 'Test Agent Model',
        capabilities: {
          textGeneration: true,
          toolCalling: true,
          structuredOutput: true,
        },
        run: jest.fn().mockResolvedValue({
          kind: 'final',
          text: 'Hello from mock agent model!',
          execution: {
            requestedTier: 'fast',
            effectiveTier: 'fast',
            routingReason: 'test',
            usage: {
              promptTokens: 15,
              completionTokens: 8,
              totalTokens: 23,
            },
          },
        }),
      };

      const runtime = new AgentRuntime({
        model: mockModel,
        connections: [],
        approveApproval: jest.fn(),
      });

      await runtime.sendMessage('Hello test');

      // Allow background recordMetricsEvent promise to settle
      await new Promise((resolve) => setTimeout(resolve, 20));

      const events = await readMetricsLog();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventType: 'agent_run',
        engine: 'test-agent-model',
        inputTokens: 15,
        outputTokens: 8,
        totalSteps: 1,
        toolCallCount: 0,
        completionCategory: 'success',
        generationMs: expect.any(Number),
      });
    });
  });
});
