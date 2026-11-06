---
description: Ask whether an entry point may move to its next cutover stage (shadow, canary, primary, decommission), by script, and show what blocks it
argument-hint: <system> <gate-unit> <stage>
arguments: system gate_unit stage
---

Load the `rig-method` skill first. Every entry point ends with an E step (`${CLAUDE_PLUGIN_ROOT}/docs/PROPOSAL.md` §2),
whether it routes to a service or to the monolith. The stages are shadow, canary, primary, decommission, in that order.

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_proof.ts cutover --ws . --system $system --gate-unit $gate_unit --stage $stage \
  --key <current V10 key> --requirements evidence/$system/requirements/<gate-unit>-V10.json
```

Quote its answer word for word. What each stage needs (the script checks all of it):

- **shadow**: a person's go.
- **canary**: the go; shadow runs under the current key with no mismatch; every obligation on the entry point's
  observables **discharged**, not just accepted, because canary traffic is real.
- **primary**: all of canary, and the V10 verdict PROVEN or PROVISIONAL with accepted obligations, which includes the
  calendar minimum window and the V9 timing limit.
- **decommission**: all of primary, and real (canary or primary) traffic under the key.

A go is recorded only by `/rig:review $system cutover`, which writes `cutover/$system/<gate-unit>.json`; the guard denies
subagents. Routing the traffic itself (a load balancer, a scheduler switch) is outside the plugin: write the change a
person must make in `CUTOVER.md`, never make it. End with the script's answer and the next command.
