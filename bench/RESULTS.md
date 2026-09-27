# Benchmark results — 2026-09-27T01-29-10-311Z

Completed measurements: 860. Proxy model calls in this run: 920. Fixed tasks: 20. Flight is a React Server Components payload rendered from the same element tree used for markup. The result file is **2026-09-27T01-29-10-311Z.json**.

## Summary by model

Metrics average model-reported API token counts and latency. First-try validity is accepted actions divided by proposed actions. Task pass rate is the final-store checker rate.

### gemma (@cf/google/gemma-4-26b-a4b-it)

| Input / output | Mean input tokens | Mean output tokens | P50 latency (ms) | First-try valid | Task pass | Request errors |
|---|---:|---:|---:|---:|---:|---:|
| markup/json | 911.5 | 47.8 | 749.0 | 96.0% | 100.0% | 0 |
| json/json | 537.5 | 48.2 | 672.9 | 100.0% | 100.0% | 0 |
| flight/json | 4514.4 | 47.7 | 817.2 | 100.0% | 95.0% | 0 |
| wire/json | 476.7 | 49.0 | 801.8 | 100.0% | 100.0% | 0 |
| wire/wire | 506.7 | 30.6 | 661.5 | 88.0% | 90.0% | 0 |

### qwen (@cf/qwen/qwen3-30b-a3b-fp8)

| Input / output | Mean input tokens | Mean output tokens | P50 latency (ms) | First-try valid | Task pass | Request errors |
|---|---:|---:|---:|---:|---:|---:|
| markup/json | 859.5 | 44.9 | 501.8 | 76.9% | 85.0% | 0 |
| json/json | 508.5 | 45.1 | 559.8 | 96.2% | 100.0% | 0 |
| flight/json | 2239.1 | 42.9 | 585.4 | 96.0% | 95.0% | 1 |
| wire/json | 447.2 | 44.4 | 518.9 | 96.0% | 100.0% | 0 |
| wire/wire | 482.2 | 26.9 | 450.1 | 25.7% | 50.0% | 0 |

### gemma-repeat (@cf/google/gemma-4-26b-a4b-it)

| Input / output | Mean input tokens | Mean output tokens | P50 latency (ms) | First-try valid | Task pass | Request errors |
|---|---:|---:|---:|---:|---:|---:|
| markup/json | 911.5 | 48.1 | 772.1 | 96.0% | 100.0% | 0 |
| json/json | 537.1 | 48.9 | 738.5 | 100.0% | 100.0% | 0 |
| flight/json | 4514.8 | 46.1 | 751.9 | 96.0% | 100.0% | 0 |
| wire/json | 476.6 | 49.0 | 740.8 | 100.0% | 100.0% | 0 |
| wire/wire | 506.8 | 30.3 | 663.9 | 92.0% | 95.0% | 0 |

### opus-5.5 (claude-opus-5-5)

| Input / output | Mean input tokens | Mean output tokens | P50 latency (ms) | First-try valid | Task pass | Request errors |
|---|---:|---:|---:|---:|---:|---:|
| json/json | 690.1 | 114.6 | 1766.5 | 100.0% | 100.0% | 0 |
| wire/json | 576.6 | 113.1 | 1716.9 | 100.0% | 100.0% | 0 |
| wire/wire | 603.6 | 95.0 | 2201.9 | 100.0% | 100.0% | 0 |

### glm-4.7-flash (@cf/zai-org/glm-4.7-flash)

| Input / output | Mean input tokens | Mean output tokens | P50 latency (ms) | First-try valid | Task pass | Request errors |
|---|---:|---:|---:|---:|---:|---:|
| markup/json | 793.3 | 50.5 | 936.9 | 80.8% | 85.0% | 0 |
| json/json | 466.6 | 43.9 | 846.9 | 96.0% | 100.0% | 0 |
| flight/json | 3860.9 | 41.0 | 1033.8 | 84.6% | 85.0% | 0 |
| wire/json | 407.8 | 58.4 | 979.7 | 96.0% | 100.0% | 0 |
| wire/wire | 442.8 | 31.9 | 843.5 | 36.0% | 40.0% | 0 |

## Input size for the 60-card state

API input tokens for task `sixty-card`, JSON output only. Counts are model-tokenizer-specific. A context overflow is reported as a failed-by-size result.

| Input format | gemma | qwen | gemma-repeat | opus-5.5 | glm-4.7-flash |
|---|---:|---:|---:|---:|---:|
| markup | 5064 | 4789 | 5064 | n/a | 4323 |
| json | 2482 | 2398 | 2483 | 3261 | 2067 |
| flight | 44180 | does not fit: 32,769 tokens > 32,768 | 44185 | n/a | 37217 |
| wire | 1426 | 1397 | 1426 | 1588 | 1115 |

## Token-normalized result

Checker-passing tasks per 1,000 combined input and output tokens, by model and input/output combination.

