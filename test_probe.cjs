const { spawn } = require('child_process');

const env = Object.assign({}, process.env, {
  CODEX_MODEL_PROVIDER: 'myservice',
  CODEX_MODEL_PROVIDERS_MYSERVICE_NAME: 'MyService',
  CODEX_MODEL_PROVIDERS_MYSERVICE_BASE_URL: 'http://127.0.0.1:8317/v1',
  CODEX_MODEL_PROVIDERS_MYSERVICE_WIRE_API: 'responses',
  CODEX_MODEL_PROVIDERS_MYSERVICE_ENV_KEY: 'MYIDE_API_KEY',
  CODEX_MODEL_PROVIDERS_MYSERVICE_REQUIRES_OPENAI_AUTH: 'false',
  CODEX_SHELL_ENVIRONMENT_POLICY_INCLUDE_ONLY: '["PATH","HOME","LANG","TERM","USERPROFILE","APPDATA","LOCALAPPDATA","TEMP","TMP","SystemRoot","HOMEDRIVE","HOMEPATH"]',
  CODEX_DISABLE_TELEMETRY: 'true',
  CODEX_WINDOWS_SANDBOX: 'unelevated',
  MYIDE_API_KEY: 'your-api-key-1'
});

const child = spawn('d:/workspace/t3codedev/apps/desktop/bin/ai-engine.exe', [], { env, shell: true });

child.on('exit', (code) => {
  console.log('EXIT:', code);
});
child.stderr.on('data', (d) => process.stdout.write('STDERR: ' + d.toString()));
child.stdout.on('data', (d) => process.stdout.write('STDOUT: ' + d.toString()));

// Just wait a few seconds, if it doesn't crash, we'll terminate
setTimeout(() => {
  child.kill();
}, 2000);
