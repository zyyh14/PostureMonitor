# 久坐人群体态监测与可视化系统 — 项目结构与功能说明

## 一、项目概述

基于 **计算机视觉** 的非接触式体态健康监测系统。通过普通笔记本/外置摄像头采集人体上半身画面，使用 Google MediaPipe Pose 框架实时提取 33 个骨骼关键点，应用几何公式计算颈部前倾角、高低肩、离屏距离等指标，对久坐人群进行连续监测、智能预警与健康评估。

### 技术栈

| 层级 | 选型 |
|------|------|
| 前端框架 | React 19 + TypeScript 5.8 + Vite 6 |
| 样式 | TailwindCSS 4 |
| 图表 | Recharts |
| 计算机视觉 | @mediapipe/tasks-vision (Pose Landmarker · GPU 推理) |
| 后端 | Express + tsx (运行时) |
| 数据存储 | 本地 JSON 文件 (`posture_store.json`) |
| AI 智能诊断 | Google Gemini API (`@google/genai`) |
| 图标 | lucide-react |

### 启动方式

```bash
npm install
npm run dev          # http://localhost:3000
```

---

## 二、目录结构

```
久坐人群体态监测与可视化系统/
├── server.ts                   # Express 后端 + Vite 中间件 + Gemini 代理
├── vite.config.ts              # Vite 配置 (含运行期数据文件忽略规则)
├── tsconfig.json
├── package.json
├── index.html                  # 单页入口
├── posture_store.json          # 持久化的体态监测日志 (运行时生成)
├── .env.example                # GEMINI_API_KEY 模板
│
└── src/
    ├── main.tsx                # React 根挂载
    ├── App.tsx                 # 顶层布局 + Tab 路由 + 全局状态
    ├── index.css               # TailwindCSS 入口与全局样式
    ├── types.ts                # 全局类型定义
    │
    ├── components/             # 业务 UI 组件
    │   ├── CameraWorkspace.tsx     # 摄像头工作台 (核心)
    │   ├── MetricsDashboard.tsx    # 数据大屏看板
    │   ├── SedentaryTimer.tsx      # 久坐番茄钟提醒条
    │   ├── AiDoctorReport.tsx      # Gemini AI 智能诊疗
    │   ├── RoboflowReport.tsx      # 模型准确率评估报告
    │   └── DocReport.tsx           # 项目说明书与日报导出
    │
    └── lib/                    # 算法 / 引擎 / 工具层 (无 UI)
        ├── poseDetector.ts         # MediaPipe Pose Landmarker 封装
        ├── postureAnalyzer.ts      # 33 关键点 → 健康指标几何计算
        ├── postureStateMachine.ts  # 报警迟滞状态机 (防误报核心)
        ├── oneEuroFilter.ts        # One-Euro 关键点抖动滤波器
        ├── skeletonRenderer.ts     # Canvas 骨架与角度辅助线绘制
        ├── notifier.ts             # 三通道警报: 通知/TTS/警报音
        └── sessionKeeper.ts        # HMR 跨模块的资源持久化层
```

---

## 三、核心功能与文件映射

### 1. 实时姿态监测（核心流程）

**文件：** `src/components/CameraWorkspace.tsx`

负责整个"视频采集 → 关键点检测 → 几何计算 → 报警"主循环。

**关键能力：**
- 申请 `getUserMedia` 摄像头权限并维持单例视频流
- 调用 MediaPipe Pose 在每帧上检测 33 个骨骼关键点 (GPU 加速)
- 通过状态机判定是否触发报警，避免单帧抖动误报
- 在 Canvas 上叠加骨架连线与颈倾角度弧
- 个性化基线校准 (5 秒静坐采样)
- Tab 不可见时自动暂停推理保留流，回到前台无缝恢复
- 摄像头错误 / 引擎错误的非阻塞错误条 + 重试按钮
- 提供"手动实验台"模式（关闭摄像头时滑杆驱动数据，便于演示）

**依赖的算法层：**
`PoseDetector` → `analyzePose` → `PostureStateMachine` → `drawSkeleton` / `notifier`

---

### 2. 关键点检测引擎

**文件：** `src/lib/poseDetector.ts`

封装 `@mediapipe/tasks-vision` 的 `PoseLandmarker`：

- 从 jsdelivr CDN 加载 WASM (`tasks-vision@0.10.18/wasm`)
- 加载官方 `pose_landmarker_lite` 模型 (float16, ~6MB)
- `delegate: 'GPU'` 启用 WebGL/WebGPU 加速
- 全局单例 (挂在 `globalThis`)，HMR 重载不丢失
- 返回的关键点经过 `PoseSmoother` 多通道平滑