| Model | Input / output | Passes / 1k tokens |
|---|---|---:|
| gemma | markup/json | 1.042 |
| gemma | json/json | 1.707 |
| gemma | flight/json | 0.208 |
| gemma | wire/json | 1.902 |
| gemma | wire/wire | 1.675 |
| qwen | markup/json | 0.940 |
| qwen | json/json | 1.806 |
| qwen | flight/json | 0.438 |
| qwen | wire/json | 2.034 |
| qwen | wire/wire | 0.982 |
| gemma-repeat | markup/json | 1.042 |
| gemma-repeat | json/json | 1.706 |
| gemma-repeat | flight/json | 0.219 |
| gemma-repeat | wire/json | 1.903 |
| gemma-repeat | wire/wire | 1.769 |
| opus-5.5 | json/json | 1.243 |
| opus-5.5 | wire/json | 1.450 |
| opus-5.5 | wire/wire | 1.431 |
| glm-4.7-flash | markup/json | 1.007 |
| glm-4.7-flash | json/json | 1.959 |
| glm-4.7-flash | flight/json | 0.218 |
| glm-4.7-flash | wire/json | 2.145 |
| glm-4.7-flash | wire/wire | 0.843 |

Highest observed rate: **glm-4.7-flash wire/json** (2.145 passes/1k tokens).

## Five notable failures

### qwen · wire/wire · funnel

Checker: fail; rejection: invalid or existing handle card

~~~text
+card q3-revenue "Visit" x=200 y=200
+card q3-revenue-1 "Signup" x=500 y=200
+card q3-revenue-2 "Purchase" x=800 y=200
=link q3-revenue q3-revenue-1 "Arrow"
=link q3-revenue-1 q3-revenue-2 "Arrow"
~~~

### qwen · wire/wire · column

Checker: fail; rejection: unknown operation I'll

~~~text
I'll arrange the three steps in a column, one below the other.

+ c1 card "Discover" x=10 y=20
+ c2 card "Evaluate" x=10 y=150
+ c3 card "Buy" x=10 y=280
~~~

### qwen · wire/wire · risky

Checker: fail; rejection: invalid or existing handle c1

~~~text
say: Which steps do you consider risky?
+ c1 tone=warn
+ c2 tone=warn
+ c3 tone=warn
~~~

### qwen · markup/json · column

Checker: fail; rejection: no card "q3-revenue"

~~~text
{"say":"Repositioning the cards in a column.","actions":[{"type":"card.move","payload":{"id":"q3-revenue","x":10,"y":20}},{"type":"card.move","payload":{"id":"q3-revenue","x":10,"y":100}},{"type":"card.move","payload":{"id":"q3-revenue","x":10,"y":180}}]}
~~~

### glm-4.7-flash · markup/json · column

Checker: fail; rejection: no card "Discover"

~~~text
{"say":"I'll arrange the cards vertically in a column.","actions":[{"type":"card.move","payload":{"id":"Discover","x":10,"y":20}},{"type":"card.move","payload":{"id":"Evaluate","x":10,"y":240}},{"type":"card.move","payload":{"id":"Buy","x":10,"y":460}}]}
~~~


## Method

### Tasks

- funnel: Create a three-step funnel for Visit, Signup, and Purchase, with arrows between consecutive steps.
- title: Rename the Checkout card to Payment.
- risky: Mark the risky steps warn.
- column: Put the three steps in a column, one below another.
- link-meaning: Connect the Signup step to the Welcome email step and label the arrow "starts onboarding".
- remove-meaning: Remove the obsolete Deprecated API card.
- follow-up: Move that same report card to the right side of the board.
- sixty-card: Change the title of the card named Checkpoint 42 to Verified checkpoint 42.
- noop-checkout: Is there a checkout card?
- create-note: Add a card titled Launch checklist with body "Confirm owner and date".
- update-body: Add the body "Review with legal" to the Privacy review card.
- good-tone: Mark the completed Migration step as good.
- move-specific: Move the Alert card to x=700 and y=240.
- link-existing-nodes: Add an arrow from Intake to Triage.
- remove-link: Remove the arrow from Draft to Published.
- rename-risk: Change "Risk review" to "Security review" and keep its warning tone.
- noop-noon: Thanks, that is helpful.
- recover-unknown-card: Now update the actual card title to Payment.
- recover-duplicate-link: The link already exists; do not add it again. Set its label to "verified" if possible.
- recover-invalid-tone: Use the supported warn tone for the Risk gate.

### Models, temperature, and token counts

- gemma: @cf/google/gemma-4-26b-a4b-it; temperature 0; Workers AI response usage fields (model tokenizer)
- qwen: @cf/qwen/qwen3-30b-a3b-fp8; temperature 0; Workers AI response usage fields (model tokenizer)
- gemma-repeat: @cf/google/gemma-4-26b-a4b-it; temperature 0; Workers AI response usage fields (model tokenizer)
- opus-5.5: claude-opus-5-5; temperature provider default (omitted); Anthropic Messages input_tokens / output_tokens (Anthropic tokenizer)
- glm-4.7-flash: @cf/zai-org/glm-4.7-flash; temperature 0; Workers AI response usage fields (model tokenizer)

### Rerun

Run `npm run bench` for the full 460-call comparison. The runner creates a timestamped JSON file, checkpoints every 20 calls, and marks it complete only after all calls finish. An approved Opus-only retry uses `node --experimental-strip-types bench/run.mjs --opus-only`; it replaces the 60 Opus rows in the newest complete Workers AI result and records the underlying proxy call total. The report selects the newest complete combined file.

## Measurement limits

The repeated Gemma pass measures same-model variance. Qwen’s 60-card Flight input exceeds its 32,768-token context window after the requested output budget; it is retained as a failed-by-size measurement. Opus token counts come from the Anthropic Messages usage object. Validity is counted from the real canvas store dispatch result on the first proposal. Recovery tasks include prior-turn rejection reasons in the prompt. Wire input translates session handles back to canvas IDs before dispatch.
