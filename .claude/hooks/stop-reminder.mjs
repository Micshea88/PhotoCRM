#!/usr/bin/env node
// Stop hook: gentle nudge to verify before declaring work complete.
console.error("[stop] Run `pnpm verify --tier=2` before declaring work complete.")
process.exit(0)
