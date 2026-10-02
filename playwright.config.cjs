const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4174', headless: true },
  webServer: { command: 'node tools/serve.mjs', env: { PORT: '4174' }, url: 'http://127.0.0.1:4174', reuseExistingServer: true },
});
