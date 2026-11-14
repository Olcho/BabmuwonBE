import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface Config {
  host: '127.0.0.1'; port: number; allowedOrigins: string[]; relayAuthToken: string;
  linerMode: 'mock' | 'live'; linerKey: string; linerModel: string;
  linerRouterTimeoutMs: number; linerSearchTimeoutMs: number; upstreamTimeoutMs: number;
  channelMode: 'disabled' | 'mock' | 'live'; channelKey: string; channelSecret: string;
  realSendEnabled: boolean; templateCode: string; templateText:string; dataFile: string;
}
export function loadEnv(path = resolve('.env')): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const linerMode = env.LINER_MODE ?? 'mock', channelMode = env.CHANNEL_SEND_MODE ?? 'mock';
  if (!['mock', 'live'].includes(linerMode) || !['mock', 'live', 'disabled'].includes(channelMode)) throw new Error('MODE_INVALID');
  if (env.HOST && env.HOST !== '127.0.0.1') throw new Error('LOCAL_ONLY_BIND_ADDRESS');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT_INVALID');
  const upstreamTimeoutMs = Number(env.UPSTREAM_TIMEOUT_MS ?? 30000);
  if (!Number.isInteger(upstreamTimeoutMs) || upstreamTimeoutMs < 100 || upstreamTimeoutMs > 30000) throw new Error('TIMEOUT_INVALID');
  const realSendEnabled = env.ALLOW_REAL_ALIMTALK_SEND === 'YES';
  if (channelMode === 'live' && !realSendEnabled) throw new Error('REAL_SEND_REQUIRES_EXPLICIT_OPT_IN');
  if (channelMode === 'live' && (!env.CHANNEL_ACCESS_KEY || !env.CHANNEL_ACCESS_SECRET || !env.CHANNEL_TEMPLATE_CODE || !env.CHANNEL_TEMPLATE_TEXT)) throw new Error('CHANNEL_CONFIG_MISSING');
  if (linerMode === 'live' && !env.LINER_API_KEY) throw new Error('LINER_KEY_MISSING');
  const templateCode = env.CHANNEL_TEMPLATE_CODE ?? 'demo-lunch-notice';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(templateCode)) throw new Error('TEMPLATE_CODE_INVALID');
  const templateText=env.CHANNEL_TEMPLATE_TEXT ?? '[데모학교] #{월}월 급식 안내입니다. 이달 식단과 알레르기 표시는 아래 버튼에서 확인해 주세요.';
  if(templateText.length>1000 || templateText.split('#{월}').length!==2 || /#\{[^}]*\}/.test(templateText.replace('#{월}',''))) throw new Error('TEMPLATE_TEXT_INVALID');
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(s => s.trim());
  if (allowedOrigins.some(s => !/^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$/.test(s))) throw new Error('LOCAL_ORIGIN_REQUIRED');
  const dataFile = resolve(env.DATA_FILE ?? 'data/relay-state.json');
  let relayAuthToken = env.RELAY_AUTH_TOKEN;
  if (!relayAuthToken) {
    const tokenFile = resolve(dirname(dataFile), 'relay-auth-token');
    mkdirSync(dirname(tokenFile), { recursive: true });
    try { writeFileSync(tokenFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('TOKEN_STORAGE_FAILED'); }
    relayAuthToken = readFileSync(tokenFile, 'utf8').trim();
  }
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(relayAuthToken)) throw new Error('RELAY_AUTH_TOKEN_INVALID');
  return {
    host: '127.0.0.1', port, allowedOrigins, relayAuthToken,
    linerMode: linerMode as Config['linerMode'], linerKey: env.LINER_API_KEY ?? '',
    linerModel: 'liner-gpt-router', linerRouterTimeoutMs: 30_000, linerSearchTimeoutMs: 60_000, upstreamTimeoutMs,
    channelMode: channelMode as Config['channelMode'], channelKey: env.CHANNEL_ACCESS_KEY ?? '',
    channelSecret: env.CHANNEL_ACCESS_SECRET ?? '', realSendEnabled, templateCode, templateText, dataFile,
  };
}
export function randomTestConfig(dataFile: string): Config {
  return readConfig({ DATA_FILE: dataFile, PORT: '0', RELAY_AUTH_TOKEN: randomBytes(32).toString('hex') });
}
