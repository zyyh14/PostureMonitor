/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

const app = express();
const PORT = 3000;
const STORE_FILE = path.join(process.cwd(), 'posture_store.json');

app.use(express.json());

// 1. 初始化本地持久化存储与 realistic 7天历史数据
function getPresetLogs() {
  const logs: any[] = [];
  const now = new Date();
  
  // 生成过去7天的监测模拟数据
  for (let d = 7; d >= 0; d--) {
    const day = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
    // 模拟一天中不同时间段 (9:00 - 18:00) 的多次测量
    for (let h = 9; h <= 18; h++) {
      if (h === 12 || h === 13) continue; // 午休无久坐数据
      const timestamp = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, Math.floor(Math.random() * 60)).toISOString();
      
      // 随着时间的推移，下午段疲劳度上升，姿态变差
      const isAfternoon = h >= 14;
      const neckAngle = isAfternoon ? (15 + Math.random() * 25) : (8 + Math.random() * 15);
      const shoulderDiff = isAfternoon ? (2 + Math.random() * 8) : (0.5 + Math.random() * 4);
      const screenDistance = isAfternoon ? (35 + Math.random() * 15) : (50 + Math.random() * 20);
      const gazeFocus = isAfternoon ? (55 + Math.random() * 25) : (80 + Math.random() * 20);
      
      const isSlouched = neckAngle > 20;
      const isHighLowShoulder = shoulderDiff > 4;
      const isTooClose = screenDistance < 40;
      
      let status: 'good' | 'warning' | 'danger' = 'good';
      if (isSlouched && isTooClose) status = 'danger';
      else if (isSlouched || isHighLowShoulder || isTooClose) status = 'warning';
      
      let activityState: 'focused' | 'tired' | 'distracted' | 'away' = 'focused';
      if (isAfternoon) {
        activityState = Math.random() > 0.4 ? 'tired' : 'distracted';
      } else {
        activityState = Math.random() > 0.85 ? 'distracted' : 'focused';
      }

      logs.push({
        id: `preset_${d}_${h}`,
        timestamp,
        neckAngle: parseFloat(neckAngle.toFixed(1)),
        shoulderDiff: parseFloat(shoulderDiff.toFixed(1)),
        screenDistance: parseFloat(screenDistance.toFixed(0)),
        gazeFocus: Math.round(gazeFocus),
        isSlouched,
        isHighLowShoulder,
        isTooClose,
        postureStatus: status,
        activityState
      });
    }
  }
  return logs;
}

function loadLogs() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const content = fs.readFileSync(STORE_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.error('加载存储数据失败，重新生成预设 data', e);
  }
  const defaults = getPresetLogs();
  saveLogsToDisk(defaults);
  return defaults;
}

function saveLogsToDisk(logs: any[]) {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(logs, null, 2), 'utf-8');
  } catch (e) {
    console.error('存储数据失败:', e);
  }
}

let activeLogs = loadLogs();

// API 1: 获取所有体态历史记录
app.get('/api/logs', (req, res) => {
  res.json(activeLogs);
});

// API 2: 上传一条新的体态记录
app.post('/api/logs', (req, res) => {
  const { neckAngle, shoulderDiff, screenDistance, gazeFocus, isSlouched, isHighLowShoulder, isTooClose, postureStatus, activityState } = req.body;
  const newLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString(),
    neckAngle: parseFloat(neckAngle),
    shoulderDiff: parseFloat(shoulderDiff),
    screenDistance: parseFloat(screenDistance),
    gazeFocus: parseInt(gazeFocus),
    isSlouched: !!isSlouched,
    isHighLowShoulder: !!isHighLowShoulder,
    isTooClose: !!isTooClose,
    postureStatus: postureStatus || 'good',
    activityState: activityState || 'focused'
  };
  activeLogs.push(newLog);
  // 保留最近 1000 条监控数据，防止内存/大小过大
  if (activeLogs.length > 1000) {
    activeLogs.shift();
  }
  saveLogsToDisk(activeLogs);
  res.json({ success: true, log: newLog });
});

// API 3: 清空重置体态数据
app.post('/api/logs/reset', (req, res) => {
  activeLogs = getPresetLogs();
  saveLogsToDisk(activeLogs);
  res.json({ success: true, message: '已重置回多天饱满历史测试数据' });
});

