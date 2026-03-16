import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import obfuscator from 'rollup-plugin-obfuscator';

const useObfuscation = process.env.OBFUSCATE === 'true';

export default defineConfig({
  manifest: {
    key:
      'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqYK644e0iT56Udd7rKn7' +
      'w+6MlD7kIkCOFbaRRYZKPTRVXqfODSkSoRtKP1pd44lTaWmE3uRcQkLG66q7MFnd' +
      'q9x+eMZ0vpRy+wG3h0rxEtkoOqulHphILJo+7edC0AJVst9lxl40dFaQLjfMF0bY' +
      'zw/bB6TdsWD1Fnhuqa2gu6m5JEVwkupsOi93oMZRYInSZdxAi/AnDjTOJoCqb5qE' +
      'Hy7Orw4vu8j7VcbM+PZIfSEK5urDfPG/yXzqGDTKyg8YfOsgDFPHoQmeg7oivCEN' +
      '8D9S3yVQ8rP3fBlcSn0mMQw99Pt00WKeTzKo+lL0w8jVo5MJoDbobDdscwCPpPY2' +
      'EQIDAQAB',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    version: '2026.02.07',
    icons: {
      16: 'icon-16.png',
      32: 'icon-32.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
    permissions: ['storage', 'tabs', 'declarativeNetRequest'],
    host_permissions: [
      '*://*.mangalib.me/*',
      '*://*.hentailib.me/*',
      '*://api.cdnlibs.org/*',
      '*://hapi.hentaicdn.org/*',
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
