import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import obfuscator from 'rollup-plugin-obfuscator';

const useObfuscation = process.env.OBFUSCATE === 'true';

export default defineConfig({
  manifest: {
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA499IlT2UvFUVgUytVyvr8ICsCqEtK2aeiSPFCqmI7Q96PNQ2iWljkLKKZxahaYrAgaIXDAqOHrZEAJenf1z+gjGXUE0wqXgyw5wnb0Yz9ZHnix/MKPGO5Q1e9wqE08MZszaE+9VLqPURvlEuSkolgMCyTYVEYu6/jRiPsWOLjoxRX2KKnkxJ7jyU6Zk6mQfM8U4krs+OAjYGrvTGlzTUuDz+KqT+XPLT9y3yr9WsxG1Tkg0q8qOKwtEo8AzQB3drx2z5qYjAk3pCjNepokInG3xVgSQroM0rRzPb9aCWp3JL3MWEAQElPCL9uetpAdj/u6x236xQwnQPgnNDpIbViQIDAQAB',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    version: '2026.01.04',
    icons: {
      16: 'icon-16.png',
      32: 'icon-32.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
    permissions: ['storage', 'tabs', 'declarativeNetRequest'],
    host_permissions: [
      '*://*.mangalib.me/*',
      '*://api.cdnlibs.org/*',
      '*://cover.imglib.info/*',
      '*://*.senkuro.com/*',
      '*://api.senkuro.com/*',
      '*://*.senkuro.me/*',
      '*://api.senkuro.me/*',
      '*://*.mangabuff.ru/*',
      '*://*.readmanga.io/*',
      '*://api.rmr.rocks/*',
      '*://a.zazaza.me/*',
      '*://*.inkstory.net/*',
      '*://api.inkstory.net/*',
      '*://*.manga.ovh/*',
    ],
  },
  vite: () => ({
    optimizeDeps: {
      include: ['geo-profile'],
    },
    ssr: {
      noExternal: ['geo-profile'],
    },
    plugins: [
      preact(),
      ...(useObfuscation
        ? [
            obfuscator({
              options: {
                compact: true,
                controlFlowFlattening: true,
                controlFlowFlatteningThreshold: 0.75,
                deadCodeInjection: true,
                deadCodeInjectionThreshold: 0.4,
                identifierNamesGenerator: 'hexadecimal',
                renameGlobals: false,
                selfDefending: true,
                splitStrings: true,
                splitStringsChunkLength: 10,
                stringArray: true,
                stringArrayCallsTransform: true,
                stringArrayEncoding: ['base64'],
                stringArrayThreshold: 0.75,
                transformObjectKeys: true,
                unicodeEscapeSequence: false,
              },
            }),
          ]
        : []),
    ],
  }),
});