// API 4: Gemini AI 人体姿态与颈脊监控个性化健康分析报告
app.post('/api/gemini/analyze', async (req, res) => {
  try {
    const recentLogs = activeLogs.slice(-40); // 挑选最近40次极具代表性的记录
    const slouchedLogs = recentLogs.filter((l: any) => l.isSlouched).length;
    const highLowLogs = recentLogs.filter((l: any) => l.isHighLowShoulder).length;
    const tooCloseLogs = recentLogs.filter((l: any) => l.isTooClose).length;
    const totalCount = recentLogs.length || 1;
    
    // 计算均值
    let neckSum = 0, shoulderSum = 0, distanceSum = 0, focusSum = 0;
    recentLogs.forEach((l: any) => {
      neckSum += l.neckAngle;
      shoulderSum += l.shoulderDiff;
      distanceSum += l.screenDistance;
      focusSum += l.gazeFocus;
    });
    const avgNeck = neckSum / totalCount;
    const avgShoulder = shoulderSum / totalCount;
    const avgDistance = distanceSum / totalCount;
    const avgFocus = focusSum / totalCount;

    // 是否有 API KEY
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      // 优雅沙盒兜底分析 - 高度逼真和定制化
      const score = Math.max(20, Math.round(100 - (slouchedLogs/totalCount)*40 - (highLowLogs/totalCount)*20 - (tooCloseLogs/totalCount)*20));
      
      const mockedResponse = {
        analysis: `### 颈椎与脊柱体态分析报告 (Demo 演示模式)\n根据最近监测到的 **${totalCount}** 组姿态数据分析：\n1. **颈部健康方面**：您的平均前倾角为 **${avgNeck.toFixed(1)}°**。前倾角在 15° 以内为良好。当前不良前倾时间占比为 **${((slouchedLogs/totalCount)*100).toFixed(0)}%**。由于频繁的前倾、驼背，这给您的颈椎带来了约 **${(avgNeck * 1.5).toFixed(0)} 磅** 的额外受压，极易导致慢性劳损、颈伸肌群缩短与前侧深屈肌萎缩。\n2. **高低肩平衡度**：您的平均高低肩偏差在 **${avgShoulder.toFixed(1)}px**。高低肩偏移偏高时（通常 > 4px），这说明您在久坐时身体重量存在严重的单侧支撑（如单肘依靠扶手、二郎腿、脊柱侧弯代偿），请留心骨盆扭转和斜方肌张力不平衡。\n3. **离屏距离与专注水平**：您的平均离屏距离为 **${avgDistance.toFixed(0)}cm**，平均专注度为 **${avgFocus.toFixed(0)}分**。过度向前靠近显示器（< 40cm 占比 **${((tooCloseLogs/totalCount)*100).toFixed(0)}%**）通常与眼部睫状肌疲劳、视力下降有直接互为因果关系。`,
        suggestions: [
          `调节您的工作站：请将显示器物理增高 5-10cm，使屏幕上边缘与眼睛平齐，眼睛与屏幕距离保持在 50-70cm 之间。`,
          `意识纠正：每当系统弹出红色「久坐警报」时，立即吸气，沉肩往后，夹紧肩胛骨，进行 3 次深呼吸。`,
          `纠正坏习惯：保持盆骨中立位，双脚平放于地面，拒绝翘二郎腿，平衡身体重心。`
        ],
        excercises: [
          {
            name: "麦肯基颈部伸展操 (颈丛舒缓术)",
            duration: "2分钟",
            steps: [
              "端正坐姿，双眼平视前方。",
              "缓慢将头部向后平移（做出双下巴动作），保持全身重心不后仰。",
              "在最深处保持 5 秒，之后缓慢仰头看天花板，维持 3 秒，重复 5 次。"
            ],
            benefit: "纠正电脑颈（颈椎前突），缓解枕后颈部肌肉筋膜的强烈压迫感。"
          },
          {
            name: "Y-T-W-L 肩胛飞鸟激活",
            duration: "3分钟",
            steps: [
              "身体微微前倾，双臂平展，手指比大拇指。",
              "依次将双臂高举做出 Y 、T 、W、L 字形，充分向中央挤压肩胛骨。",
              "每个姿势动作保持 10 秒，完成两轮循环。"
            ],
            benefit: "激活上背部松弛软弱的肌肉（中下斜方肌、菱形肌），根治耸肩驼背。"
          }
        ],
        score
      };
      return res.json(mockedResponse);
    }

    // 调用真正 server-side Gemini 3.5-flash
    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });

    const promptObj = `
    你是一位资深的骨科医生和专业人体工学康复理疗师。
    请根据以下采集到的久坐办公室人群的历史体态监测数据，提供具有极高专业度的诊断评估、理疗建议及运动医学拉伸操。
    
    【核心监测指标摘要】：
    - 总监测点组数: ${totalCount}
    - 颈部不良前倾率: ${((slouchedLogs/totalCount)*100).toFixed(1)}% (平均颈部倾斜角为 ${avgNeck.toFixed(1)}度)
    - 左右高低肩偏差时间占比: ${((highLowLogs/totalCount)*100).toFixed(1)}% (平均两侧肩膀偏差高度为 ${avgShoulder.toFixed(1)}px)
    - 坐姿距离屏幕过近率（眼睛疲劳/视疲劳）: ${((tooCloseLogs/totalCount)*100).toFixed(1)}% (平均面部距离屏幕 ${avgDistance.toFixed(0)}cm)
    - 平均工作专注评分: ${avgFocus.toFixed(0)}分
    
    要求：
    1. 报告必须十分科学细致，多从肌肉力学、骨骼力学（如：上交叉综合征、斜方肌代偿、斜角肌紧张度、视敏轴疲劳）角度分析。
    2. 以 JSON 格式返回，不要有 markdown 语法块外包装（只返回纯合法的 JSON 字符串）。
    3. JSON schema 对应：
    {
      "analysis": "Markdown格式的诊断诊断深度文章",
      "suggestions": ["建议1", "建议2", "建议3"],
      "excercises": [
        {
          "name": "拉伸动作名称",
          "duration": "执行时长",
          "steps": ["第一步...", "第二步..."],
          "benefit": "动作对骨骼肌肉及体态纠正的具体医学好处描述"
        }
      ],
      "score": 0到100的脊柱健康综合评估分 (数字)
    }
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: promptObj,
      config: {
        responseMimeType: 'application/json'
      }
    });

    const resultText = response.text || '';
    const parsedData = JSON.parse(resultText);
    res.json(parsedData);

  } catch (error: any) {
    console.error('Gemini API 调用或解析失败:', error);
    res.status(500).json({ error: 'Gemini 服务诊断失败：' + error.message });
  }
});


// 启动 Express Server
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // 挂载 Vite 开发服务器作为中间件，非常流畅地支持 HMR 和静态资源
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // 让单页路由完全 fallback 到 index.html
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`久坐体态大屏 server.ts 服务启动: http://localhost:${PORT}`);
  });
}

startServer();
