import assert from 'node:assert/strict';
import { diagLog, diagError, exportDiagnosticsJson, _diagBufferSize } from '../diagnostics.js';

// Ring buffer records and caps
{
  const before = _diagBufferSize();
  diagLog('test', 'hello', { n: 1 });
  assert.equal(_diagBufferSize(), before + 1);
  for (let i = 0; i < 500; i++) diagLog('flood', `entry ${i}`);
  assert.ok(_diagBufferSize() <= 200, 'Ring buffer caps at 200 entries');
}

// Long strings are truncated
{
  const long = 'x'.repeat(1000);
  const json = exportDiagnosticsJson('test-build');
  diagLog('test', long);
  const exported = JSON.parse(exportDiagnosticsJson('test-build'));
  const last = exported.recent[exported.recent.length - 1];
  assert.ok(last.msg.length <= 300, 'Messages are truncated');
  assert.equal(exported.build, 'test-build');
  assert.ok(typeof json === 'string');
}

// Errors do not throw without localStorage/window (node environment)
{
  diagError('error', 'boom', 'stack here');
  const exported = JSON.parse(exportDiagnosticsJson('test-build'));
  assert.equal(exported.persistedErrors.length, 0, 'No localStorage in node: nothing persisted, no crash');
}

// Reentrancy-safe: logging inside a broken JSON payload cannot throw
{
  const evil = { a: null };
  evil.self = evil;
  assert.doesNotThrow(() => diagLog('test', 'circular', evil));
}

console.log('Diagnostics buffer, truncation, persistence guard and reentrancy tests passed.');
