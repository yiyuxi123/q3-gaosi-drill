import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gaosi.q3exam',
  appName: 'Q3考高斯刷题',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    // Native networking avoids WebView CORS failures when the installed app
    // talks directly to Nutstore WebDAV and the AI endpoint.
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;
