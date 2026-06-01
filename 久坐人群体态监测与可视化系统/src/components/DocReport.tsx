/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 项目说明书 + 数据报告导出
 * - 体态健康日报 (HTML, 含图表统计)
 * - 原始数据 CSV 导出 (供 Excel / Python 分析)
 * - 项目说明、几何公式、扩展应用场景
 */

import React from 'react';
import { PostureMetric } from '../types';
import { BookOpen, Download, Code, Info, FileSpreadsheet } from 'lucide-react';

interface DocReportProps {
  logs: PostureMetric[];
  onResetLogs: () => void;
}

export default function DocReport({ logs, onResetLogs }: DocReportProps) {

  // ---------- HTML 健康日报 ----------
  const handleExportHtml = () => {
    const recentLogs = logs.slice(-200);
    const totalCount = recentLogs.length || 1;
    let slouched = 0, highLow = 0, close = 0, neckSum = 0, shSum = 0, distSum = 0, focusSum = 0;
    const hourBuckets: Record<number, { bad: number; total: number }> = {};

    recentLogs.forEach(l => {
      if (l.isSlouched) slouched++;
      if (l.isHighLowShoulder) highLow++;
      if (l.isTooClose) close++;
      neckSum += l.neckAngle; shSum += l.shoulderDiff;
      distSum += l.screenDistance; focusSum += l.gazeFocus;
      const h = new Date(l.timestamp).getHours();
      if (!hourBuckets[h]) hourBuckets[h] = { bad: 0, total: 0 };
      hourBuckets[h].total++;
      if ((l.finalLabel ?? l.modelLabel) !== 'TUP') hourBuckets[h].bad++;
    });

    const avgNeck = neckSum / totalCount;
    const avgSh = shSum / totalCount;
    const avgDist = distSum / totalCount;
    const avgFocus = focusSum / totalCount;

    // 找出最差时段 Top3
    const worstHours = Object.entries(hourBuckets)
      .map(([h, v]) => ({ hour: parseInt(h), ratio: v.bad / Math.max(1, v.total), total: v.total }))
      .filter(x => x.total >= 2)
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 3);

    const worstHoursHtml = worstHours.length
      ? `<ul>${worstHours.map(w => `<li><b>${w.hour.toString().padStart(2, '0')}:00 - ${(w.hour + 1).toString().padStart(2, '0')}:00</b>: 不良姿态占比 ${(w.ratio * 100).toFixed(0)}% (共采样 ${w.total} 次)</li>`).join('')}</ul>`
      : '<p style="color:#94a3b8">暂无足够数据分析时段差异</p>';

    const exportTime = new Date().toLocaleString('zh-CN');

    const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>久坐体态健康日报</title>
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f8fafc; color: #1e293b; padding: 40px; }
  .card { background: #fff; border-radius: 16px; border: 1px solid #e2e8f0; max-width: 880px; margin: 0 auto; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); padding: 36px; }
  .header { border-bottom: 2px solid #3b82f6; text-align: center; margin-bottom: 24px; padding-bottom: 16px; }
  .header h1 { font-size: 26px; color: #0f172a; margin: 0 0 6px 0; }
  .header p { font-size: 13px; color: #64748b; margin: 0; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin: 24px 0; }
  .grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 18px 0; }
  .metric { background: #f1f5f9; padding: 16px; border-radius: 12px; text-align: center; }
  .metric .lbl { font-size: 11px; color: #64748b; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
  .metric h2 { font-size: 22px; color: #2563eb; margin: 8px 0 4px 0; }
  .metric .desc { font-size: 11px; }
  .section-title { font-size: 16px; font-weight: bold; border-left: 4px solid #2563eb; padding-left: 10px; margin: 28px 0 12px 0; color: #0f172a; }
  .bar { background: #e2e8f0; height: 12px; border-radius: 6px; overflow: hidden; margin: 4px 0; }
  .bar > div { height: 100%; background: linear-gradient(90deg, #34d399, #f59e0b, #ef4444); }
  ul { padding-left: 20px; line-height: 1.7; font-size: 13px; color: #334155; }
  li { margin-bottom: 6px; }
  .footer { text-align: center; margin-top: 36px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 18px; }
  .ok { color: #10b981; } .bad { color: #ef4444; } .mid { color: #f59e0b; }
</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>久坐人群体态健康日报</h1>
      <p>导出时间: ${exportTime} · 数据样本: ${totalCount} 条 · 基于 MediaPipe 关键点几何分析</p>
    </div>

    <div class="grid3">
      <div class="metric">
        <div class="lbl">平均颈椎前倾角</div>
        <h2>${avgNeck.toFixed(1)}°</h2>
        <div class="desc ${avgNeck > 18 ? 'bad' : 'ok'}">${avgNeck > 18 ? '⚠️ 颈椎严重负荷' : '✓ 脖颈姿势良好'}</div>
      </div>
      <div class="metric">
        <div class="lbl">平均高低肩偏差</div>
        <h2>${avgSh.toFixed(1)} px</h2>
        <div class="desc ${avgSh > 20 ? 'bad' : 'ok'}">${avgSh > 20 ? '⚠️ 单侧斜方肌高负荷' : '✓ 双肩对称'}</div>
      </div>
      <div class="metric">
        <div class="lbl">平均面屏距离</div>
        <h2>${avgDist.toFixed(0)} cm</h2>
        <div class="desc ${avgDist < 45 ? 'bad' : 'ok'}">${avgDist < 45 ? '⚠️ 睫状肌易疲劳' : '✓ 防疲劳距离适宜'}</div>
      </div>
    </div>

    <div class="grid4">
      <div class="metric">
        <div class="lbl">前倾占比</div>
        <h2 class="${slouched / totalCount > 0.3 ? 'bad' : 'ok'}">${((slouched / totalCount) * 100).toFixed(0)}%</h2>
      </div>
      <div class="metric">
        <div class="lbl">高低肩占比</div>
        <h2 class="${highLow / totalCount > 0.3 ? 'bad' : 'ok'}">${((highLow / totalCount) * 100).toFixed(0)}%</h2>
      </div>
      <div class="metric">
        <div class="lbl">离屏过近占比</div>
        <h2 class="${close / totalCount > 0.3 ? 'bad' : 'ok'}">${((close / totalCount) * 100).toFixed(0)}%</h2>
      </div>
      <div class="metric">
        <div class="lbl">平均专注度</div>
        <h2 class="${avgFocus < 60 ? 'mid' : 'ok'}">${avgFocus.toFixed(0)}<span style="font-size:13px;color:#94a3b8">/100</span></h2>
      </div>
    </div>

    <div class="section-title">🕐 一日时段分析 — 您姿态最差的高峰时段</div>
    ${worstHoursHtml}

    <div class="section-title">📊 综合行为分析</div>
    <ul>
      <li>共采集 <b>${totalCount}</b> 帧人体骨骼关键点数据 (本日 / 近期)</li>
      <li>颈椎严重前倾(>18°): <b class="${slouched / totalCount > 0.3 ? 'bad' : 'ok'}">${((slouched / totalCount) * 100).toFixed(1)}%</b></li>
      <li>明显单侧高低肩(>20px): <b class="${highLow / totalCount > 0.3 ? 'bad' : 'ok'}">${((highLow / totalCount) * 100).toFixed(1)}%</b></li>
      <li>离屏过近(<45cm): <b class="${close / totalCount > 0.3 ? 'bad' : 'ok'}">${((close / totalCount) * 100).toFixed(1)}%</b></li>
    </ul>

    <div class="section-title">🏥 康复理疗处方建议</div>
    <ul>
      <li><b>麦肯基颈部回缩</b>: 端坐缓慢做"双下巴"动作回缩颈部 5 秒，重复 10 次 — 矫正颈椎前突</li>
      <li><b>Y-T-W-L 肩胛激活</b>: 双臂依次比划 Y/T/W/L，每姿势挤压肩胛骨 10 秒 — 激活松弛的中下斜方肌</li>
      <li><b>显示器升高 8cm</b>: 上边缘与眼睛平齐，距离保持 50-70cm — 强制中立位坐姿</li>
      <li><b>盆骨中立练习</b>: 双脚平放地面，重力均放左右坐骨结节，禁止翘二郎腿</li>
      <li><b>20-20-20 用眼法则</b>: 每 20 分钟看 20 英尺(6m)外的物体 20 秒 — 缓解睫状肌痉挛</li>
    </ul>

    <div class="footer">
      <p>本报告由「基于计算机视觉的久坐人群体态监测与可视化系统 / 第14组」自动生成</p>
      <p>非接触、零穿戴、低成本 — 适合办公室白领及学生群体大规模部署</p>
    </div>
  </div>
</body>
</html>`;

    download(htmlContent, `体态健康日报_${new Date().toISOString().slice(0, 10)}.html`, 'text/html');
  };

  // ---------- CSV 原始数据导出 ----------
  const handleExportCsv = () => {
    const header = [
      'timestamp', 'neckAngle', 'shoulderDiff', 'screenDistance', 'gazeFocus',
      'torsoTilt', 'headTilt', 'isSlouched', 'isHighLowShoulder', 'isTooClose',
      'postureStatus', 'activityState', 'detectionSource', 'confidence', 'modelLabel', 'finalLabel',
    ];
    const rows = logs.map(l => [
      l.timestamp,
      l.neckAngle,
      l.shoulderDiff,
      l.screenDistance,
      l.gazeFocus,
      l.torsoTilt ?? '',
      l.headTilt ?? '',
      l.isSlouched,
      l.isHighLowShoulder,
      l.isTooClose,
      l.postureStatus,
      l.activityState,
      l.detectionSource ?? '',
      l.confidence ?? '',
      l.modelLabel ?? '',
      l.finalLabel ?? '',
    ].join(','));
    const csv = '\uFEFF' + [header.join(','), ...rows].join('\n'); // BOM 让 Excel 识别 UTF-8
    download(csv, `posture_logs_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl text-left h-full flex flex-col justify-between">

      <div>
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3 mb-4">
          <BookOpen className="w-5 h-5 text-sky-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-200">课题结题大纲与软件说明书</h3>
            <p className="text-[11px] text-slate-400">基于普通摄像头 + MediaPipe Pose 的非接触体态监测系统</p>
          </div>
        </div>

        <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1 text-slate-300 text-xs leading-relaxed">

          <div className="space-y-1.5">
            <h4 className="font-bold text-slate-200 flex items-center gap-1">
              <Code className="w-3.5 h-3.5 text-sky-400" />
              1. 几何计算公式
            </h4>
            <ul className="list-disc list-inside text-[11px] text-slate-400 pl-2 space-y-1">
              <li><b>颈部前倾角 θ</b>: arctan(|x_鼻 - x_肩中点| / |y_鼻 - y_肩中点|) + 鼻 z 轴前突修正</li>
              <li><b>高低肩偏度 ΔY</b>: |y_左肩 - y_右肩| × 画面高，归一化抵消深度误差</li>
              <li><b>离屏距离 D</b>: 实测肩宽 ≈ 38cm，反比例换算 D = k / shoulderWidthNorm</li>
              <li><b>专注度 F</b>: 0.45 × 鼻中心性 + 0.35 × 双眼对称度 + 0.20 × (1 - 头侧倾惩罚)</li>
              <li><b>躯干侧倾</b>: 肩中点 → 髋中点 向量与垂直线夹角</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <h4 className="font-bold text-slate-200 flex items-center gap-1">
              <Info className="w-3.5 h-3.5 text-purple-400" />
              2. 准确率优化策略
            </h4>
            <ul className="list-disc list-inside text-[11px] text-slate-400 pl-2 space-y-1">
              <li><b>One-Euro 滤波</b>: 对每个关键点的 (x,y,z) 独立维护低通滤波器，消除 2-5 px 抖动</li>
              <li><b>个性化基线校准</b>: 5 秒静坐采样，把用户中立位锁为零参考，避免身高/体型偏差</li>
              <li><b>双肩物理锚点</b>: 利用平均双肩宽 38cm 作为像素→cm 换算基准</li>
              <li><b>关键点 visibility 过滤</b>: 低于 0.4 的点不参与几何计算，杜绝幻象数据</li>
              <li><b>多维度联合判定</b>: 综合 颈倾 / 肩差 / 距离 / 躯干 / 头侧 5 维度，减少误报</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <h4 className="font-bold text-slate-200 flex items-center gap-1">
              <Info className="w-3.5 h-3.5 text-amber-400" />
              3. 应用场景扩展
            </h4>
            <ul className="list-disc list-inside text-[11px] text-slate-400 pl-2 space-y-1">
              <li><b>企业办公健康看板</b>: 多人聚合数据，HR 部门评估员工健康风险</li>
              <li><b>K-12 学生书桌矫正</b>: 学习时段坐姿监督，家长端日报</li>
              <li><b>居家康复随访</b>: 配合医生处方，跟踪术后/慢性颈椎病恢复</li>
              <li><b>电竞 / 直播主播</b>: 长时间坐姿场景，避免年轻群体亚健康</li>
              <li><b>无障碍辅助</b>: 与 TTS / 浏览器通知集成，视障用户也能用语音感知姿态</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <h4 className="font-bold text-slate-200 flex items-center gap-1">
              <Info className="w-3.5 h-3.5 text-emerald-400" />
              4. 相比传统穿戴传感器的优势
            </h4>
            <ul className="list-disc list-inside text-[11px] text-slate-400 pl-2 space-y-1">
              <li><b>非接触零约束</b>: 无需佩戴陀螺仪、拉力带，零感无干扰</li>
              <li><b>极低部署成本</b>: 笔记本内置摄像头即可工作，无需采购硬件</li>
              <li><b>多维度立体感知</b>: 同时监测颈、肩、躯干、视距、专注度</li>
              <li><b>纯前端推理</b>: MediaPipe WebGPU 加速，无需上传任何画面数据，隐私友好</li>
            </ul>
          </div>

        </div>
      </div>

      <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row gap-2 text-xs">
        <button
          onClick={handleExportHtml}
          disabled={logs.length === 0}
          className="flex-1 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded-xl shadow-lg shadow-indigo-500/10 flex items-center justify-center gap-2 transition-all"
        >
          <Download className="w-4 h-4" />
          导出健康日报 (HTML)
        </button>
        <button
          onClick={handleExportCsv}
          disabled={logs.length === 0}
          className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 font-semibold py-2.5 px-4 rounded-xl border border-slate-700 flex items-center justify-center gap-2 transition-all"
        >
          <FileSpreadsheet className="w-4 h-4" />
          导出原始 CSV
        </button>
        <button
          onClick={onResetLogs}
          className="bg-slate-850 hover:bg-slate-800 text-slate-300 font-medium py-2.5 px-3.5 rounded-xl border border-slate-800 hover:text-slate-200 shadow-md transition-all"
          title="重置回多天饱满模拟数据，便于演示"
        >
          数据重组
        </button>
      </div>
    </div>
  );
}

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
