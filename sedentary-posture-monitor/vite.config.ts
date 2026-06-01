import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch:
        process.env.DISABLE_HMR === 'true'
          ? null
          : {
              // 关键修复:
              // 后端每 5 秒往 posture_store.json 写入新检测数据，
              // 默认情况下 Vite 文件监听器会把它当成"项目代码变更"
              // 触发 full page reload，导致摄像头流被销毁、MediaPipe
              // 重新加载——也就是用户看到的"反复 LOADING"。
              // 把这个文件 (以及任何其他持续被写入的运行时产物) 排除掉。
              ignored: [
                '**/posture_store.json',
                '**/dist/**',
                '**/node_modules/**',
                '**/.git/**',
                '**/*.log',
              ],
            },
    },
  };
});
