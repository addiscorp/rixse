# Benchmark results — 2026-09-27T01-26-01-090Z

Completed measurements: 760. Proxy model calls in this run: 820. Fixed tasks: 20. Flight is a React Server Components payload rendered from the same element tree used for markup. The result file is **2026-09-27T01-26-01-090Z.json**.

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

### gpt-oss (@cf/openai/gpt-oss-120b)

| Input / output | Mean input tokens | Mean output tokens | P50 latency (ms) | First-try valid | Task pass | Request errors |
|---|---:|---:|---:|---:|---:|---:|
| markup/json | 871.4 | 175.8 | 2720.2 | 100.0% | 95.0% | 0 |
| json/json | 533.5 | 108.1 | 1588.7 | 100.0% | 95.0% | 0 |
| flight/json | 3985.9 | 233.7 | 3629.0 | 100.0% | 90.0% | 0 |
| wire/json | 472.1 | 107.0 | 1905.8 | 100.0% | 95.0% | 0 |
| wire/wire | 506.1 | 135.9 | 2185.2 | 72.0% | 85.0% | 0 |

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

### granite (@cf/ibm-granite/granite-4.0-h-micro)

| Input / output | Mean input tokens | Mean output tokens | P50 latency (ms) | First-try valid | Task pass | Request errors |
|---|---:|---:|---:|---:|---:|---:|
| markup/json | 798.6 | 42.4 | 1400.0 | 50.0% | 50.0% | 0 |
| json/json | 472.1 | 44.5 | 1438.2 | 94.7% | 85.0% | 0 |
| flight/json | 3857.8 | 44.7 | 1608.6 | 29.4% | 25.0% | 0 |
| wire/json | 413.2 | 45.3 | 1381.4 | 93.3% | 75.0% | 0 |
| wire/wire | 448.2 | 30.4 | 891.6 | 7.3% | 10.0% | 0 |

### gpt-oss-20b (@cf/openai/gpt-oss-20b)

| Input / output | Mean input tokens | Mean output tokens | P50 latency (ms) | First-try valid | Task pass | Request errors |
|---|---:|---:|---:|---:|---:|---:|
| markup/json | 873.3 | 128.6 | 1024.5 | 100.0% | 100.0% | 0 |
| json/json | 535.4 | 112.1 | 876.1 | 100.0% | 95.0% | 0 |
| flight/json | 3987.8 | 147.8 | 1125.7 | 100.0% | 100.0% | 0 |
| wire/json | 473.9 | 141.1 | 1076.0 | 100.0% | 100.0% | 0 |
| wire/wire | 507.9 | 209.4 | 1495.0 | 66.7% | 80.0% | 0 |

### gpt-oss-20b-low (@cf/openai/gpt-oss-20b)

| Input / output | Mean input tokens | Mean output tokens | P50 latency (ms) | First-try valid | Task pass | Request errors |
|---|---:|---:|---:|---:|---:|---:|
| markup/json | 873.3 | 62.6 | 586.6 | 100.0% | 100.0% | 0 |
| json/json | 535.4 | 58.3 | 558.9 | 100.0% | 100.0% | 0 |
| flight/json | 3988.0 | 70.2 | 757.9 | 100.0% | 95.0% | 0 |
| wire/json | 473.9 | 62.3 | 574.7 | 100.0% | 95.0% | 0 |
| wire/wire | 507.9 | 59.3 | 614.2 | 52.0% | 65.0% | 0 |

## Input size for the 60-card state

API input tokens for task `sixty-card`, JSON output only. Counts are model-tokenizer-specific. A context overflow is reported as a failed-by-size result.

| Input format | gemma | qwen | gpt-oss | gemma-repeat | opus-5.5 | granite | gpt-oss-20b | gpt-oss-20b-low |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| markup | 5064 | 4789 | 4532 | 5064 | n/a | 4292 | 4534 | 4534 |
| json | 2482 | 2398 | 2153 | 2483 | 3261 | 2036 | 2155 | 2155 |
| flight | 44180 | does not fit: 32,769 tokens > 32,768 | 37790 | 44185 | n/a | 37102 | 37793 | 37799 |
| wire | 1426 | 1397 | 1143 | 1426 | 1588 | 1084 | 1145 | 1145 |

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
| gpt-oss | markup/json | 0.907 |
| gpt-oss | json/json | 1.481 |
| gpt-oss | flight/json | 0.213 |
| gpt-oss | wire/json | 1.640 |
| gpt-oss | wire/wire | 1.324 |
| gemma-repeat | markup/json | 1.042 |
| gemma-repeat | json/json | 1.706 |
| gemma-repeat | flight/json | 0.219 |
| gemma-repeat | wire/json | 1.903 |
| gemma-repeat | wire/wire | 1.769 |
| opus-5.5 | json/json | 1.243 |
| opus-5.5 | wire/json | 1.450 |
| opus-5.5 | wire/wire | 1.431 |
| granite | markup/json | 0.594 |
| granite | json/json | 1.646 |
| granite | flight/json | 0.064 |
| granite | wire/json | 1.636 |
| granite | wire/wire | 0.209 |
| gpt-oss-20b | markup/json | 0.998 |
| gpt-oss-20b | json/json | 1.467 |
| gpt-oss-20b | flight/json | 0.242 |
| gpt-oss-20b | wire/json | 1.626 |
| gpt-oss-20b | wire/wire | 1.115 |
| gpt-oss-20b-low | markup/json | 1.068 |
| gpt-oss-20b-low | json/json | 1.684 |
| gpt-oss-20b-low | flight/json | 0.234 |
| gpt-oss-20b-low | wire/json | 1.772 |
| gpt-oss-20b-low | wire/wire | 1.146 |

