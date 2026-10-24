import { build } from 'esbuild';
await build({
  entryPoints: ['src/client.js'], outfile: 'client.js', bundle: true,
  format: 'cjs', platform: 'browser', target: 'es2022',
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  banner: { js: 'window.__ModuleLoader__.load({ id: "dsh-voice-message", factory: (require) => { var module = { exports: {} }; var exports = module.exports;' },
  footer: { js: 'return module.exports; } });' },
});
