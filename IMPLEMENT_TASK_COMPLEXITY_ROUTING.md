# IMPLEMENT_TASK_COMPLEXITY_ROUTING.md

> Revised implementation specification for adaptive model routing in the Creepy.IM mobile agent.
>
> This version deliberately makes the most expensive model tier rare.
>
> Core rule:
>
> **Do not escalate to Terra because a task is long. Escalate only when the task is genuinely reasoning-hard or cheaper models are demonstrably failing.**

---

# 0. Goal

Implement adaptive routing across three model tiers:

```text
FAST
  ↓
NORMAL
  ↓
EXPERT
```

`EXPERT` is the rare tier. On the backend it may currently map to Terra, but the mobile app must never know or hard-code the concrete provider/model ID.

Target behavior:

```text
User
  ↓
AgentRuntime
  ↓
FAST
  ↓
tool calls / tool results
  ↓
ReasoningComplexityMonitor
  ├─ routine task → remain FAST
  ├─ moderate reasoning → NORMAL
  └─ hard reasoning or cheaper-model failure → EXPERT
```

A run must continue from its existing conversation state when the tier changes.

Never restart from only the original user prompt.

---

# 1. Three separate concepts

Do not mix these.

## 1.1 Task length

Examples:

```text
number of MCP calls
number of steps
number of connectors
amount of returned data
```

Task length is only a **weak complexity signal**.

## 1.2 Reasoning complexity

Examples:

```text
conflicting evidence
constraint solving
cross-source synthesis
ranking / optimization
temporal reconciliation
plan revision
uncertainty that cannot be solved by a simple clarification
```

Reasoning complexity is what should drive expensive-model escalation.

## 1.3 Action risk

Examples:

```text
read
write
external_side_effect
destructive
```

Risk belongs to MCP policy / approval.

Risk must never directly select Terra.

Example:

```text
"Delete this known message"
```

can be:

```text
complexity = simple
risk = destructive
```

The action still requires approval, but does not need an expert model.

---

# 2. Model tiers

Use:

```ts
export type ModelTier =
  | "fast"
  | "normal"
  | "expert";
```

Suggested semantics:

```text
FAST
- default
- cheap
- high-volume
- simple tool selection
- ordinary multi-step execution
- routine extraction and transformation

NORMAL
- moderate reasoning
- some synthesis
- one plan revision
- non-trivial interpretation
- larger context

EXPERT
- rare
- difficult synthesis
- conflicts
- optimization
- repeated replanning
- cheaper model is stuck
- difficult constraint reasoning
```

Do not name tiers after providers/models in frontend code.

Bad:

```ts
"luna"
"terra"
```

Good:

```ts
"fast"
"normal"
"expert"
```

The backend maps `expert` to Terra or any future replacement.

---

# 3. Expected traffic distribution

This is a product target, not a hard runtime rule:

```text
FAST    ~80-90%
NORMAL  ~8-18%
EXPERT  ~1-3%
```

If `EXPERT` rises significantly above this on normal consumer traffic, treat it as a routing-quality warning.

Do not enforce percentages by randomly denying expert access.

Use them for telemetry and tuning.

---

# 4. Files to add

Recommended:

```text
src/agent/routing/
  types.ts
  initialEstimate.ts
  ReasoningComplexityMonitor.ts
  reasoningScore.ts
  routingPolicy.ts
  loopDetector.ts
  telemetry.ts
  config.ts
  index.ts

scripts/
  verify-agent-routing.mts

evals/
  agent-routing.json
```

Adapt paths if `src/agent/` already has an established structure.

---

# 5. Runtime metrics

Create:

```ts
export interface AgentRunMetrics {
  stepCount: number;

  toolCalls: number;
  toolsUsed: string[];

  connectorDomains:
    Set<string>;

  readCalls: number;
  writeCalls: number;
  externalSideEffectCalls: number;
  destructiveCalls: number;

  failedToolCalls: number;
  invalidToolCalls: number;

  planRevisionCount: number;
  failedPlanCount: number;

  ambiguousLookupCount: number;
  userClarificationCount: number;

  totalToolResultChars: number;
  totalToolResultItems: number;

  repeatedToolPatternCount: number;

  currentTier: ModelTier;
  escalationCount: number;
}
```

These are observations.

They are not the final complexity decision.

---

# 6. Reasoning signals

Create a separate structure for actual reasoning difficulty.

