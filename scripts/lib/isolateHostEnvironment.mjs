import { isolateProcessEnvironment } from './isolatedProcessEnvironment.mjs'

// Import once at an isolated runner's entry, before capturing env or starting any children.
// Fixtures may subsequently establish their own connection, profile and terminal identity.
isolateProcessEnvironment()

// Playwright forces color in workers. Node's conflicting-color warning otherwise prefixes
// CLI stderr and breaks its JSON error contract (also used by Worker CLI contracts).
delete process.env.NO_COLOR