**关键点索引常量** `POSE_LANDMARKS` 提供：`NOSE, LEFT_EYE, LEFT_EAR, LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP …`

---

### 3. 几何计算（健康指标）

**文件：** `src/lib/postureAnalyzer.ts`

把归一化关键点转化为可读指标，严格按 PPT《我们的思路》的几何公式：

| 指标 | 公式 |
|------|------|
| **颈部前倾角** | `arctan(\|x_鼻 − x_肩中点\| / \|y_鼻 − y_肩中点\|)` + z 轴前突修正 |
| **高低肩偏度** | `\|y_左肩 − y_右肩\| × 画面高` |
| **离屏距离** | 实测肩宽 ≈ 38cm，反比例换算 `D = k / shoulderWidthNorm` |
| **躯干侧倾** | 肩中点 → 髋中点 向量与垂直线夹角 |
| **头侧倾** | 双眼连线与水平线夹角 |
| **专注度** | `0.45 × 鼻中心性 + 0.35 × 双眼对称度 + 0.20 × (1 − 头侧倾惩罚)` |
| **置信度** | 关键关键点 visibility 几何均值 |

并提供：
- `buildCalibration()` — 5 秒静坐采样建立用户个性化基线
- `deriveStatus()` — 从快照映射出布尔标志与综合状态等级
- `DEFAULT_BASELINE` — 未校准时的默认参考

---

### 4. 报警迟滞状态机（防误报核心）

**文件：** `src/lib/postureStateMachine.ts`

工业级状态机，避免"单帧脏数据 → 假警报"：

```
NORMAL ──[连续 3s 坏]──→ ALARM ──[连续 2s 好]──→ NORMAL
                              ↑
                              └─ 同类别 30s 冷却
                              └─ 置信度 < 0.6 视为脏数据
```

每个不良类别 (`slouch / shoulder / close / torso`) 独立计时与冷却，避免警报风暴。

`feed(input)` 方法每帧喂入检测结果，输出新的 `AlarmEvent | null` 用于发声/通知。

---

### 5. 关键点抖动滤波

**文件：** `src/lib/oneEuroFilter.ts`

实现 **One-Euro Filter** (Géry Casiez et al, CHI 2012)：

- 静止时低通频率压低 → 极稳定，消除 2-5 px 抖动
- 快速运动时根据导数自适应放高频率 → 跟手不延迟
- `PoseSmoother` 给每个 (landmarkIndex, axis) 维护独立滤波器

直接受益：颈部前倾角、离屏距离等读数不再"跳跃"，显著提升体感准确率。

---

### 6. 骨架可视化

**文件：** `src/lib/skeletonRenderer.ts`

在 Canvas 上叠加：
- 33 关键点 + 上半身骨架连线（按部位染色）
- 关键关节圆点 + 标签 (Nose / L-Sh / R-Sh / L-Ear / R-Ear)
- 颈部前倾角度弧 + 数值
- 高低肩警告虚线
- 顶部 HUD（实时数值 + MediaPipe 状态点）
- 未检测到主体时的提示文字

---

### 7. 多通道警报

**文件：** `src/lib/notifier.ts`

| 通道 | 实现 |
|------|------|
| **合成警报音** | Web Audio API 三连音/四连音，依严重度选频率 |
| **浏览器原生通知** | `Notification API`，需用户授权 |
| **中文 TTS** | `SpeechSynthesisUtterance`，rate=0.95 |

`playChime / pushNotification / speak` 三个独立函数，由状态机决定何时调用。

---

### 8. HMR 跨模块资源持久化

**文件：** `src/lib/sessionKeeper.ts`

Vite 在 dev 模式下热替换模块会重新挂载 React 组件，常规实现会导致摄像头流被释放、MediaPipe 重新加载。本模块把摄像头流与 detector ready 状态挂在 `globalThis` 上，HMR 重载时新组件直接复用，做到**真正的"一次开启，持续运行"**。

生产环境无 HMR，这些字段也只是普通的全局单例，无副作用。

---

### 9. 数据大屏看板

**文件：** `src/components/MetricsDashboard.tsx`

四大模块：

| 区块 | 内容 |
|------|------|
| **KPI 行** | 总监测时长、不良姿态率、平均专注度、脊柱健康分 (0-100) |
| **遥测趋势图** | 最近 35 帧的颈倾 / 高低肩 / 离屏距离 时序曲线 (Recharts AreaChart) |
| **五维雷达** | 颈椎防护 / 双肩对称 / 睫状肌防红 / 注视专注 / 正姿持续 |
| **7×24 热力图** | 按"日期 × 小时"展示不良姿态占比，直观看出高峰时段 |

