/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { PostureMetric } from './types';
import CameraWorkspace from './components/CameraWorkspace';
import MetricsDashboard from './components/MetricsDashboard';
import AiDoctorReport from './components/AiDoctorReport';
import RoboflowReport from './components/RoboflowReport';
import DocReport from './components/DocReport';
import { toneTextClass, labelToChinese } from './lib/postureDisplay';
import { 
  ShieldCheck, LayoutDashboard, BrainCircuit, Cpu, BookOpen, 
  Activity, RefreshCw, AlertCircle 
} from 'lucide-react';

export default function App() {
  const [logs, setLogs] = useState<PostureMetric[]>([]);
  const [currentMetric, setCurrentMetric] = useState<PostureMetric>({
    id: 'init',
    timestamp: new Date().toISOString(),
    neckAngle: 8.5,
    shoulderDiff: 1.2,
    screenDistance: 60,
    gazeFocus: 95,
    headDepthDelta: 0,
    torsoDepthDelta: 0,
    isSlouched: false,
    isHighLowShoulder: false,
    isTooClose: false,
    isForwardLeaning: false,
    isBackwardLeaning: false,
    postureStatus: 'good',
    activityState: 'focused'
  });

  const [isWebcamActive, setIsWebcamActive] = useState(() => {
    // 跨页面刷新 / Vite HMR 重载保留摄像头开关状态，
    // 避免开发期反复重置造成"开了立刻关"的错觉。
    try { return sessionStorage.getItem('vidipost_webcam_on') === '1'; } catch { return false; }
  });
  const [isPlaySound, setIsPlaySound] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'ai' | 'roboflow' | 'docs'>('dashboard');
  const [loading, setLoading] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<number>(0);
  const detectionLabel = labelToChinese(currentMetric.finalLabel);

  // 持久化 webcam 状态
  useEffect(() => {
    try { sessionStorage.setItem('vidipost_webcam_on', isWebcamActive ? '1' : '0'); } catch { /* noop */ }
  }, [isWebcamActive]);

  // 1. 从后端加载多天饱满的历史监测记录
  const loadLogsFromServer = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/logs');
      if (response.ok) {
        const data = await response.json();
        setLogs(data);
      }
    } catch (e) {
      console.error("加载后端久坐数据失败:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogsFromServer();
  }, []);

  // 2. 仅当摄像头真实检测到姿态时才上传到后端，节流 5 秒。
  //    手动实验台模式下不上传，避免静态页面每 5 秒强行追加一条 log
  //    导致大屏图表反复重渲染、视觉抖动。
  useEffect(() => {
    if (currentMetric.detectionSource !== 'mediapipe') return;
    const now = Date.now();
    if (now - lastSavedTime < 5000) return;

    const saveMetric = async () => {
      try {
        const response = await fetch('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(currentMetric)
        });
        if (response.ok) {
          const resData = await response.json();
          setLogs(prev => [...prev, resData.log]);
          setLastSavedTime(now);
        }
      } catch (err) {
        console.error("上传体态日志失败:", err);
      }
    };

    saveMetric();
  }, [currentMetric, lastSavedTime]);

  // 3. 重置后端与本地的遥测数据流 (回到饱满的7天历史趋势)
  const handleResetLogs = async () => {
    if (window.confirm("确定要重置并初始化默认的饱满模拟监控数据集吗？这有利于进行完整图表展示。")) {
      try {
        const response = await fetch('/api/logs/reset', { method: 'POST' });
        if (response.ok) {
          loadLogsFromServer();
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-indigo-500 selection:text-white pb-10">
      
      {/* 全局炫酷顶部导航条 */}
      <header className="border-b border-slate-800 bg-[#0f172a]/80 backdrop-blur-md sticky top-0 z-50 px-4 lg:px-8 py-3.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-indigo-500 to-sky-600 p-2 rounded-xl shadow-lg shadow-indigo-500/20 text-white shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h1 className="text-base font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-slate-400">
            久坐体态监测与可视化系统
          </h1>
        </div>

        {/* 顶部中央快捷状态栏 - 固定宽度避免文字变化导致布局抖动 */}
        <div className="flex items-center gap-3 bg-slate-950/80 px-3.5 py-1.5 rounded-xl border border-slate-800 text-xs font-mono min-w-[180px] justify-center">
          <span className="inline-flex rounded-full h-2 w-2 bg-emerald-500 shrink-0"></span>
          <span className="text-slate-500">体态判定:</span>
          <span className={`font-semibold tracking-wide w-[72px] text-center ${toneTextClass(currentMetric.finalLabel === 'TUP' ? 'emerald' : currentMetric.finalLabel ? 'amber' : 'slate')}`}>
            {detectionLabel}
          </span>
        </div>

        {/* 快捷按钮 */}
        <button
          onClick={loadLogsFromServer}
          className="flex items-center gap-1 text-slate-400 hover:text-white hover:bg-slate-800 p-2 rounded-lg text-xs font-medium transition-all border border-slate-800"
          title="刷新数据"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </header>

      {/* 核心主排大图布局 */}
      <main className="max-w-7xl mx-auto px-4 lg:px-8 mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* 左排: 实时摄像头视觉采集与骨骼反投射传感器 (占用 4/12 空间) */}
        <section className="lg:col-span-4 h-full flex flex-col">
          <CameraWorkspace
            currentMetric={currentMetric}
            onMetricChange={setCurrentMetric}
            isWebcamActive={isWebcamActive}
            setIsWebcamActive={setIsWebcamActive}
            isPlaySound={isPlaySound}
            setIsPlaySound={setIsPlaySound}
          />
        </section>

        {/* 右排: 信息可视化操控大板 (占用 8/12 空间) */}
        <section className="lg:col-span-8 flex flex-col gap-5">
          
          {/* 大屏导航选项卡 Tabs (Bento Style Buttons) */}
          <div className="bg-slate-900/60 p-1.5 rounded-2xl border border-slate-800/80 flex flex-nowrap overflow-x-auto gap-1">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-gradient-to-r from-sky-500 to-indigo-500 text-white shadow-lg shadow-indigo-500/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              数据大屏看板
            </button>

            <button
              onClick={() => setActiveTab('ai')}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                activeTab === 'ai'
                  ? 'bg-gradient-to-r from-sky-500 to-indigo-500 text-white shadow-lg shadow-indigo-500/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
              }`}
            >
              <BrainCircuit className="w-4 h-4" />
              Gemini AI 智能诊断
            </button>

            <button
              onClick={() => setActiveTab('roboflow')}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                activeTab === 'roboflow'
                  ? 'bg-gradient-to-r from-sky-500 to-indigo-500 text-white shadow-lg shadow-indigo-500/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
              }`}
            >
              <Cpu className="w-4 h-4" />
              Roboflow 准确率测定
            </button>

            <button
              onClick={() => setActiveTab('docs')}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                activeTab === 'docs'
                  ? 'bg-gradient-to-r from-sky-500 to-indigo-500 text-white shadow-lg shadow-indigo-500/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              项目说明书与日报导出
            </button>
          </div>

          {/* 选项卡内容区域 */}
          <div className="flex-1 min-h-[500px]">
            {activeTab === 'dashboard' && (
              <MetricsDashboard 
                logs={logs} 
                currentMetric={currentMetric} 
                isWebcamActive={isWebcamActive}
              />
            )}

            {activeTab === 'ai' && (
              <AiDoctorReport 
                logs={logs} 
              />
            )}

            {activeTab === 'roboflow' && (
              <RoboflowReport />
            )}

            {activeTab === 'docs' && (
              <DocReport 
                logs={logs} 
                onResetLogs={handleResetLogs} 
              />
            )}
          </div>

        </section>

      </main>

      {/* 极简底部声明 */}
      <footer className="max-w-7xl mx-auto px-4 lg:px-8 mt-12 text-center text-[10.5px] text-slate-500 border-t border-slate-900 pt-5 leading-relaxed">
        <p>© 2026 基于网络摄像头与深度学习的久坐人群体态监测及力学评估系统</p>
      </footer>

    </div>
  );
}
