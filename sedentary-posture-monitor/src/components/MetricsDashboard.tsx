/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 数据大屏看板
 * - 4 KPI: 监测时长 / 不良姿态率 / 平均专注度 / 脊柱健康分
 * - 实时遥测多线趋势图 (颈倾 / 高低肩 / 离屏距离)
 * - 五维体态雷达
 * - 时段热力图 (24h × 7day) — 直观看出哪个时段姿态最差
 * - 久坐番茄钟提醒条
 */

import React, { memo, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts';
import { PostureMetric, SessionSummary } from '../types';
import { Compass, Brain, ShieldAlert, Hourglass, Calendar } from 'lucide-react';
import SedentaryTimer from './SedentaryTimer';
import { isBadPostureMetric, labelToChinese, resolveMetricLabel, type PostureLabel } from '../lib/postureDisplay';

interface MetricsDashboardProps {
  logs: PostureMetric[];
  currentMetric: PostureMetric;
  isWebcamActive?: boolean;
}

type RadarDatum = {
  subject: string;
  A: number;
  fullMark: 100;
};

const RADAR_VIEWBOX = 240;
const RADAR_CENTER = RADAR_VIEWBOX / 2;
const RADAR_RADIUS = 76;
const RADAR_LEVELS = [0.25, 0.5, 0.75, 1];
const RADAR_LABEL_OFFSET = 22;

export function buildRadarData(summary: SessionSummary): RadarDatum[] {
  const neckScore = Math.max(10, Math.round(100 - (summary.neckAngleAvg * 2.5)));
  const shoulderScore = Math.max(10, Math.round(100 - (summary.shoulderDiffAvg * 8)));
  const eyeScore = Math.min(100, Math.max(10, Math.round((summary.distanceAvg / 75) * 100)));
  const focusScore = summary.averageFocusScore;
  const incidence = Math.max(10, Math.round(100 - ((summary.badPostureMinutes / (summary.totalMinutes || 1)) * 100)));
  return [
    { subject: '颈倾防护', A: neckScore, fullMark: 100 },
    { subject: '双肩对称水平', A: shoulderScore, fullMark: 100 },
    { subject: '睫状肌防红', A: eyeScore, fullMark: 100 },
    { subject: '注视专注', A: focusScore, fullMark: 100 },
    { subject: '正姿持续', A: incidence, fullMark: 100 },
  ];
}

function radarPoint(index: number, total: number, radius: number, cx = RADAR_CENTER, cy = RADAR_CENTER) {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / total;
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
  };
}

