import test from 'node:test';
import assert from 'node:assert/strict';
import { periodBounds } from '../server/reports.js';
import { today } from '../server/domain.js';
test('calendar boundaries handle leap months, Sunday/Monday weeks and timezone midnight',()=>{
 assert.deepEqual(periodBounds('monthly','2024-02-29'),{from:'2024-02-01',to:'2024-02-29'});
 assert.deepEqual(periodBounds('weekly','2026-11-01',1),{from:'2026-10-26',to:'2026-11-01'});
 assert.deepEqual(periodBounds('weekly','2026-11-01',0),{from:'2026-11-01',to:'2026-11-07'});
 assert.equal(today('Asia/Kolkata',Date.parse('2026-11-01T20:00:00Z')),'2026-11-02');
 assert.equal(today('UTC',Date.parse('2026-11-01T20:00:00Z')),'2026-11-01');
});
