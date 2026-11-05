# RIG

A technology-agnostic modernization harness. The design is in [docs/PROPOSAL.md](docs/PROPOSAL.md) (v0.3).

**Status: M0 · Skeleton.** CLI, workspace layout (§10), work-unit state machine (§5.2), agent adapter, budgets, and event log. No Packs, oracles or verdicts yet.

TypeScript on Node 24+, run from source (Node strips types natively). The only runtime dependency is `yaml`.

```sh
npm install
npm test            # unit, engine, and kill-and-resume tests
npm run typecheck

./bin/rig.js init /tmp/prog --example noop
./bin/rig.js run -C /tmp/prog          # kill it at any point; run again to resume
./bin/rig.js status -C /tmp/prog
./bin/rig.js events -C /tmp/prog --wu WU-N-0002
```

## How M0 works

- **The event log is the only state.** `.rig/events.jsonl` is append-only and fsynced per event. Each stage ends with a single `stage_completed` line that names the next state, so a transition is atomic. `rig run` replays the log and continues. A kill loses at most the stage in flight, which is logged as `stage_interrupted` and runs again. A torn last line is truncated and logged as `log_repaired`.
- **State machine** (`src/states.ts`): `queued → context_build → recipes → implement → self_check → review_a → review_b → review_c → fix → judge → merged | provisional | retry | escalated`. A judge `retry` or a failed self-check starts a new attempt.
- **Budgets** (`src/budget.ts`): per unit `tokens`, `wallclock`, `attempts`, checked before each stage. Exceeding one escalates the unit. A programme token budget in `PROGRAMME.yaml` halts the run (exit 3) without escalating anyone. Tokens are tracked by role.
- **Agent adapter** (`src/agents.ts`): `noop` and `scripted` (forces outcomes per `WU:stage:attempt`, for tests). Adapters must be idempotent per (unit, stage, attempt).
- **Dependencies**: `depends_on` in a work unit. `merged` or `provisional` satisfies a dependency. Units downstream of an escalation are reported as blocked.
- **Contracts** are hashed when registered. A unit's YAML may change while it is queued, but not after it starts.
- **Lock**: one runner per workspace. A lock left by a dead pid is taken over.

Exit codes: 0 all done, 1 escalated or blocked units, 2 usage or workspace error, 3 halted by the programme budget.
