import assert from 'node:assert/strict';
import {
  isBadPostureMetric,
  resolveDisplayLabel,
  resolveMetricLabel,
} from './postureDisplay';

assert.equal(resolveDisplayLabel('TLF', ['slouch']), 'TLF');
assert.equal(resolveDisplayLabel('TLF', []), 'TUP');
assert.equal(resolveDisplayLabel('TLB', ['backward']), 'TLB');
assert.equal(resolveDisplayLabel('TLR', ['torso']), 'TLR');
assert.equal(resolveDisplayLabel('TUP', ['slouch']), 'TUP');

assert.equal(resolveMetricLabel({ finalLabel: 'TLL', postureStatus: 'good' }), 'TLL');
assert.equal(resolveMetricLabel({ isSlouched: true, postureStatus: 'warning' }), 'TLF');
assert.equal(resolveMetricLabel({ isBackwardLeaning: true, postureStatus: 'warning' }), 'TLB');
assert.equal(resolveMetricLabel({ isHighLowShoulder: true, postureStatus: 'warning' }), 'TLR');
assert.equal(resolveMetricLabel({ postureStatus: 'good' }), 'TUP');

assert.equal(isBadPostureMetric({ finalLabel: 'TUP', postureStatus: 'warning' }), false);
assert.equal(isBadPostureMetric({ postureStatus: 'warning' }), true);
assert.equal(isBadPostureMetric({ postureStatus: 'good', isSlouched: true }), true);

