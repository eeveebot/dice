'use strict';

// Dice module
// provides D&D style dice rolling functionality

import {
  NatsClient,
  log,
  createNatsConnection,
  registerGracefulShutdown,
  createModuleMetrics,
  loadModuleConfig,
  RateLimitConfig,
  defaultRateLimit,
  initializeSystemMetrics,
  setupHttpServer,
  registerCommand,
  sendChatMessage,
  registerHelp,
  HelpEntry,
  registerStatsHandlers,
  NatsSubscriptionResult,
} from '@eeveebot/libeevee';

// Initialize module-scoped metrics recorder
const metrics = createModuleMetrics('dice');

// Initialize system metrics
initializeSystemMetrics('dice');



// Record module startup time for uptime tracking
const moduleStartTime = Date.now();

const rollCommandUUID = '8d4e1f4c-7d9a-4c2b-8f3e-5a7b2c9d1e6f';
const rollCommandDisplayName = 'roll';

// Dice module configuration interface
interface DiceConfig {
  ratelimit?: RateLimitConfig;
  maxDice?: number;
  maxSides?: number;
}

const natsClients: InstanceType<typeof NatsClient>[] = [];

// Setup HTTP server for metrics and health checks
setupHttpServer({
  port: process.env.HTTP_API_PORT || '9000',
  serviceName: 'dice',
  natsClients: natsClients,
});
const natsSubscriptions: Array<Promise<NatsSubscriptionResult>> = [];

// Load configuration at startup
const diceConfig = loadModuleConfig<DiceConfig>({});

// Register graceful shutdown handlers
registerGracefulShutdown(natsClients);

// Setup NATS connection
const nats = await createNatsConnection();
natsClients.push(nats);

// Default configuration
const defaultMaxDice = 64;
const defaultMaxSides = 65535;
const maxDice = diceConfig.maxDice ?? defaultMaxDice;
const maxSides = diceConfig.maxSides ?? defaultMaxSides;

// Utility function to sum an array of numbers
const sum = (arr: number[]): number => arr.reduce((a, b) => a + b, 0);

/**
 * Roll polyhedral dice with various options
 */
function rollPolyhedra(
  n: number = 2,
  s: number = 6,
  b: number = 0,
  x: number = 0,
  k: number = 0
): string {
  n = Math.round(Math.min(n, maxDice));
  s = Math.round(Math.min(s, maxSides));
  b = Math.round(Math.min(b, maxSides));

  if (x < 0) x = -1 * Math.round(Math.min(s, Math.abs(x)));
  else if (x > 0) x = Math.min(s, x);

  k = Math.round(Math.min(n, k));

  let text = `rolling ${n}d${s}`;
  if (x !== 0) text += '!';
  if (k > 0) text += `k${k}`;
  else if (k < 0) text += `d${-1 * k}`;
  if (b > 0) text += `+${b}`;
  else if (b < 0) text += `${b}`;

  // eslint-disable-next-line prefer-const
  let rolled: number[] = [...Array(n)].map(() => Math.ceil(Math.random() * s));
  const keep: number[] = [];

  while (rolled.length > 0) {
    if (x > 0 && rolled[0] > s - x) {
      rolled.push(Math.ceil(Math.random() * s));
    } else if (x < 0 && rolled[0] <= Math.abs(x)) {
      rolled.push(Math.ceil(Math.random() * s));
    }
    keep.push(rolled.shift() as number);
    if (keep.length >= maxDice) break;
  }

  if (k !== 0) {
    keep.sort((a, b) => a - b);
    if (k > 0) keep.reverse();
    while (keep.length > Math.abs(k)) keep.pop();
  }

  return `${text} (${keep.join(',')}) ${sum(keep) + b}`;
}

function rollFudge(n: number = 4): string {
  n = Math.round(Math.min(n, maxDice));
  const faces = ['-', 'o', '+'];
  const rolled = [...Array(n)].map(() => Math.floor(Math.random() * 3));
  const values = rolled.map((r) => r - 1);
  return `rolling ${n}dF (${rolled.map((r) => faces[r]).join(',')}) ${sum(values)}`;
}