```ts
export interface ReasoningSignals {
  // Weak execution signals
  toolCalls: number;
  connectorCount: number;
  stepCount: number;

  // Context signals
  largeUnstructuredContext: boolean;
  largeStructuredContext: boolean;

  // Hard reasoning signals
  crossSourceSynthesis: boolean;
  conflictingEvidence: boolean;
  constraintSolving: boolean;
  temporalReconciliation: boolean;
  rankingOrOptimization: boolean;
  dependentMultiStageReasoning: boolean;

  // Agent struggle signals
  failedPlans: number;
  replans: number;
  repeatedToolPattern: boolean;
  invalidToolCalls: number;
  repeatedToolFailures: number;

  // Uncertainty signals
  unresolvedAmbiguity: boolean;
  modelUncertain: boolean;
}
```

---

# 7. What each hard reasoning signal means

## 7.1 `crossSourceSynthesis`

True only when results from multiple sources must be **combined to reach one conclusion**.

Not enough:

```text
send Telegram message
then create calendar event
```

That is just sequential execution.

True example:

```text
read Telegram
read Gmail
read Calendar
decide which meeting time is actually the latest agreed one
```

---

## 7.2 `conflictingEvidence`

True when sources disagree and the model must resolve the conflict.

Example:

```text
Telegram: Wednesday after 16:00
Email: after 17:00
Calendar: busy 17:00-18:00
```

The model must determine a valid interpretation.

This is a strong expert signal.

---

## 7.3 `constraintSolving`

True when several hard or soft constraints must be satisfied.

Example:

```text
find one hour next week
after 15:00
not Friday
before 18:00
Daniyar and Arman both free
prefer earliest valid slot
```

This is not ordinary tool chaining.

---

## 7.4 `temporalReconciliation`

True when the agent must reason about relative dates, sequence, recency, or conflicting timestamps.

Example:

```text
which meeting time is the most recently agreed one?
```

A simple extraction of one explicit timestamp does not count.

---

## 7.5 `rankingOrOptimization`

True when several valid solutions exist and the model must select the best one using preferences.

Example:

```text
choose the earliest valid meeting time,
but avoid lunch,
and prefer Tuesday over Wednesday
```

---

## 7.6 `dependentMultiStageReasoning`

True when later reasoning depends materially on interpretation of earlier results.

Example:

```text
read chat
infer project name
use project name to search Drive
read document
use document deadline to inspect Calendar
```

A deterministic sequence with known arguments does not count.

---

# 8. Weak signals must never directly trigger EXPERT

These signals alone must **not** select expert:

```text
toolCalls >= N
connectorCount >= N
stepCount >= N
large result
multiple writes
```

Examples that should normally remain FAST/NORMAL:

```text
search 5 contacts and message each of them
```

```text
create 4 calendar events from explicit user-provided data
```

```text
read 3 known files and return their titles
```

These may be long, but not reasoning-hard.

---

# 9. Initial request estimate

Initial routing should be cheap and conservative.

Do not call a classifier LLM.

Create:

```ts
export interface InitialRoutingEstimate {
  suggestedTier: ModelTier;
  score: number;
  reasons: string[];
}
```

Default:

```text
FAST
```

Allow direct `NORMAL` only for obvious moderate cases.

Allow direct `EXPERT` only for extremely explicit hard-reasoning requests.

Example direct expert pattern conceptually:

```text
several explicit constraints
+
optimization/ranking language
+
cross-source reconciliation
```

Do not rely on English-only keywords.

The initial estimator is optional optimization.

Runtime evidence is more important.

---

# 10. Reasoning score

Create one pure function:

```ts
export interface ReasoningScore {
  score: number;
  reasons: string[];
}

export function calculateReasoningScore(
  s: ReasoningSignals,
): ReasoningScore;
```

Recommended weights:

