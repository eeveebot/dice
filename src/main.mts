'use strict';

// Dice module
// provides D&D style dice rolling functionality

import fs from 'node:fs';
import yaml from 'js-yaml';
import { NatsClient, log } from '@eeveebot/libeevee';

// Record module startup time for uptime tracking
const moduleStartTime = Date.now();

const rollCommandUUID = '8D4E1F4C-7D9A-4C2B-8F3E-5A7B2C9D1E6F';
const rollCommandDisplayName = 'roll';

// Rate limit configuration interface
interface RateLimitConfig {
  mode: 'enqueue' | 'drop';
  level: 'channel' | 'user' | 'global';
  limit: number;
  interval: string; // e.g., "30s", "1m", "5m"
}

// Dice module configuration interface
interface DiceConfig {
  ratelimit?: RateLimitConfig;
  // Maximum number of dice that can be rolled at once
  maxDice?: number;
  // Maximum number of sides on a die
  maxSides?: number;
}

const natsClients: InstanceType<typeof NatsClient>[] = [];
const natsSubscriptions: Array<Promise<string | boolean>> = [];

/**
 * Load dice configuration from YAML file
 * @returns DiceConfig parsed from YAML file
 */
function loadDiceConfig(): DiceConfig {
  // Get the config file path from environment variable
  const configPath = process.env.MODULE_CONFIG_PATH;
  if (!configPath) {
    log.warn('MODULE_CONFIG_PATH not set, using default config', {
      producer: 'dice',
    });
    return {};
  }

  try {
    // Read the YAML file
    const configFile = fs.readFileSync(configPath, 'utf8');

    // Parse the YAML content
    const config = yaml.load(configFile) as DiceConfig;

    log.info('Loaded dice configuration', {
      producer: 'dice',
      configPath,
    });

    return config;
  } catch (error) {
    log.error('Failed to load dice configuration, using defaults', {
      producer: 'dice',
      configPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

//
// Do whatever teardown is necessary before calling common handler
process.on('SIGINT', () => {
  natsClients.forEach((natsClient) => {
    void natsClient.drain();
  });
});

process.on('SIGTERM', () => {
  natsClients.forEach((natsClient) => {
    void natsClient.drain();
  });
});

//
// Setup NATS connection

// Get host and token
const natsHost = process.env.NATS_HOST || false;
if (!natsHost) {
  const msg = 'environment variable NATS_HOST is not set.';
  throw new Error(msg);
}

const natsToken = process.env.NATS_TOKEN || false;
if (!natsToken) {
  const msg = 'environment variable NATS_TOKEN is not set.';
  throw new Error(msg);
}

const nats = new NatsClient({
  natsHost: natsHost as string,
  natsToken: natsToken as string,
});
natsClients.push(nats);
await nats.connect();

// Load configuration at startup
const diceConfig = loadDiceConfig();

// Default configuration
const defaultMaxDice = 64;
const defaultMaxSides = 65535;

// Use configured values or defaults
const maxDice = diceConfig.maxDice ?? defaultMaxDice;
const maxSides = diceConfig.maxSides ?? defaultMaxSides;

// Utility function to sum an array of numbers
const sum = (arr: number[]): number => arr.reduce((a, b) => a + b, 0);

/**
 * Roll polyhedral dice with various options
 * @param n Number of dice
 * @param s Number of sides on each die
 * @param b Bonus to add to the sum
 * @param x Exploding dice threshold
 * @param k Number of dice to keep
 * @returns Formatted string with roll results
 */
function rollPolyhedra(
  n: number = 2,
  s: number = 6,
  b: number = 0,
  x: number = 0,
  k: number = 0
): string {
  // Sanitize all inputs
  n = Math.round(Math.min(n, maxDice));
  s = Math.round(Math.min(s, maxSides));
  b = Math.round(Math.min(b, maxSides));

  if (x < 0) x = -1 * Math.round(Math.min(s, Math.abs(x)));
  else if (x > 0) x = Math.min(s, x);

  k = Math.round(Math.min(n, k));

  // Build the reply with what we're rolling
  let text = `rolling ${n}d${s}`;
  if (x !== 0) text += '!';
  if (k > 0) text += `k${k}`;
  else if (k < 0) text += `d${-1 * k}`;
  if (b > 0) text += `+${b}`;
  else if (b < 0) text += `${b}`;

  // Roll the dice
  // eslint-disable-next-line prefer-const
  let rolled: number[] = [...Array(n)].map(() => Math.ceil(Math.random() * s));
  const keep: number[] = [];

  // Handle exploding dice
  while (rolled.length > 0) {
    if (x > 0 && rolled[0] > s - x) {
      rolled.push(Math.ceil(Math.random() * s));
    } else if (x < 0 && rolled[0] <= Math.abs(x)) {
      rolled.push(Math.ceil(Math.random() * s));
    }
    keep.push(rolled.shift() as number);

    // Prevent infinite loops
    if (keep.length >= maxDice) break;
  }

  // Handle keeping/dropping dice
  if (k !== 0) {
    keep.sort((a, b) => a - b);
    if (k > 0) keep.reverse();
    while (keep.length > Math.abs(k)) keep.pop();
  }

  return `${text} (${keep.join(',')}) ${sum(keep) + b}`;
}

/**
 * Roll Fudge dice
 * @param n Number of Fudge dice (default 4)
 * @returns Formatted string with roll results
 */
function rollFudge(n: number = 4): string {
  n = Math.round(Math.min(n, maxDice));
  const faces = ['-', 'o', '+'];
  const rolled = [...Array(n)].map(() => Math.floor(Math.random() * 3));
  const values = rolled.map((r) => r - 1); // Convert to [-1, 0, 1]

  return `rolling ${n}dF (${rolled.map((r) => faces[r]).join(',')}) ${sum(values)}`;
}

/**
 * Roll ORE-style dice
 * @param n Number of dice
 * @param s Number of sides
 * @returns Formatted string with roll results
 */
function rollORE(n: number = 9, s: number = 10): string {
  n = Math.round(Math.min(n, maxDice));
  s = Math.round(Math.min(s, maxSides));

  // Quirk of ORE: you mustn't roll more dice than faces
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

// Function to register the roll command with the router
async function registerRollCommand(): Promise<void> {
  // Default rate limit configuration
  const defaultRateLimit = {
    mode: 'drop',
    level: 'user',
    limit: 5,
    interval: '1m',
  };

  // Use configured rate limit or default
  const rateLimitConfig = diceConfig.ratelimit || defaultRateLimit;

  const commandRegistration = {
    type: 'command.register',
    commandUUID: rollCommandUUID,
    commandDisplayName: rollCommandDisplayName,
    platform: '.*', // Match all platforms
    network: '.*', // Match all networks
    instance: '.*', // Match all instances
    channel: '.*', // Match all channels
    user: '.*', // Match all users
    regex: '^roll ', // Match roll command
    platformPrefixAllowed: true,
    ratelimit: rateLimitConfig,
  };

  try {
    await nats.publish('command.register', JSON.stringify(commandRegistration));
    log.info('Registered roll command with router', {
      producer: 'dice',
      ratelimit: rateLimitConfig,
    });
  } catch (error) {
    log.error('Failed to register roll command', {
      producer: 'dice',
      error: error,
    });
  }
}

// Register commands at startup
await registerRollCommand();

// Subscribe to command execution messages
const rollCommandSub = nats.subscribe(
  `command.execute.${rollCommandUUID}`,
  (subject, message) => {
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

      // Parse the dice notation
      const args = data.text.trim();
      if (!args) {
        const response = {
          channel: data.channel,
          network: data.network,
          instance: data.instance,
          platform: data.platform,
          text: 'What do you want me to roll? e.g. XdY+Z for X Y-sided dice adding Z to sum',
          trace: data.trace,
          type: 'message.outgoing',
        };

        const outgoingTopic = `chat.message.outgoing.${data.platform}.${data.instance}.${data.channel}`;
        void nats.publish(outgoingTopic, JSON.stringify(response));
        return;
      }

      let rollResult = '';
      let found;

      // Handle simple number (e.g., "100" => 1d100)
      found = args.match(/^(\d+)$/);
      if (found && Number(found[1]) > 0) {
        rollResult = rollPolyhedra(1, Number(found[1]));
      }

      // Handle standard dice notation (e.g., "2d6", "2d6+2", "4d6k1", "3d6!")
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

      // Handle Fudge dice (e.g., "4dF")
      found = args.match(/^(\d*)dF$/);
      if (found && !rollResult) {
        rollResult = rollFudge(Number(found[1]));
      }

      // Handle ORE dice (e.g., "9ore10")
      found = args.match(/^(\d+)ore(\d+)$/i);
      if (found && !rollResult) {
        rollResult = rollORE(Number(found[1]), Number(found[2]));
      }

      // Handle "X dY keep Z" format (e.g., "4d6 keep 3")
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

      // If no valid format was found, provide help
      if (!rollResult) {
        rollResult =
          'Invalid dice notation. Try formats like: 2d6, 1d20+5, 4d6k3, 4dF, 9ore10';
      }

      // Send response
      const response = {
        channel: data.channel,
        network: data.network,
        instance: data.instance,
        platform: data.platform,
        text: rollResult,
        trace: data.trace,
        type: 'message.outgoing',
      };

      const outgoingTopic = `chat.message.outgoing.${data.platform}.${data.instance}.${data.channel}`;
      void nats.publish(outgoingTopic, JSON.stringify(response));
    } catch (error) {
      log.error('Failed to process roll command', {
        producer: 'dice',
        error: error,
      });
    }
  }
);
natsSubscriptions.push(rollCommandSub);

// Subscribe to control messages for re-registering commands
const controlSubRegisterCommandRoll = nats.subscribe(
  `control.registerCommands.${rollCommandDisplayName}`,
  () => {
    log.info(
      `Received control.registerCommands.${rollCommandDisplayName} control message`,
      {
        producer: 'dice',
      }
    );
    void registerRollCommand();
  }
);
natsSubscriptions.push(controlSubRegisterCommandRoll);

const controlSubRegisterCommandAll = nats.subscribe(
  'control.registerCommands',
  () => {
    log.info('Received control.registerCommands control message', {
      producer: 'dice',
    });
    void registerRollCommand();
  }
);
natsSubscriptions.push(controlSubRegisterCommandAll);

// Subscribe to stats.uptime messages and respond with module uptime
const statsUptimeSub = nats.subscribe('stats.uptime', (subject, message) => {
  try {
    const data = JSON.parse(message.string());
    log.info('Received stats.uptime request', {
      producer: 'dice',
      replyChannel: data.replyChannel,
    });

    // Calculate uptime in milliseconds
    const uptime = Date.now() - moduleStartTime;

    // Send uptime back via the ephemeral reply channel
    const uptimeResponse = {
      module: 'dice',
      uptime: uptime,
      uptimeFormatted: `${Math.floor(uptime / 86400000)}d ${Math.floor((uptime % 86400000) / 3600000)}h ${Math.floor((uptime % 3600000) / 60000)}m ${Math.floor((uptime % 60000) / 1000)}s`,
    };

    if (data.replyChannel) {
      void nats.publish(data.replyChannel, JSON.stringify(uptimeResponse));
    }
  } catch (error) {
    log.error('Failed to process stats.uptime request', {
      producer: 'dice',
      error: error,
    });
  }
});
natsSubscriptions.push(statsUptimeSub);

// Help information for dice commands
const diceHelp = [
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

// Function to publish help information
async function publishHelp(): Promise<void> {
  const helpUpdate = {
    from: 'dice',
    help: diceHelp,
  };

  try {
    await nats.publish('_help.update', JSON.stringify(helpUpdate));
    log.info('Published dice help information', {
      producer: 'dice',
    });
  } catch (error) {
    log.error('Failed to publish dice help information', {
      producer: 'dice',
      error: error,
    });
  }
}

// Publish help information at startup
await publishHelp();

// Subscribe to help update requests
const helpUpdateRequestSub = nats.subscribe('_help.updateRequest', () => {
  log.info('Received _help.updateRequest message', {
    producer: 'dice',
  });
  void publishHelp();
});
natsSubscriptions.push(helpUpdateRequestSub);
