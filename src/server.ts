import { loadEnv,readConfig } from './config.js';
import { createApp } from './app.js';
try {
  loadEnv();
  const cfg=readConfig();
  const server=createApp(cfg);
  server.on('error',()=>{console.error('RELAY_START_FAILED');process.exitCode=1;server.close();});
  server.listen(cfg.port,cfg.host,()=>{
    const address=server.address();
    console.log('MAWD Relay: http://127.0.0.1:'+(typeof address==='object'&&address?address.port:cfg.port));
    console.log('Liner='+cfg.linerMode+'; Channel='+cfg.channelMode+'; local demo only');
    console.log('Local auth: RELAY_AUTH_TOKEN or data/relay-auth-token (never an external API key).');
  });
  for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close());
} catch { console.error('RELAY_CONFIG_OR_STATE_INVALID');process.exitCode=1; }