function formatPoint(point: { x: number; y: number }) {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

export function buildRadarPolygonPoints(
  radarData: RadarDatum[],
  cx = RADAR_CENTER,
  cy = RADAR_CENTER,
  radius = RADAR_RADIUS
) {
  return radarData
    .map((item, idx) => {
      const valueRadius = radius * Math.max(0, Math.min(100, item.A)) / item.fullMark;
      return formatPoint(radarPoint(idx, radarData.length, valueRadius, cx, cy));
    })
    .join(' ');
}

export default function MetricsDashboard({ logs, currentMetric, isWebcamActive }: MetricsDashboardProps) {

  // ============ 1. 聚合摘要 ============
  const summary: SessionSummary = useMemo(() => {
    const targetLogs = logs.length > 0 ? logs.slice(-120) : [];
    if (targetLogs.length === 0) {
      return {
        totalMinutes: 0, goodPostureMinutes: 0, badPostureMinutes: 0,
        alertCount: 0, averageFocusScore: 100,
        neckAngleAvg: 0, shoulderDiffAvg: 0, distanceAvg: 0,
        healthySpineScore: 100,
      };
    }
    const total = targetLogs.length;
    let good = 0, bad = 0, alert = 0;
    let neckSum = 0, shoulderSum = 0, distSum = 0, focusSum = 0;
    targetLogs.forEach(l => {
      neckSum += l.neckAngle; shoulderSum += l.shoulderDiff;
      distSum += l.screenDistance; focusSum += l.gazeFocus;
      if (isBadPostureMetric(l)) { bad++; alert++; }
      else good++;
    });
    const slouchedRatio = targetLogs.filter(l => l.isSlouched).length / total;
    const highLowRatio = targetLogs.filter(l => l.isHighLowShoulder).length / total;
    const tooCloseRatio = targetLogs.filter(l => l.isTooClose).length / total;
    const penalty = (slouchedRatio * 50) + (highLowRatio * 25) + (tooCloseRatio * 25);

    return {
      totalMinutes: total * 5,
      goodPostureMinutes: good * 5,
      badPostureMinutes: bad * 5,
      alertCount: alert,
      averageFocusScore: Math.round(focusSum / total),
      neckAngleAvg: parseFloat((neckSum / total).toFixed(1)),
      shoulderDiffAvg: parseFloat((shoulderSum / total).toFixed(1)),
      distanceAvg: Math.round(distSum / total),
      healthySpineScore: Math.max(10, Math.round(100 - penalty)),
    };
  }, [logs]);

  const postureClassData = useMemo(() => {
    const labels: PostureLabel[] = ['TUP', 'TLF', 'TLB', 'TLR', 'TLL'];
    const counts = labels.reduce((acc, label) => {
      acc[label] = 0;
      return acc;
    }, {} as Record<PostureLabel, number>);

    logs.slice(-120).forEach(log => {
      const label = resolveMetricLabel(log);
      if (label) counts[label]++;
    });

    const colors: Record<PostureLabel, string> = {
      TUP: '#10b981',
      TLF: '#38bdf8',
      TLB: '#818cf8',
      TLR: '#a855f7',
      TLL: '#fb7185',
    };

    return labels.map(label => ({
      label,
      name: labelToChinese(label),
      count: counts[label],
      fill: colors[label],
    }));
  }, [logs]);

  // ============ 2. 雷达数据 ============
  const radarData = useMemo(() => {
    return buildRadarData(summary);
  }, [summary]);

  // ============ 3. 趋势曲线数据 ============
  const chartData = useMemo(() => {
    return logs.slice(-35).map(item => {
      const t = new Date(item.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return {
        time: t,
        '颈部倾角(°)': item.neckAngle,
        '头肩深度': item.headDepthDelta ?? 0,
        '高低肩差(px)': item.shoulderDiff,
        '离屏距离(cm)': item.screenDistance,
      };
    });
  }, [logs]);

  // ============ 4. 时段热力图: 7天 × 24小时 ============
  // 每格颜色深度 = 该时段的"不良姿态比例"
  const heatmap = useMemo(() => {
    // bucket[dayIndex][hour] = { bad, total }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets: Array<Array<{ bad: number; total: number }>> = Array.from(
      { length: 7 }, () => Array.from({ length: 24 }, () => ({ bad: 0, total: 0 }))
    );

    logs.forEach(l => {
      const d = new Date(l.timestamp);
      const dayDiff = Math.floor((today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / (24 * 3600 * 1000));
      if (dayDiff < 0 || dayDiff >= 7) return;
      const dayIdx = 6 - dayDiff; // 让今天落在最右边
      const hr = d.getHours();
      buckets[dayIdx][hr].total++;
      if (isBadPostureMetric(l)) buckets[dayIdx][hr].bad++;
    });

    return buckets;
  }, [logs]);

  const dayLabels = useMemo(() => {
    const today = new Date();
    const labels: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
    }
    return labels;
  }, []);

  const statusLabel = useMemo(() => {
    if (summary.healthySpineScore >= 85) return { label: '体态状态良好', color: 'text-emerald-400 bg-emerald-950/40 border-emerald-500/20' };
    if (summary.healthySpineScore >= 65) return { label: '存在轻度疲劳', color: 'text-amber-400 bg-amber-950/40 border-amber-500/20' };
    return { label: '需要尽快调整', color: 'text-red-400 bg-red-950/90 border-red-500/30 font-bold' };
  }, [summary.healthySpineScore]);

  return (
    <div className="space-y-6">

      {/* 久坐番茄钟提醒条 */}
      <SedentaryTimer currentMetric={currentMetric} isWebcamActive={!!isWebcamActive} />

      {/* KPI 行 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<Hourglass className="w-5 h-5" />}
          tone="sky"
          title="Total Monitored"
          value={`${Math.floor(summary.totalMinutes / 60)}h ${summary.totalMinutes % 60}m`}
          sub={
            <>
              <span className="text-emerald-400 font-bold font-mono">
                {((summary.goodPostureMinutes / (summary.totalMinutes || 1)) * 100).toFixed(0)}%
              </span>
              <span className="text-slate-500 font-medium">Optimal posture</span>
            </>
          }
        />
        <KpiCard
          icon={<ShieldAlert className="w-5 h-5" />}
          tone="rose"
          title="Bad Posture Rate"
          value={`${((summary.badPostureMinutes / (summary.totalMinutes || 1)) * 100).toFixed(1)}%`}
          valueClass="text-rose-400"
          sub={
            <>
              <span>Alert count:</span>
              <span className="text-rose-400 font-bold font-mono">{summary.alertCount}</span>
            </>
          }
        />
        <KpiCard
          icon={<Brain className="w-5 h-5" />}
          tone="indigo"
          title="Avg Focus Score"
          value={<>{summary.averageFocusScore} <span className="text-[11px] text-slate-500 font-normal">/100</span></>}
          sub={
            <>
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
              <span className="text-emerald-400 font-semibold">
                {summary.averageFocusScore >= 80 ? 'Highly Focused' : 'Slightly Tired'}
              </span>
            </>
          }
        />
        <div className="bg-gradient-to-br from-slate-900 to-indigo-950/80 border border-indigo-500/20 rounded-2xl p-4 flex items-center gap-3.5 shadow-xl">
          <div className="bg-indigo-500/20 p-2.5 rounded-xl text-indigo-300 shrink-0 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.2)]">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-extrabold text-slate-400 block tracking-widest leading-none mb-1">脊柱健康分</span>
            <span className={`text-lg font-bold tracking-tight block ${
              summary.healthySpineScore >= 80 ? 'text-emerald-400' :
                summary.healthySpineScore >= 60 ? 'text-amber-400' : 'text-red-400'
              }`}>
              {summary.healthySpineScore} <span className="text-[11px] text-slate-500 font-normal font-sans">/100</span>
            </span>
            <div className={`mt-1 text-[9px] px-1.5 py-0.5 rounded border ${statusLabel.color} inline-block font-semibold tracking-wide`}>
              {statusLabel.label}
            </div>
          </div>
        </div>
      </div>

      {/* 历史体态分类 */}
      <div className="bg-slate-900 border border-slate-800/80 p-5 rounded-2xl shadow-xl">
        <div className="flex justify-between items-center mb-1">
          <h3 className="text-sm font-semibold text-slate-200">历史体态分类分布</h3>
          <span className="text-[10px] bg-slate-950 px-2 py-0.5 rounded text-emerald-400 font-mono uppercase">
            finalLabel fallback
          </span>
        </div>
        <p className="text-xs text-slate-400 mb-4">优先统计后端保存的五分类判定；旧日志缺字段时用姿态状态与布尔标记兼容</p>
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={postureClassData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} />
              <YAxis stroke="#64748b" fontSize={10} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }} itemStyle={{ fontSize: '11px' }} />
              <Bar dataKey="count" name="记录数" radius={[5, 5, 0, 0]} isAnimationActive={false}>
                {postureClassData.map(item => (
                  <Cell key={item.label} fill={item.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 趋势 + 雷达 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-slate-900 border border-slate-800/80 p-5 rounded-2xl shadow-xl flex flex-col">
          <div className="flex justify-between items-center mb-1">
            <h3 className="text-sm font-semibold text-slate-200">实时骨骼遥测变量趋势</h3>
            <span className="text-[10px] bg-slate-950 px-2 py-0.5 rounded text-sky-400 font-mono uppercase">
              MediaPipe + Recharts
            </span>
          </div>
          <p className="text-xs text-slate-400 mb-4">颈部倾角 / 高低肩差 / 离屏距离 / 头肩深度 随时间动态</p>
          <div className="h-64 w-full">
            {chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                暂无遥测数据，开启摄像头累积一段监测…
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="cs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="cd" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="chd" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={9.5} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={9.5} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }} labelStyle={{ color: '#94a3b8', fontSize: '11px' }} itemStyle={{ fontSize: '11px' }} />
                  <Area type="monotone" dataKey="颈部倾角(°)" stroke="#38bdf8" strokeWidth={2} fillOpacity={1} fill="url(#cn)" isAnimationActive={false} />
                  <Area type="monotone" dataKey="头肩深度" stroke="#22c55e" strokeWidth={1.5} fillOpacity={1} fill="url(#chd)" isAnimationActive={false} />
                  <Area type="monotone" dataKey="高低肩差(px)" stroke="#6366f1" strokeWidth={1.5} fillOpacity={1} fill="url(#cs)" isAnimationActive={false} />
                  <Area type="monotone" dataKey="离屏距离(cm)" stroke="#a855f7" strokeWidth={1.5} fillOpacity={1} fill="url(#cd)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="flex justify-center items-center gap-6 mt-4 text-[10.5px] text-slate-400 font-mono">
            <Legend color="bg-sky-400" text="颈倾角 (限值15°)" />
            <Legend color="bg-emerald-500" text="头肩深度 (辅助)" />
            <Legend color="bg-indigo-500" text="高低肩差 (极值5px)" />
            <Legend color="bg-purple-500" text="离屏距 (50-70cm)" />
          </div>
        </div>

        <RadarPanel radarData={radarData} />
      </div>

      {/* 时段热力图 */}
      <div className="bg-slate-900 border border-slate-800/80 p-5 rounded-2xl shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-amber-400" />
              7 天 × 24 小时 不良姿态热力图
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">每格颜色越深代表该时段不良姿态占比越高</p>
          </div>
          <div className="flex items-center gap-2 text-[9.5px] text-slate-400 font-mono">
            <span>低</span>
            <div className="flex">
              {['bg-slate-800', 'bg-emerald-900/60', 'bg-amber-700/60', 'bg-orange-600/70', 'bg-red-600/80'].map((c, i) => (
                <div key={i} className={`w-3 h-3 ${c}`} />
              ))}
            </div>
            <span>高</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            {/* 头: 小时 */}
            <div className="flex items-center mb-1">
              <div className="w-12 shrink-0" />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="w-5 text-center text-[8.5px] text-slate-500 font-mono">
                  {h % 3 === 0 ? h : ''}
                </div>
              ))}
            </div>
            {heatmap.map((row, dayIdx) => (
              <div key={dayIdx} className="flex items-center mb-0.5">
                <div className="w-12 shrink-0 text-[10px] text-slate-400 font-mono">{dayLabels[dayIdx]}</div>
                {row.map((cell, h) => {
                  const ratio = cell.total > 0 ? cell.bad / cell.total : -1;
                  const cls =
                    ratio < 0 ? 'bg-slate-900/40' :
                      ratio === 0 ? 'bg-slate-800' :
                        ratio < 0.25 ? 'bg-emerald-900/60' :
                          ratio < 0.5 ? 'bg-amber-700/60' :
                            ratio < 0.75 ? 'bg-orange-600/70' : 'bg-red-600/80';
                  const title = cell.total > 0
                    ? `${dayLabels[dayIdx]} ${h}:00 · 共${cell.total}条 · 不良率${(ratio * 100).toFixed(0)}%`
                    : `${dayLabels[dayIdx]} ${h}:00 · 无数据`;
                  return (
                    <div
                      key={h}
                      className={`w-5 h-5 ${cls} border border-slate-950/60 hover:scale-125 hover:z-10 transition-transform cursor-pointer`}
                      title={title}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}

// =================== 子组件 ===================

const RadarPanel = memo(function RadarPanel({ radarData }: { radarData: RadarDatum[] }) {
  const polygonPoints = useMemo(() => buildRadarPolygonPoints(radarData), [radarData]);

  return (
    <div className="bg-slate-900 border border-slate-800/80 p-5 rounded-2xl shadow-xl flex flex-col justify-between">
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-1">五维体态雷达</h3>
        <p className="text-xs text-slate-400">综合反映各姿态维度的代偿表现</p>
      </div>
      <div className="h-60 w-full">
        <svg viewBox={`0 0 ${RADAR_VIEWBOX} ${RADAR_VIEWBOX}`} className="w-full h-full overflow-visible" role="img" aria-label="五维体态雷达">
          <StaticRadarFrame subjects={radarData.map(item => item.subject)} />
          <polygon
            points={polygonPoints}
            fill="#10b981"
            fillOpacity={0.25}
            stroke="#10b981"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          {radarData.map((item, idx) => {
            const point = radarPoint(idx, radarData.length, RADAR_RADIUS * Math.max(0, Math.min(100, item.A)) / item.fullMark);
            return (
              <circle key={item.subject} cx={point.x} cy={point.y} r={2.4} fill="#34d399" />
            );
          })}
        </svg>
      </div>
      <div className="text-[10px] bg-slate-950 border border-slate-800/50 p-2.5 rounded-xl text-center text-slate-400 leading-relaxed">
        雷达面积越大代表综合体态越稳定；某项塌陷请查阅后续姿态建议页。
      </div>
    </div>
  );
});

const StaticRadarFrame = memo(function StaticRadarFrame({ subjects }: { subjects: string[] }) {
  const outerPoints = subjects.map((_, idx) => radarPoint(idx, subjects.length, RADAR_RADIUS));
  return (
    <g>
      {RADAR_LEVELS.map(level => (
        <polygon
          key={level}
          points={outerPoints.map((_, idx) => formatPoint(radarPoint(idx, subjects.length, RADAR_RADIUS * level))).join(' ')}
          fill="none"
          stroke="#334155"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {outerPoints.map((point, idx) => (
        <line
          key={subjects[idx]}
          x1={RADAR_CENTER}
          y1={RADAR_CENTER}
          x2={point.x}
          y2={point.y}
          stroke="#334155"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {[0, 50, 100].map(value => (
        <text
          key={value}
          x={RADAR_CENTER + 4}
          y={RADAR_CENTER - (RADAR_RADIUS * value / 100)}
          fill="#64748b"
          fontSize={8}
          dominantBaseline="middle"
        >
          {value}
        </text>
      ))}
      {subjects.map((subject, idx) => {
        const point = radarPoint(idx, subjects.length, RADAR_RADIUS + RADAR_LABEL_OFFSET);
        const anchor = Math.abs(point.x - RADAR_CENTER) < 2 ? 'middle' : point.x > RADAR_CENTER ? 'start' : 'end';
        return (
          <text
            key={subject}
            x={point.x}
            y={point.y}
            fill="#94a3b8"
            fontSize={9.5}
            textAnchor={anchor}
            dominantBaseline="middle"
          >
            {subject}
          </text>
        );
      })}
    </g>
  );
});

function KpiCard({
  icon, tone, title, value, valueClass, sub,
}: {
  icon: React.ReactNode;
  tone: 'sky' | 'rose' | 'indigo' | 'emerald';
  title: string;
  value: React.ReactNode;
  valueClass?: string;
  sub: React.ReactNode;
}) {
  const toneCls = {
    sky: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  }[tone];
  return (
    <div className="bg-[#0f172a]/60 border border-slate-800 rounded-2xl p-4 flex items-center gap-3.5 shadow-xl group hover:border-slate-700 transition-colors">
      <div className={`p-2.5 rounded-xl shrink-0 border ${toneCls} group-hover:scale-105 transition-transform`}>{icon}</div>
      <div>
        <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-widest leading-none mb-1">{title}</span>
        <span className={`text-lg font-bold font-mono tracking-tight block ${valueClass ?? 'text-slate-100'}`}>{value}</span>
        <div className="flex items-center gap-1 mt-1 text-[10px]">{sub}</div>
      </div>
    </div>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2.5 h-0.5 ${color} inline-block`}></span>
      <span>{text}</span>
    </div>
  );
}
