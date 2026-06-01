/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { PostureMetric, GeminiResponse } from '../types';
import { Loader2, BrainCircuit, RefreshCw, BadgeAlert, Sparkles, HeartPulse, Activity } from 'lucide-react';

interface AiDoctorReportProps {
  logs: PostureMetric[];
}

export default function AiDoctorReport({ logs }: AiDoctorReportProps) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<GeminiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAiDiagnosis = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/gemini/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) {
        throw new Error('呼叫智能 AI 医生诊断失败，请检查后端状态');
      }
      const data = await response.json();
      setReport(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || '诊断服务接口超时或离线');
    } finally {
      setLoading(false);
    }
  };

  // 首次挂载时自动诊断一次。后续只能由用户主动点右上角刷新按钮触发，
  // 避免每 5 秒新增一条 log 就重新请求 Gemini 导致页面持续 loading 抖动。
  useEffect(() => {
    fetchAiDiagnosis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <BrainCircuit className="w-5 h-5 text-emerald-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
              Gemini AI 多维脊尊康复诊疗室
              <span className="text-[10px] bg-sky-950 text-sky-400 border border-sky-800 px-1.5 py-0.2 rounded font-mono">
                Flash 3.5
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">基于您近期久坐习惯，自动生成临床理疗计划</p>
          </div>
        </div>

        <button
          onClick={fetchAiDiagnosis}
          disabled={loading}
          className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-all disabled:opacity-50"
          title="重新请求 AI 评估"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center py-12 space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
          <p className="text-xs text-slate-400 font-medium">智能医生正在查阅您的骨骼遥测电图...</p>
          <p className="text-[10px] text-slate-500">正在计算上交叉综合征指数与斜方肌筋张力...</p>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center border border-dashed border-red-500/20 rounded-xl bg-red-950/10">
          <BadgeAlert className="w-8 h-8 text-red-400 mb-2" />
          <h4 className="text-xs font-semibold text-red-200 mb-1">AI 评估连接遇到卡顿</h4>
          <p className="text-[11px] text-slate-400 max-w-xs">{error}</p>
          <button 
            onClick={fetchAiDiagnosis}
            className="mt-3 text-xs font-medium text-sky-400 hover:underline"
          >
            重试连接
          </button>
        </div>
      ) : report ? (
        <div className="flex-1 space-y-5 overflow-y-auto max-h-[500px] pr-1 scrollbar-thin">
          
          {/* 健康得分条 */}
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[11px] text-slate-400 block font-mono">SPINE STABILITY STATE</span>
              <h4 className="font-semibold text-slate-200 text-sm">脊髓动力学平衡状态点评</h4>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <span className={`text-xl font-bold font-mono ${
                  report.score >= 80 ? 'text-emerald-400' : report.score >= 60 ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {report.score}
                </span>
                <span className="text-xs text-slate-500 block">综合健康指数</span>
              </div>
              <div className={`p-2 rounded-lg ${
                report.score >= 80 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
              }`}>
                <HeartPulse className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* AI 报告主要文本渲染 */}
          <div className="text-xs text-slate-300 leading-relaxed text-left bg-slate-950/30 p-3.5 rounded-xl border border-slate-800/60 font-medium whitespace-pre-wrap">
            <div className="flex items-center gap-1 text-emerald-400 font-bold mb-2">
              <Sparkles className="w-3.5 h-3.5" />
              AI 专家组临床解剖学剖析：
            </div>
            {report.analysis}
          </div>

          {/* 实时理疗运动练习设计 */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 uppercase tracking-wide">
              <Activity className="w-3.5 h-3.5 text-sky-400" />
              今日脊椎物理拉伸处方
            </h4>

            <div className="grid grid-cols-1 gap-3">
              {report.excercises.map((ex, idx) => (
                <div key={idx} className="bg-slate-950/50 border border-slate-800/70 p-3.5 rounded-xl space-y-2 text-left hover:border-sky-500/30 transition-all">
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-bold text-sky-300">{idx + 1}. {ex.name}</span>
                    <span className="text-[10px] font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded">{ex.duration}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 italic">🌿 <b>医学益处</b>: {ex.benefit}</p>
                  
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/40">
                    <span className="text-[10px] text-slate-400 font-bold block mb-1">执行指导步骤：</span>
                    <ul className="list-decimal list-inside text-[10.5px] text-slate-300 space-y-1">
                      {ex.steps.map((step, sIdx) => (
                        <li key={sIdx} className="pl-1 text-slate-300 leading-relaxed">{step}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 补充建议 */}
          <div className="bg-emerald-950/20 border border-emerald-500/10 p-3.5 rounded-xl text-left">
            <h5 className="text-[11px] font-bold text-emerald-400 mb-1.5 flex items-center gap-1">
              ⚡ 坐姿习惯修正温馨提示：
            </h5>
            <ul className="list-disc list-inside text-[10.5px] text-emerald-200 space-y-1">
              {report.suggestions.map((s, idx) => (
                <li key={idx}>{s}</li>
              ))}
            </ul>
          </div>

        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs text-center">
          暂无 AI 诊断，点击右上角重新刷新评估。
        </div>
      )}
    </div>
  );
}
