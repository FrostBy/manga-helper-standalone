import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import obfuscator from 'rollup-plugin-obfuscator';

const useObfuscation = process.env.OBFUSCATE === 'true';

export default defineConfig({
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    version: '2.0.0',
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