```ts
export function calculateReasoningScore(
  s: ReasoningSignals,
): ReasoningScore {
  let score = 0;
  const reasons: string[] = [];

  // Weak signals
  if (s.toolCalls >= 7) {
    score += 1;
    reasons.push("many_tool_calls");
  }

  if (s.connectorCount >= 3) {
    score += 1;
    reasons.push("many_connectors");
  }

  if (s.stepCount >= 7) {
    score += 1;
    reasons.push("long_run");
  }

  if (s.largeStructuredContext) {
    score += 1;
    reasons.push("large_structured_context");
  }

  if (s.largeUnstructuredContext) {
    score += 2;
    reasons.push("large_unstructured_context");
  }

  // Hard reasoning
  if (s.crossSourceSynthesis) {
    score += 3;
    reasons.push("cross_source_synthesis");
  }

  if (s.conflictingEvidence) {
    score += 4;
    reasons.push("conflicting_evidence");
  }

  if (s.constraintSolving) {
    score += 4;
    reasons.push("constraint_solving");
  }

  if (s.temporalReconciliation) {
    score += 2;
    reasons.push("temporal_reconciliation");
  }

  if (s.rankingOrOptimization) {
    score += 3;
    reasons.push("ranking_or_optimization");
  }

  if (s.dependentMultiStageReasoning) {
    score += 3;
    reasons.push("dependent_multi_stage_reasoning");
  }

  // Agent struggle
  score += Math.min(
    s.failedPlans,
    2,
  ) * 3;

  if (s.failedPlans > 0) {
    reasons.push("failed_plan");
  }

  score += Math.min(
    s.replans,
    2,
  ) * 2;

  if (s.replans > 0) {
    reasons.push("replanning");
  }

  if (s.repeatedToolPattern) {
    score += 4;
    reasons.push("planner_loop");
  }

  if (s.invalidToolCalls >= 2) {
    score += 3;
    reasons.push("repeated_invalid_tool_calls");
  }

  if (s.repeatedToolFailures >= 2) {
    score += 2;
    reasons.push("repeated_tool_failures");
  }

  if (s.unresolvedAmbiguity) {
    score += 1;
    reasons.push("unresolved_ambiguity");
  }

  if (s.modelUncertain) {
    score += 1;
    reasons.push("model_uncertain");
  }

  return {
    score,
    reasons,
  };
}
```

---

# 11. Hard-reasoning gate

EXPERT requires more than a score.

Create:

```ts
export function hasHardReasoningSignal(
  s: ReasoningSignals,
): boolean {
  return (
    s.conflictingEvidence ||
    s.constraintSolving ||
    s.crossSourceSynthesis ||
    s.rankingOrOptimization ||
    s.dependentMultiStageReasoning ||
    s.failedPlans >= 2 ||
    s.repeatedToolPattern ||
    s.invalidToolCalls >= 3
  );
}
```

The normal expert rule is:

```text
reasoning score >= EXPERT_SCORE_THRESHOLD
AND
hasHardReasoningSignal == true
```

Recommended initial threshold:

```text
EXPERT_SCORE_THRESHOLD = 10
```

Use configuration, not scattered constants.

---

# 12. FAST → NORMAL policy

NORMAL is much easier to reach than EXPERT.

Suggested triggers:

```text
reasoning score >= 4
OR
one plan revision
OR
large unstructured context + synthesis
OR
one hard reasoning signal but low score
```

Example:

```ts
function shouldEscalateFastToNormal(
  score: number,
  s: ReasoningSignals,
): boolean {
  return (
    score >= 4 ||
    s.replans >= 1 ||
    (
      s.largeUnstructuredContext &&
      s.crossSourceSynthesis
    )
  );
}
```

---

# 13. NORMAL → EXPERT policy

Use a strict rule.

```ts
function shouldEscalateNormalToExpert(
  score: number,
  s: ReasoningSignals,
): boolean {
  return (
    score >=
      ROUTING_CONFIG.expertScoreThreshold &&
    hasHardReasoningSignal(s)
  );
}
```

Do not escalate just because:

```text
NORMAL has already made 3 tool calls
```

---

# 14. Emergency expert triggers

Some conditions indicate that the cheaper planner is stuck.

Allow expert escalation even if the weighted score is slightly below threshold when one of these occurs:

```text
2 failed plans
planner loop detected
3 invalid tool calls
2 major replans with no progress
```

Example:

```ts
export function hasEmergencyExpertTrigger(
  s: ReasoningSignals,
): boolean {
  return (
    s.failedPlans >= 2 ||
    s.repeatedToolPattern ||
    s.invalidToolCalls >= 3 ||
    s.replans >= 2
  );
}
```

Final expert decision:

```ts
const expert =
  (
    score >=
      ROUTING_CONFIG.expertScoreThreshold &&
    hasHardReasoningSignal(signals)
  ) ||
  hasEmergencyExpertTrigger(signals);
```

---

# 15. Loop detection

Create:

```text
loopDetector.ts
```

Detect repeated planner behavior.

Examples:

```text
search → get → search → get → search → get
```

or repeated identical calls:

