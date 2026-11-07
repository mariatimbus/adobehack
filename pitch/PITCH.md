# CreativeDNA — 3-Minute Pitch (STAR)

> Spoken script ≈ 430 words ≈ 2:50 at natural pace. Demo beats are LIVE clicks
> in the real add-on. Every number is either measured (labeled) or an explicit
> estimate (labeled) — judges respect honesty, and our telemetry is a feature.

---

## SITUATION (0:00–0:35) — Problem Solving 25%

Meet Maria. It's Monday, and on Thursday her brand must be live on Instagram,
Stories and LinkedIn — three formats, one campaign.

A marketer does this manually: she searches Pinterest and trend sources, saves
references, tries to understand what style is emerging, writes a creative brief,
opens Photoshop or Express, builds the visuals — and then marketing calls:
"the headline must be longer, the product shot can't change, the logo stays put,
and we need a promo strip on top." She rebuilds the design. Then she makes the
versions. This is slow, fragmented, and every change is a small redesign.

## TASK (0:35–0:55)

The real task behind every campaign adaptation is not "move some boxes". It is:
understand what the design is trying to communicate, find *different* ways to
satisfy new constraints, know **objectively** which one works — and apply it
**without flattening the design** into an image.

## ACTION (0:55–2:20) — AI Innovation 25% + Integrations 15% + Demo 10%

Our answer is **CreativeDNA — an AI adaptation agent living inside Adobe
Express**. Not another tool: the agent is in the product where designers
already work. Watch the recipe it automates:

**1. Import elements** *(0:55)* — I paste a Pinterest board. CreativeDNA pulls
every image — here, our own AlphaZ board — and, with one checkbox, removes
backgrounds using a **local open-source AI model** running on-device. Real AI,
no upload to the cloud.

**2. Load elements** *(1:05)* — the campaign loads as **native, editable
Express elements** — not a flattened picture. Eight independent nodes: texts,
shapes, the product photo.

**3. Brand guidelines** *(1:12)* — I upload our brand guidelines file. The
system extracts the palette, the locked elements, the forbidden claims — and
those become **hard rules** in every next step.

**4. Analyze versions** *(1:20)* — Now the unfamiliar constraint, in plain
language: *"Longer headline, product size unchanged, logo position preserved,
180 pixels reserved on top."* The interpreter turns this into typed
constraints — and generates **three genuinely different repair strategies**:
typography adaptation, group reflow, decoration pruning. Each one is simulated
on a copy and verified by a deterministic geometry engine — eleven rules:
margins, overlaps, locks, font floors, contrast, forbidden copy — each returning
**pass, fail, or unknown**, never a guess. Two strategies fail with exact
measured reasons. One passes all eleven.

**5. Iterations** *(1:45)* — I apply the winner. Existing nodes update **in
place** — no duplicates — and the system reads the real document back:
node count, plan match, editability, with everything it *cannot* verify openly
disclosed.

**6. New designs** *(1:55)* — same design, new format: Instagram Story. The
composition re-planned semantically, not scaled blindly.

Under the hood, for Technical Excellence: a FastAPI backend with frozen
Pydantic contracts, a document-sandbox bridge over Adobe's official SDK, a
rule-based intent graph that actually drives strategy generation — and a
benchmark that runs all of it against naive baselines.

## RESULT (2:20–3:00) — Technical 25% + Cost/Value 10%

We measured, on five real cases including two intentionally impossible ones:
AI strategies solved **3 of 3 feasible cases, with 0 false positives on the
impossible ones** — while a uniform-scale baseline and a responsive-template
baseline solved **zero**. The full interpret–simulate–verify cycle runs in
**about 50 milliseconds, measured end-to-end**.

The manual workflow we replaced takes tens of minutes across three tools —
our estimated speedup is **12x or better**, and we label that as an estimate.
Cost per repair with a live LLM: roughly **one fifth of a cent** — an estimate
too; in today's demo the AI layers run in clearly labeled fixture mode, at
zero cost.

So Maria doesn't guess which version will work — she sees verified variants,
picks one, and ships three formats before lunch. More posts, same team, same
brand discipline. That's CreativeDNA: **an AI that repairs designs, proves its
work, and never hides what it doesn't know.**

---

# Judge Q&A — honest answers that score

**"Is the AI real?"** Three layers: background removal is a real local neural
network (u2net) running on-device — that's live. Constraint interpretation and
strategy generation are architected for an LLM with structured outputs; in this
environment we run a deterministic interpreter clearly labeled `fixture` —
you can see the label in the panel. The geometry verification is fully live
and it is the part that must never hallucinate.

**"Where's the 12x from?"** The pipeline latency is measured end-to-end
(~50 ms for interpret+plan+validate; Adobe apply measured live in the panel).
The manual side is an estimate from the seven-step workflow — we present it as
an estimate, not a benchmark result.

**"What if the request is impossible?"** Demo it live: "reserve 900px at the
top". All three strategies fail with specific rules, and the system proposes a
*minimal relaxation* — shrinking the zone — instead of fabricating a win. That
honesty is why our false-feasible rate is 0 in the benchmark.

**"Integrations?"** Adobe Express Add-on SDK + Document Sandbox (native
editing), Pinterest public boards, generic web pages, local rembg model,
FastAPI backend. One honest limit: artboard resize is read-only in the current
Express SDK, so format adaptation is planned server-side and disclosed.

**"Cost vs value?"** Fixture mode: $0. Live LLM mode: ≈$0.002 per repair
(estimate, ~1k-token calls). Value: an estimated 12x faster adaptation cycle →
more campaign variants per marketer per week.

---

# Demo run-sheet (exact clicks — 60 seconds)

| Time | Click | Expected on screen |
|---|---|---|
| 0:55 | "Load AI Expo poster campaign" | AlphaZ poster builds natively on canvas |
| 1:12 | Scroll to "Bring your own" → guidelines sample file | palette + forbidden phrases extracted |
| 1:20 | "Enter modification request" → "Interpret & generate" | 3 candidate cards with pass/fail + J scores |
| 1:45 | "Apply selected repair in place" | verify report: 8→8 nodes, no duplicates |
| 1:55 | (backup) "Import from web" with the pin.it link | board images + bg-removal thumbnails |
| backup | constraint: "reserve a 900px top zone" | all fail + relaxation suggestion |

**Failure recovery:** if anything live misbehaves, say so and show the labeled
fixture mode + the benchmark CSV (`backend/benchmark_data/results.csv`) —
judges reward honest telemetry.
