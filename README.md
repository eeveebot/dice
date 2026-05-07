# dice

> Virtual dice roller with D&D-style dice notation support.

## Overview

The dice module provides chat-based dice rolling for the eevee ecosystem. It parses standard tabletop RPG dice notation and returns results directly in chat, making it useful for TTRPG sessions, play-by-post games, or any time you need random numbers with style.

The module integrates with eevee's router via NATS, registering a `roll` command that handles parsing, rolling, and responding. It supports standard polyhedral dice, Fudge dice, ORE (One-Roll Engine) dice, and common modifiers like exploding dice and keep/drop.

Configuration is loaded through eevee's shared module config system, allowing per-network rate limiting and roll limits without code changes.

## Features

- **Standard polyhedral dice** — any combination of dice count and sides (`2d6`, `1d20`, `3d8`, etc.)
- **Modifiers** — add or subtract a flat value from the total (`1d20+5`, `2d6-2`)
- **Exploding dice** — reroll and add when max (or min) is rolled (`3d6!`)
- **Keep/drop** — keep highest N or drop highest N dice (`4d6k3`, `2d20kd1`)
- **Fudge dice** — rolling `+`, `o`, `-` faces with summed results (`4dF`)
- **ORE-style dice** — One-Roll Engine format showing matching sets (`9ore10`)
- **Shorthand** — bare number rolls a single die (`.roll 20` = `1d20`)
- **Configurable limits** — max dice count and max sides to prevent abuse
- **Rate limiting** — per-network throttling via libeevee's rate limit system
- **Multi-platform** — works across all eevee chat connectors (IRC, Discord, etc.)

## Install

This module is part of the eevee ecosystem and is not published independently.

```bash
# From the eevee project root
cd dice
npm install
```

## Configuration

The dice module reads its configuration from eevee's shared module config system. No environment variables beyond the standard eevee ones are required.

### Options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `ratelimit` | `RateLimitConfig` | libeevee default | Rate limiting for the `roll` command |
| `maxDice` | `number` | `64` | Maximum number of dice in a single roll |
| `maxSides` | `number` | `65535` | Maximum number of sides per die |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HTTP_API_PORT` | `9000` | Port for metrics and health check HTTP server |

## Usage / Commands

### `.roll <notation>`

Roll dice using standard notation and return the result in chat.

#### Standard Polyhedral

```
.roll 2d6
→ rolling 2d6 (3,5) 8
```

```
.roll 1d20+5
→ rolling 1d20+5 (17) 22
```

#### Shorthand (bare number = 1dN)

```
.roll 20
→ rolling 1d20 (14) 14
```

#### Keep Highest / Drop Highest

```
.roll 4d6k3
→ rolling 4d6k3 (2,5,4,6) 15
```

```
.roll 2d20k1
→ rolling 2d20k1 (8,15) 15    (advantage)
```

```
.roll 2d20kd1
→ rolling 2d20d1 (12,4) 4     (disadvantage)
```

#### Exploding Dice

```
.roll 3d6!
→ rolling 3d6! (6,2,6,4,3) 21
```

#### Fudge Dice

```
.roll 4dF
→ rolling 4dF (+,o,-,+) 1
```

#### ORE (One-Roll Engine)

```
.roll 9ore10
→ rolling 9ore10 (3x7,2x4,1x2,1x6,1x9,1x3)
```

#### Keep syntax (alternate)

```
.roll 4d6 keep 3
→ rolling 4d6k3 (1,6,3,5) 14
```

#### No argument

```
.roll
→ What do you want me to roll? e.g. XdY+Z for X Y-sided dice adding Z to sum
```

#### Invalid notation

```
.roll abc
→ Invalid dice notation. Try formats like: 2d6, 1d20+5, 4d6k3, 4dF, 9ore10
```

### Notation Reference

| Notation | Meaning |
|----------|---------|
| `XdY` | Roll X dice with Y sides each |
| `XdY+Z` | Roll and add modifier Z |
| `XdY-Z` | Roll and subtract modifier Z |
| `XdY!` | Exploding dice (reroll on max) |
| `XdYkN` | Keep highest N dice |
| `XdYkdN` | Keep lowest N dice (drop highest) |
| `XdF` | Roll X Fudge dice |
| `XoreY` | Roll X ORE-style dice with Y sides |
| `N` | Shorthand for `1dN` |

## Architecture

```
┌──────────┐    NATS     ┌──────────┐
│  router  │────────────▶│   dice   │
└──────────┘             └──────────┘
                               │
                         ┌─────┴─────┐
                         │           │
                    ┌────▼───┐  ┌───▼────┐
                    │ parser │  │ roller │
                    └────────┘  └────────┘
```

The dice module follows the standard eevee module lifecycle:

1. **Startup** — Loads config, establishes NATS connection, registers the `roll` command with the router, registers help entries, and starts the HTTP metrics server.
2. **Command handling** — Listens on `command.execute.<UUID>` for incoming roll commands. Parses the dice notation, executes the roll, and sends the result back via `sendChatMessage`.
3. **Shutdown** — Graceful shutdown is handled by libeevee's `registerGracefulShutdown`, which drains NATS connections cleanly.

The parser matches notation against a series of regular expressions in priority order: bare number → standard polyhedral (with optional explode/keep/modifier) → Fudge → ORE → alternate keep syntax. The first match wins.

Rolling functions (`rollPolyhedra`, `rollFudge`, `rollORE`) are pure logic — they accept parameters and return formatted strings. All limits (`maxDice`, `maxSides`) are enforced inside the rolling functions.

## Development

```bash
# Install dependencies
npm install

# Lint
npm test

# Build (lint + compile)
npm run build

# Run locally
npm run dev
```

The module requires Node.js ≥ 24.0.0 and depends on `@eeveebot/libeevee` for NATS messaging, metrics, rate limiting, and configuration.

## Contributing

Contributions are welcome! Bug reports and feature requests can be filed at the module's repository.

## License

[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — see [LICENSE](./LICENSE) for the full text.
