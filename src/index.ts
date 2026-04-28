#!/usr/bin/env node
import { Command } from 'commander';
import { defaultConfigPath } from './config/defaults.js';
import { ConfigError, loadConfig } from './config/loader.js';
import { initLogger, type LogLevel } from './util/logger.js';
import { SERVER_NAME, SERVER_VERSION, startStdioServer } from './server.js';

interface CliOptions {
  config?: string;
  logLevel?: LogLevel;
  insecureTls?: boolean;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name(SERVER_NAME)
    .version(SERVER_VERSION)
    .description('MCP server exposing internal OpenAPI / Swagger specs over stdio.')
    .option('-c, --config <path>', `path to config file (default: ${defaultConfigPath()})`)
    .option(
      '-l, --log-level <level>',
      'log level: trace, debug, info, warn, error, fatal, silent',
      'info',
    )
    .option('--insecure-tls', 'disable TLS certificate verification (self-signed servers)')
    .parse(process.argv);

  const opts = program.opts<CliOptions>();
  const logger = initLogger(opts.logLevel ?? 'info');

  if (opts.insecureTls) {
    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
    logger.warn('TLS certificate verification disabled (--insecure-tls)');
  }

  const configPath = opts.config ?? defaultConfigPath();

  try {
    const { config, path: resolved } = await loadConfig(configPath);
    logger.info({ config: resolved, specs: Object.keys(config.specs) }, 'config loaded');
    await startStdioServer(config);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error({ err: err.message }, 'failed to load config');
    } else {
      logger.error({ err }, 'fatal error during startup');
    }
    process.exit(1);
  }
}

void main();
