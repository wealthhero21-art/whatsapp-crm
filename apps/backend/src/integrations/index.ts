// Registers all built-in adapters. Add a new connector by importing it and
// calling registerAdapter(). Examples live under src/integrations/<slug>/.

import { registerAdapter } from './registry.js';

export function loadAdapters() {
  // No adapters bundled yet — the user will share the list of self-hosted
  // apps to integrate, and each gets its own directory here.
  //
  // Example (uncomment when adding "my-loan-app"):
  //   import myLoanApp from './my-loan-app/index.js';
  //   registerAdapter(myLoanApp);

  // Silence unused-import in dev builds — keep the function exported so
  // server.ts can call it whether or not adapters are registered.
  void registerAdapter;
}
