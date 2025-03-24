import * as fs from 'fs';
import { VitePWA } from 'vite-plugin-pwa'


const getHttps = require('localhost-https');
export default {
  build: {
    sourcemap: true,
	  outDir: 'docs',
    target: 'esnext'
  },
  server : {
      https: getHttps(),
  },
  base: '',
  plugins : [
    VitePWA(
      { 
        registerType: 'autoUpdate',
        devOptions: {
        enabled: false
      },
      manifest: false,
      })
  ]
}