Highest observed rate: **qwen wire/json** (2.034 passes/1k tokens).

## Five notable failures

### granite · wire/wire · funnel

Checker: fail; rejection: unknown operation canvas.clear

~~~text
canvas.clear
card.add { id: "c1", title: "Visit", body: "User visits the website", x: 100, y: 200, tone: "plain" }
link.add { from: "c1", to: "c2", label: "Visit" }
card.add { id: "c2", title: "Signup", body: "User creates an account", x: 500, y: 200, tone: "plain" }
link.add { from: "c2", to: "c3", label: "Signup" }
card.add { id: "c3", title: "Purchase", body: "User completes a purchase", x: 900, y: 200, tone: "plain" }
link.add { from: "c3", to: "c1", label: "Purchase" }
~~~

### qwen · wire/wire · funnel

Checker: fail; rejection: invalid or existing handle card

~~~text
+card q3-revenue "Visit" x=200 y=200
+card q3-revenue-1 "Signup" x=500 y=200
+card q3-revenue-2 "Purchase" x=800 y=200
=link q3-revenue q3-revenue-1 "Arrow"
=link q3-revenue-1 q3-revenue-2 "Arrow"
~~~

### gpt-oss · wire/wire · funnel

Checker: fail; rejection: card.add requires the card keyword

~~~text
say: Here is a simple three‑step funnel.

+ c1 "Visit"
+ c2 "Signup"
+ c3 "Purchase"
= c1 c2
= c2 c3
~~~

### gpt-oss-20b · wire/wire · funnel

Checker: fail; rejection: card.add requires the card keyword

~~~text
say: Creating a three-step funnel with Visit → Signup → Purchase

+ c1 "Visit" plain
+ c2 "Signup" plain
+ c3 "Purchase" plain
= c1 c2 "next"
= c2 c3 "next"
~~~

### gpt-oss-20b-low · wire/wire · funnel

Checker: fail; rejection: card.add requires the card keyword

~~~text
say: Creating a three-step funnel with Visit → Signup → Purchase.  
+ c1 "Visit" plain 200,200 "User visits the site"  
+ c2 "Signup" accent 600,200 "User signs up for an account"  
+ c3 "Purchase" good 1000,200 "User completes a purchase"  
= c1 c2 "Next"  
= c2 c3 "Next"
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
- gpt-oss: @cf/openai/gpt-oss-120b; temperature 0; Workers AI response usage fields (model tokenizer)
- gemma-repeat: @cf/google/gemma-4-26b-a4b-it; temperature 0; Workers AI response usage fields (model tokenizer)
- opus-5.5: claude-opus-5-5; temperature provider default (omitted); Anthropic Messages input_tokens / output_tokens (Anthropic tokenizer)
- granite: @cf/ibm-granite/granite-4.0-h-micro; temperature 0; Workers AI response usage fields (model tokenizer)
- gpt-oss-20b: @cf/openai/gpt-oss-20b; temperature 0; Workers AI response usage fields (model tokenizer)
- gpt-oss-20b-low: @cf/openai/gpt-oss-20b; temperature 0; Workers AI response usage fields (model tokenizer)

### Rerun

Run `npm run bench` for the full 460-call comparison. The runner creates a timestamped JSON file, checkpoints every 20 calls, and marks it complete only after all calls finish. An approved Opus-only retry uses `node --experimental-strip-types bench/run.mjs --opus-only`; it replaces the 60 Opus rows in the newest complete Workers AI result and records the underlying proxy call total. The report selects the newest complete combined file.

## Measurement limits

The repeated Gemma pass measures same-model variance. Qwen’s 60-card Flight input exceeds its 32,768-token context window after the requested output budget; it is retained as a failed-by-size measurement. Opus token counts come from the Anthropic Messages usage object. Validity is counted from the real canvas store dispatch result on the first proposal. Recovery tasks include prior-turn rejection reasons in the prompt. Wire input translates session handles back to canvas IDs before dispatch.
