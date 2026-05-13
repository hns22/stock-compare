import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const browserLikeHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/yahoo": {
        target: "https://query1.finance.yahoo.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/yahoo/, ""),
        secure: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            for (const [k, v] of Object.entries(browserLikeHeaders)) {
              proxyReq.setHeader(k, v);
            }
          });
        },
      },
      "/frankfurter": {
        target: "https://api.frankfurter.dev",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/frankfurter/, ""),
        secure: true,
      },
      "/finnhub": {
        target: "https://finnhub.io",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/finnhub/, ""),
        secure: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            for (const [k, v] of Object.entries(browserLikeHeaders)) {
              proxyReq.setHeader(k, v);
            }
          });
        },
      },
      "/naver": {
        target: "https://m.stock.naver.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/naver/, ""),
        secure: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            for (const [k, v] of Object.entries(browserLikeHeaders)) {
              proxyReq.setHeader(k, v);
            }
          });
        },
      },
    },
  },
});
