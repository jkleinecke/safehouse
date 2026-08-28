import { describe, expect, it } from 'vitest';
import { VisibilitySchema, WsCommandSchema } from '@safehouse/contracts';

// Skeleton smoke test: the server package resolves its workspace contracts.
// The server-core agent replaces behavioral coverage.
describe('@safehouse/server skeleton', () => {
  it('resolves @safehouse/contracts', () => {
    expect(VisibilitySchema.parse('gm')).toBe('gm');
    expect(WsCommandSchema.parse({ cmd: 'ping', x: 1, y: 2 }).cmd).toBe('ping');
  });
});
