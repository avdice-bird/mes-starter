import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    strictPort: true, // 端口被占用时直接报错，避免悄悄漂到 5175+ 让代理/白名单失配
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      // 看板 socket.io（第 49 节）：只代理引擎路径，/board 页面路由仍由 SPA 处理
      '/board/socket.io': { target: 'http://localhost:3000', changeOrigin: true, ws: true },
    },
  },
});