```text
telegram.search_chats("Daniyar")
telegram.search_chats("Daniyar")
telegram.search_chats("Daniyar")
```

Suggested logic:

```ts
interface ToolCallFingerprint {
  toolName: string;
  normalizedArgsHash: string;
}
```

Track recent calls.

Set:

```ts
repeatedToolPattern = true
```

when:

```text
same fingerprint repeats 3 times
```

or:

```text
same 2-call sequence repeats twice
```

Do not count legitimate repeated bulk actions with different targets as a loop.

---

# 16. Progress detection

Tool count should not be confused with progress.

Track whether each step produced new useful state.

Concept:

```ts
export interface StepProgress {
  newEntityResolved: boolean;
  newConstraintResolved: boolean;
  newSourceRead: boolean;
  actionCompleted: boolean;
  planChanged: boolean;
}
```

If several steps occur without meaningful progress:

```text
no progress across 3 planning turns
```

raise a struggle signal.

This is more useful than raw `stepCount`.

---

# 17. Plan revisions

The planner should have a lightweight plan identity.

Example:

```ts
interface PlanSnapshot {
  objective: string;
  nextActions: string[];
  assumptions: string[];
}
```

A replan occurs when:

```text
tool result invalidates a prior assumption
and
the intended action path materially changes
```

Do not count normal next-step selection as replanning.

---

# 18. Cheap-model self-assessment

The planner may return optional metadata:

```json
{
  "confidence": 0.72,
  "needs_deeper_reasoning": false,
  "reasoning_flags": [
    "temporal_reconciliation"
  ]
}
```

Treat this only as supporting evidence.

Never allow:

```json
{
  "use_terra": true
}
```

to directly select the expert model.

The model can report signals.

The deterministic router decides tier.

---

# 19. Uncertainty

Low confidence alone must not trigger expert.

Example:

```text
two contacts named Daniyar
```

Correct behavior:

```text
ask user which one
```

not:

```text
use Terra to guess
```

Expert escalation is for reasoning difficulty, not to avoid necessary clarification.

---

# 20. Large context

Large data alone is weak.

Bad rule:

```text
20,000 chars → expert
```

Better:

```text
large context
+
synthesis / conflict / temporal reasoning
→ stronger signal
```

Examples:

```text
30,000 chars of file names
→ probably FAST/NORMAL
```

```text
30,000 chars of chat/email evidence with contradictions
→ NORMAL/EXPERT
```

---

# 21. Multi-connector logic

Connector count alone is weak.

Examples:

```text
Telegram send
+
Calendar create
```

is not expert.

But:

```text
Telegram evidence
+
Gmail evidence
+
Calendar state
→ derive one final decision
```

sets:

```text
crossSourceSynthesis = true
```

and likely:

```text
dependentMultiStageReasoning = true
```

---

# 22. Recommended router

Create:

```ts
export interface RoutingDecision {
  tier: ModelTier;
  reason:
    | "stay"
    | "moderate_reasoning"
    | "hard_reasoning"
    | "planner_stuck"
    | "emergency";
  score: number;
  reasons: string[];
}
```

Concept:

```ts
export function chooseTier(
  currentTier: ModelTier,
  signals: ReasoningSignals,
): RoutingDecision {
  const result =
    calculateReasoningScore(signals);

  if (currentTier === "expert") {
    return {
      tier: "expert",
      reason: "stay",
      score: result.score,
      reasons: result.reasons,
    };
  }

  if (
    hasEmergencyExpertTrigger(signals)
  ) {
    return {
      tier: "expert",
      reason: "planner_stuck",
      score: result.score,
      reasons: result.reasons,
    };
  }

  if (
    currentTier === "normal" &&
    result.score >=
      ROUTING_CONFIG
        .expertScoreThreshold &&
    hasHardReasoningSignal(signals)
  ) {
    return {
      tier: "expert",
      reason: "hard_reasoning",
      score: result.score,
      reasons: result.reasons,
    };
  }

  if (
    currentTier === "fast" &&
    shouldEscalateFastToNormal(
      result.score,
      signals,
    )
  ) {
    return {
      tier: "normal",
      reason: "moderate_reasoning",
      score: result.score,
      reasons: result.reasons,
    };
  }

  return {
    tier: currentTier,
    reason: "stay",
    score: result.score,
    reasons: result.reasons,
  };
}
```

---

# 23. Do not skip NORMAL normally

Preferred:

