import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDiagnostics } from '../../Web/diagnostics.js';

test('the diagnostics readout aligns values and leaves out empty rows', () => {
  assert.equal(formatDiagnostics({ view: 'aerial', camera: '382.3 m', readings: undefined, flag: '', ground: null }),
    'view    aerial\ncamera  382.3 m');
});
