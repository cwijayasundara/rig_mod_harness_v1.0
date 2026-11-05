#!/usr/bin/env node
// Node 24+ strips TypeScript types natively, so the CLI runs from source.
import { main } from '../src/cli.ts'

process.exitCode = await main(process.argv.slice(2))