```text
FAST
→ NORMAL
→ EXPERT
```

Direct:

```text
FAST
→ EXPERT
```

should be rare.

Allow it only for:

```text
emergency expert trigger
```

or an initial request that is unquestionably a difficult optimization/constraint-synthesis task.

---

# 24. Configuration

Create one config:

```ts
export const ROUTING_CONFIG = {
  normalScoreThreshold: 4,

  expertScoreThreshold: 10,

  loopSameCallCount: 3,

  maxFailedPlansBeforeExpert: 2,

  maxReplansBeforeEmergencyExpert: 2,

  maxInvalidToolCallsBeforeExpert: 3,

  noProgressStepThreshold: 3,
} as const;
```

Do not hardcode thresholds elsewhere.

---

# 25. Example: many tools, stay FAST

User:

```text
Find Aidar, Daniyar and Arman
and send each:
"Meeting at 19:00"
```

Possible execution:

```text
search Aidar
send Aidar

search Daniyar
send Daniyar

search Arman
send Arman
```

Signals:

```text
toolCalls = 6
connectorCount = 1

crossSourceSynthesis = false
conflictingEvidence = false
constraintSolving = false
rankingOrOptimization = false
failedPlans = 0
replans = 0
```

Expected:

```text
FAST
```

The task is long-ish, not difficult.

---

# 26. Example: 2 tools, EXPERT may be justified

User:

```text
Read my recent conversation with Daniyar
and my calendar.

Find the best meeting time,
considering:
- he prefers after 16:00;
- I cannot meet after 18:00;
- I already have a blocked hour;
- if several options are valid, choose the earliest.
```

Tool calls:

```text
telegram.get_recent_messages
calendar.list_events
```

Only two reads.

Signals:

```text
crossSourceSynthesis = true
constraintSolving = true
rankingOrOptimization = true
temporalReconciliation = true
```

Possible score:

```text
3 + 4 + 3 + 2 = 12
```

Expected:

```text
EXPERT
```

This shows why tool count is not complexity.

---

# 27. Example: clarification instead of EXPERT

User:

```text
Message Daniyar.
```

Search returns:

```text
Daniyar A.
Daniyar K.
Daniyar Work
```

Expected:

```text
ask user to choose
```

Not:

```text
EXPERT
```

Do not spend model cost guessing an identity.

---

# 28. Example: planner stuck

Flow:

```text
search chats
→ no useful result

search contacts
→ no useful result

search chats with same query
→ same result

search contacts with same query
→ same result
```

Set:

```text
repeatedToolPattern = true
```

Expected:

```text
EXPERT
```

because cheap planning is not making progress.

---

# 29. AgentRuntime integration

Pseudo-flow:

```ts
let tier: ModelTier = "fast";

const monitor =
  new ReasoningComplexityMonitor();

for (
  let step = 0;
  step < MAX_AGENT_STEPS;
  step += 1
) {
  const response =
    await llmGateway.step({
      modelTier: tier,
      messages,
      tools,
      routingContext:
        monitor.snapshot(),
      signal,
    });

  monitor.recordModelResponse(
    response,
  );

  if (response.type === "final") {
    return response;
  }

  for (
    const toolCall
    of response.toolCalls
  ) {
    monitor.recordToolCall(
      toolCall,
    );

    const result =
      await executeTool(
        toolCall,
      );

    monitor.recordToolResult(
      toolCall,
      result,
    );

    appendToolResult(
      result,
    );
  }

  const decision =
    monitor.chooseTier(tier);

  tier = decision.tier;
}
```

---

# 30. Preserve conversation during escalation

When moving:

```text
FAST → NORMAL
```

or:

```text
NORMAL → EXPERT
```

send the same full tool-aware history.

Never resend only the original user request.

That would cause:

```text
duplicate searches
duplicate sends
duplicate event creation
lost reasoning state
```

---

# 31. Prevent replayed side effects

Each executed tool call needs:

```ts
interface ToolExecutionRecord {
  toolCallId: string;
  toolName: string;
  argsHash: string;

  status:
    | "pending"
    | "approval_required"
    | "executed"
    | "failed"
    | "cancelled";
}
```

Before any re-issued side-effect call:

```text
check whether equivalent action already executed
```

Keep MCP approval consumption and idempotency protections.

Tier escalation must never itself replay an action.

---

# 32. Backend routing context

Send rich but privacy-safe metadata:

