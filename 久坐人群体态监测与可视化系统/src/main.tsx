import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// 注: 暂不启用 React.StrictMode。
// StrictMode 会在 dev 下让所有 useEffect 双挂载一次，
// 这会导致摄像头流被快速打开-关闭-再打开，引发 MediaPipe 推理循环异常重启。
// 生产 build 不受影响，需要时可再开启。
createRoot(document.getElementById('root')!).render(<App />);