function rollORE(n: number = 9, s: number = 10): string {
  n = Math.round(Math.min(n, maxDice));
  s = Math.round(Math.min(s, maxSides));
  n = Math.round(Math.min(n, s));

  const counts: Record<number, number> = {};
  [...Array(n)].map(() => {
    const x = Math.ceil(Math.random() * s);
    counts[x] = (counts[x] || 0) + 1;
  });

  const pairs = Object.entries(counts).map(([face, count]) => [
    count,
    parseInt(face),
  ]);
  pairs.sort(
    (a, b) =>
      (b[0] as number) - (a[0] as number) || (b[1] as number) - (a[1] as number)
  );

  return `rolling ${n}ore${s} (${pairs.map((p) => `${p[0]}x${p[1]}`).join(',')})`;
}

// Register the roll command with the router
const commandSubs = await registerCommand(nats, {
  commandUUID: rollCommandUUID,
  commandDisplayName: rollCommandDisplayName,
  regex: '^roll\\s+',
  ratelimit: diceConfig.ratelimit || defaultRateLimit,
}, metrics);
natsSubscriptions.push(...commandSubs);

// Subscribe to command execution messages
const rollCommandSub = nats.subscribe(
  `command.execute.${rollCommandUUID}`,
  (subject, message) => {
    metrics.recordNatsSubscribe(subject);
    const startTime = Date.now();
    try {
      const data = JSON.parse(message.string());
      log.info('Received command.execute for roll', {
        producer: 'dice',
        platform: data.platform,
        instance: data.instance,
        channel: data.channel,
        user: data.user,
        originalText: data.originalText,
      });

      const args = data.text.trim();
      if (!args) {
        void sendChatMessage(nats, {
          channel: data.channel,
          network: data.network,
          instance: data.instance,
          platform: data.platform,
          text: 'What do you want me to roll? e.g. XdY+Z for X Y-sided dice adding Z to sum',
          trace: data.trace,
        }, metrics);

        metrics.recordCommand(data.platform, data.network, data.channel, 'success');
        return;
      }

      let rollResult = '';
      let found;

      found = args.match(/^(\d+)$/);
      if (found && Number(found[1]) > 0) {
        rollResult = rollPolyhedra(1, Number(found[1]));
      }

      found = args.match(/^(\d*)d(\d*)([!x])?(k-?\d+)?([+-]\d+)?$/);
      if (found && !rollResult) {
        rollResult = rollPolyhedra(
          Number(found[1] || 1),
          Number(found[2] || 6),
          Number(found[5] || 0),
          (found[3] && 1) || 0,
          (found[4] && Number(found[4].substr(1))) || 0
        );
      }

      found = args.match(/^(\d*)dF$/);
      if (found && !rollResult) {
        rollResult = rollFudge(Number(found[1]));
      }

      found = args.match(/^(\d+)ore(\d+)$/i);
      if (found && !rollResult) {
        rollResult = rollORE(Number(found[1]), Number(found[2]));
      }

      found = args.match(/^(\d+)d(\d+)\s+keep\s+(\d+)$/i);
      if (found && !rollResult) {
        rollResult = rollPolyhedra(
          Number(found[1]),
          Number(found[2]),
          0,
          0,
          Number(found[3])
        );
      }

      if (!rollResult) {
        rollResult =
          'Invalid dice notation. Try formats like: 2d6, 1d20+5, 4d6k3, 4dF, 9ore10';
      }

      void sendChatMessage(nats, {
        channel: data.channel,
        network: data.network,
        instance: data.instance,
        platform: data.platform,
        text: rollResult,
        trace: data.trace,
      }, metrics);

      metrics.recordCommand(data.platform, data.network, data.channel, 'success');
    } catch (error) {
      log.error('Failed to process roll command', {
        producer: 'dice',
        error: error,
      });

      metrics.recordCommand('unknown', 'unknown', 'unknown', 'error');
      metrics.recordError('process_error');
    } finally {
      const duration = Date.now() - startTime;
      metrics.recordProcessingTime(duration / 1000);
    }
  }
);
natsSubscriptions.push(rollCommandSub);

// Subscribe to stats.uptime and stats.emit.request
const statsSubs = registerStatsHandlers({ nats, moduleName: 'dice', startTime: moduleStartTime, metrics });
natsSubscriptions.push(...statsSubs);

// Register help information
const diceHelp: HelpEntry[] = [
  {
    command: 'roll',
    descr: 'Roll dice like a D&D nerd',
    params: [
      {
        param: 'dicenotation',
        required: true,
        descr: 'XdY+Z or XdF or XdY! or 4d6k3',
      },
    ],
  },
];

const helpSubs = await registerHelp(nats, 'dice', diceHelp, metrics);
natsSubscriptions.push(...helpSubs);
