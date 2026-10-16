import { installNetworkGuard, type NetworkGuard } from './network-guard';

let networkGuard: NetworkGuard | undefined;

beforeEach(() => {
  networkGuard = installNetworkGuard(globalThis);
});

afterEach(() => {
  try {
    // Also fails when application code catches the transport's exception.
    networkGuard?.assertNoAttempts();
  } finally {
    networkGuard?.restore();
    networkGuard = undefined;
  }
});