```ts
export interface LlmRoutingContext {
  requestedTier:
    ModelTier;

  reasoningScore:
    number;

  hardReasoningSignals:
    string[];

  weakSignals: {
    stepCount: number;
    toolCalls: number;
    connectorCount: number;
  };

  struggle: {
    failedPlans: number;
    replans: number;
    repeatedToolPattern: boolean;
    invalidToolCalls: number;
    repeatedToolFailures: number;
  };

  context: {
    largeStructuredContext: boolean;
    largeUnstructuredContext: boolean;
  };

  escalationCount: number;
}
```

Do not include private message bodies in routing metadata.

---

# 33. Backend can enforce expert budget

Frontend requests a tier.

Backend has final authority.

Possible policy:

```text
expert disabled
expert daily budget exhausted
provider unavailable
user plan does not allow expert
```

Backend may return:

```text
effective_tier = normal
```

The mobile agent must continue gracefully.

---

# 34. Telemetry

Track:

```ts
export interface RoutingTelemetry {
  runId: string;

  initialTier: ModelTier;
  finalTier: ModelTier;

  fastCalls: number;
  normalCalls: number;
  expertCalls: number;

  expertTriggered: boolean;
  expertTriggerReason?: string;

  finalReasoningScore: number;

  hardReasoningSignals: string[];

  totalToolCalls: number;
  totalSteps: number;

  failedPlans: number;
  replans: number;

  completedSuccessfully: boolean;

  durationMs: number;
}
```

Do not log private source content.

---

# 35. Routing quality metrics

Measure:

```text
expert_call_rate
expert_success_rate
expert_rescue_rate

fast_success_rate
normal_success_rate

average_cost_per_successful_run
average_latency_per_successful_run
```

Most important expert metric:

```text
expert_rescue_rate
```

Meaning:

```text
how often did EXPERT convert
a stuck/failed cheaper-model run
into a successful result?
```

If expert calls are frequent but rescue rate is low, routing is too aggressive.

---

# 36. Evals

Create cases that explicitly test:

```text
many tools but easy
few tools but hard
cross-source but sequential
cross-source synthesis
constraint solving
conflicting evidence
clarification-required
planner loop
failed replan
large structured context
large unstructured context
```

Example:

```json
{
  "id":
    "many-tools-simple-broadcast",

  "expected_max_tier":
    "fast"
}
```

```json
{
  "id":
    "calendar-constraint-optimization",

  "expected_max_tier":
    "expert"
}
```

---

# 37. Tests

Required:

```text
[ ] 6 simple tool calls do not force NORMAL/EXPERT.
[ ] 3 connectors alone do not force EXPERT.
[ ] large context alone does not force EXPERT.
[ ] cross-source synthesis increases score.
[ ] conflicting evidence is a strong signal.
[ ] constraint solving is a strong signal.
[ ] one replan can move FAST → NORMAL.
[ ] two failed plans can trigger EXPERT.
[ ] loop detection can trigger EXPERT.
[ ] clarification-required ambiguity does not trigger EXPERT.
[ ] EXPERT never downgrades within the same run.
[ ] escalation preserves conversation.
[ ] escalation does not repeat side effects.
```

---

# 38. Definition of done

```text
[ ] Three tiers exist: fast / normal / expert.
[ ] Frontend has no Terra model ID.
[ ] Tool count is only a weak signal.
[ ] Connector count is only a weak signal.
[ ] Hard reasoning signals are represented explicitly.
[ ] EXPERT requires a hard signal + high score, except emergency stuck cases.
[ ] FAST → NORMAL is commoner than FAST → EXPERT.
[ ] Planner-loop detection exists.
[ ] Failed-plan/replan counters exist.
[ ] Clarification is preferred over expert guessing.
[ ] Large context alone cannot trigger EXPERT.
[ ] Tier escalation preserves the same run history.
[ ] Side effects cannot replay because of escalation.
[ ] Routing telemetry is privacy-safe.
[ ] Evals cover easy-long vs hard-short tasks.
```

---

# 39. Final rule

Use this mental model:

```text
Task is long?
→ maybe NORMAL

Task is difficult?
→ maybe EXPERT

Cheap model is demonstrably stuck?
→ EXPERT

Task has many tools but obvious deterministic steps?
→ stay FAST/NORMAL

Task has conflicts, constraints, optimization,
cross-source synthesis, or repeated replanning?
→ consider EXPERT
```

The expensive model should be paid for **reasoning difficulty**, not for the number of MCP calls.