顶部嵌入 `SedentaryTimer` 久坐番茄钟提醒条。

---

### 10. 久坐番茄钟提醒

**文件：** `src/components/SedentaryTimer.tsx`

- 用户可选 25 / 45 / 60 分钟阈值
- 根据 `currentMetric.activityState` 判断"是否在座"，连续端坐计时
- 离开 30 秒以上自动重置计时
- 达到阈值后通过 Notification + TTS + Chime 三通道提醒
- 启用开关持久化到 `localStorage`

---

### 11. AI 智能诊断

**文件：** `src/components/AiDoctorReport.tsx` + `server.ts` 中的 `/api/gemini/analyze`

后端聚合最近 40 条监测数据：颈倾率、高低肩率、过近率、平均值。

调用 Google Gemini 3.5 Flash，要求返回 JSON：
```json
{
  "analysis": "Markdown 格式的诊疗深度文章",
  "suggestions": ["建议 1", "建议 2"],
  "excercises": [{"name": "...", "duration": "...", "steps": [...], "benefit": "..."}],
  "score": 0-100
}
```

无 `GEMINI_API_KEY` 时进入沙盒模式，根据真实数据返回模板化分析（不破坏离线演示）。

前端组件首次挂载时自动调一次，后续仅由用户点击右上角刷新触发，避免高频请求。

---

### 12. 模型准确率评估

**文件：** `src/components/RoboflowReport.tsx`

展示在 Roboflow 数据集上对姿态分类模型的评估：
- **核心指标** Tab：Precision 91.8%、Recall 90.2%、mAP@0.5 93.5%、样本量
- **训练曲线** Tab：50 个 Epoch 的 train/val loss 与 mAP50 收敛
- **混淆矩阵** Tab：4 类（良好/前倾/高低肩/驼背）的预测分布

---

### 13. 项目说明书与数据导出

**文件：** `src/components/DocReport.tsx`

- 嵌入项目说明（核心几何公式 / 准确率优化策略 / 应用场景扩展 / 相比传统传感器的优势）
- **导出健康日报 (HTML)** —— 自动统计平均颈倾、平均距离、姿态最差的 Top3 时段，附理疗处方
- **导出原始数据 (CSV)** —— 带 BOM 头供 Excel/Pandas 直接读取
- **数据重组按钮** —— 调 `/api/logs/reset`，恢复 7 天饱满演示数据

---

## 四、后端 API（`server.ts`）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/logs` | GET | 获取所有历史体态记录 |
| `/api/logs` | POST | 上传单条体态记录（前端节流 5 秒一次） |
| `/api/logs/reset` | POST | 重置为 7 天预置演示数据 |
| `/api/gemini/analyze` | POST | 调用 Gemini 生成诊疗报告（无 API Key 时返回沙盒模板） |

数据持久化到工程根目录的 `posture_store.json`，自动保留最近 1000 条记录。

---

## 五、关键工程决策

### 摄像头持续运行
- **流幂等启停** — 已存在 active 流时直接复用，绝不重复申请权限
- **`globalThis` 资源持久化** — HMR 热替换不释放流和 detector
- **vite.config 忽略 `posture_store.json`** — 后端写日志不会触发 page reload
- **报警与开关解耦** — 任何报警/错误路径都不会自动关闭摄像头

### 准确率优化
- **个性化基线校准** — 用户中立位锁为零参考，抵消身高体型差异
- **One-Euro 滤波** — 关键点抖动从 2-5 px 降到亚像素级
- **置信度门控** — visibility < 0.4 的关键点不参与计算
- **状态机迟滞** — 3 秒坏才报警，2 秒好才解除，避免误报
- **物理锚点** — 用平均双肩宽 38cm 作为像素→cm 换算基准

### 用户体验
- **三通道警报** — 视觉横幅 + 警报音 + TTS 语音 + 浏览器通知
- **久坐番茄钟** — 主动健康提醒，覆盖"系统不报警 ≠ 健康"的盲区
- **离线兜底** — 无摄像头/无 Gemini API Key 时仍能完整演示

---

## 六、应用场景扩展

| 场景 | 说明 |
|------|------|
| **企业办公健康看板** | 多人聚合数据，HR 部门评估员工健康风险 |
| **K-12 学生书桌矫正** | 学习时段坐姿监督，家长端日报 |
| **居家康复随访** | 配合医生处方，跟踪术后/慢性颈椎病恢复 |
| **电竞 / 直播主播** | 长时间坐姿场景的亚健康预警 |
| **无障碍辅助** | TTS 通道使视障用户也能用语音感知姿态 |
