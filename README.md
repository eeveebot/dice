# dice

Virtual dice roller with D&D style dice notation support.

## Usage

.roll XdY[+Z][-Z][!][kN]
- X = number of dice
- Y = number of sides
- +Z/-Z = modifier to add/subtract from total
- ! = exploding dice (reroll max values)
- kN = keep highest N dice
- kdN = keep lowest N dice (drop highest)

### Examples

- `.roll 2d6` - Roll two 6-sided dice
- `.roll 1d20+5` - Roll a d20 and add 5
- `.roll 4d6k3` - Roll four 6-sided dice, keep the highest 3
- `.roll 2d20k1` - Roll with advantage (keep highest of 2 d20s)
- `.roll 2d20kd1` - Roll with disadvantage (keep lowest of 2 d20s)
- `.roll 3d6!` - Roll three 6-sided dice with exploding 6s
- `.roll 4dF` - Roll four Fudge dice
- `.roll 9ore10` - Roll nine ORE-style dice with 10 sides

## Features

- Standard polyhedral dice (d4, d6, d8, d10, d12, d20, etc.)
- Dice modifiers (+/- values)
- Exploding dice
- Keep/drop highest/lowest dice
- Fudge dice (dF)
- ORE-style dice rolling
- Configurable rate limits and throttling
- Support for multiple platforms and networks