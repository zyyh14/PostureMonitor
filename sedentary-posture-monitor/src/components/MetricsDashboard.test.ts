import assert from 'node:assert/strict';
import { buildRadarData, buildRadarPolygonPoints } from './MetricsDashboard';
import type { SessionSummary } from '../types';

const summary: SessionSummary = {
  totalMinutes: 100,
  goodPostureMinutes: 75,
  badPostureMinutes: 25,
  alertCount: 5,
  averageFocusScore: 88,
  neckAngleAvg: 10,
  shoulderDiffAvg: 2,
  distanceAvg: 60,
  healthySpineScore: 82,
};

assert.deepEqual(buildRadarData(summary), [
  { subject: '颈倾防护', A: 75, fullMark: 100 },
  { subject: '双肩对称水平', A: 84, fullMark: 100 },
  { subject: '睫状肌防红', A: 80, fullMark: 100 },
  { subject: '注视专注', A: 88, fullMark: 100 },
  { subject: '正姿持续', A: 75, fullMark: 100 },
]);

assert.equal(
  buildRadarPolygonPoints(
    [
      { subject: 'A', A: 100, fullMark: 100 },
      { subject: 'B', A: 50, fullMark: 100 },
      { subject: 'C', A: 0, fullMark: 100 },
      { subject: 'D', A: 50, fullMark: 100 },
    ],
    100,
    100,
    40
  ),
  '100.00,60.00 120.00,100.00 100.00,100.00 80.00,100.00'
);
