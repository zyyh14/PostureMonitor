# 代码中需要后续优化的写死项

这份清单用于标记当前项目中明显属于“演示写死、后续应配置化/数据驱动化”的内容，便于后续分工修改。

## 1. 前端写死项

### `src/components/RoboflowReport.tsx`

- `trainingHistory` 是静态数组，训练曲线数据写死。
- `classData` 是静态数组，类别样本量和准确率写死。
- `matrixData` 是静态数组，混淆矩阵写死。
- 页面上的 `91.8% / 90.2% / 93.5% / 2450 帧` 等摘要数值写死。
- 文案里“测试集准确率 > 90%”“YOLOv8-pose”等描述写死。

后续建议:
- 改成从真实训练日志、评估 JSON、或后端接口读取。
- 如果短期保留演示数据，需加注释标明“demo only / mock data”。

### `src/components/DocReport.tsx`

- 导出 HTML 报告中的结论文案是写死模板。
- “麦肯基颈部回缩”“Y-T-W-L”等康复建议写死。
- “显示器升高 8cm”“20-20-20 用眼法则”等建议写死。
- 报告标题、场景描述、优势说明均为固定文案。

后续建议:
- 按日志统计结果动态生成建议。
- 对固定医学建议增加“默认推荐项”注释，避免误解为实时诊断结果。

### `src/components/AiDoctorReport.tsx`

- UI 文案写死，例如“Gemini AI 多维脊尊康复诊疗室”“Flash 3.5”等。
- loading 状态文案写死。
- 报告展示布局固定，字段依赖后端返回结构。

后续建议:
- 保留展示文案，但把“模型版本、诊断方式、提示词说明”改成可配置。

### `src/components/MetricsDashboard.tsx`

- KPI 文案固定。
- 雷达图维度固定。
- 热力图区块样式固定。
- 阈值提示如 `15° / 5px / 50-70cm` 作为展示说明写死。

后续建议:
- 阈值说明与算法阈值保持一致，并通过常量统一管理。

## 2. 后端写死项

### `server.ts`

- `PORT = 3000` 写死。
- `STORE_FILE = posture_store.json` 写死。
- `getPresetLogs()` 里的 7 天游演示数据生成逻辑写死。
- 9:00 - 18:00、跳过午休、下午姿态变差等规则写死。
- 日志上限 `1000` 条写死。
- Gemini 兜底模板内容写死。
- Gemini 模型名 `gemini-3.5-flash` 写死。
- Prompt 内容写死。

后续建议:
- 将端口、模型名、日志上限、演示数据开关改为环境变量或配置文件。
- 预置数据生成建议独立成脚本。

## 3. 算法写死项

### `src/lib/postureAnalyzer.ts`

- `neckAngle > 18`
- `shoulderDiff > 20`
- `screenDistance < 45`
- `torsoTilt > 8`
- `visibility > 0.4`

这些属于当前算法阈值，不应视为最终定值，后续应结合数据集验证调整。

### `src/lib/postureStateMachine.ts`

- `badDwellMs = 3000`
- `goodDwellMs = 2000`
- `cooldownMs = 30000`
- `minConfidence = 0.6`

这些是当前防误报策略参数，后续可通过实验调优。

## 4. 当前优先级建议

1. 先把算法阈值和数据集验证做实。
2. 再把前端写死的评估数据改成真实读取。
3. 最后再统一做配置化和文案整理。

