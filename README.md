# Vice Verano

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/bongekanjing/gta6-01-brisk-owl-92/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/bongekanjing/gta6-01-brisk-owl-92/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Vice Verano is a complete, original open-world crime game that runs in a desktop browser from
static files with no network request. It is built in the spirit of GTA — a sunlit coastal city you
explore on foot and by car — but every part of it is its own: the city of Verano, its characters,
vehicles, street names, story, art and sound. Nothing is taken from Rockstar Games or any other
commercial game.

**The world.** A procedurally laid-out grid city with a shoreline, a downtown of towers, a marina,
a pier and residential blocks, crossed by a boulevard system with lane markings, kerbs, sidewalks,
grass verges, street lamps and palms.

**On foot and by car.** The player walks, sprints and jumps, and takes any car on the street by
pressing a key beside it. Driving model with acceleration, braking, reverse and steering; traffic
picks its way along the road network and yields, and pedestrians walk the pavements and panic when
you draw a weapon or drive at them.

**Police and the wanted level.** Crimes add heat, heat raises a five-star wanted level, and the
police spawn and give chase in cruisers with a flashing light bar. They pursue, they shoot, and on
foot at two stars or more they will bust you. Losing the line of sight cools the heat down.

**Missions and story.** A chain of named missions with briefs, objectives and rewards — *Wake Up
Call*, *The Drop*, *Wrong Turn* and more — each with a target landmark, a minimap marker and a
payout on completion.

**Combat, HUD, save.** A hitscan weapon with a crosshair, health and armour, and money. The HUD
carries a circular health dial, the cash counter, the wanted stars, the active mission card, a
speedometer and a live minimap with a player arrow, a compass and objective markers. Progress
autosaves to `localStorage`, and the game opens on a title screen and can be restarted.

**Presentation.** three.js renders a low-poly, flat-shaded city with directional sunlight and cast
shadows; the HUD is drawn on a second 2D canvas over it. A small procedural audio layer covers
engines, impacts and the siren.

## Run it

```sh
cd game && python3 -m http.server 8080
# then open http://localhost:8080/ in desktop Chrome
```

To hand the entry in the way the bounty expects (copies `game/` and `screenshots/` to `/output`
and writes `dossier.json`):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Layout

| path | job |
| --- | --- |
| `main.ts` | the program: copies `game/` and `screenshots/`, writes `dossier.json` |
| `game/index.html` | the page, its canvases and its styles |
| `game/src/main.js` | boot, the fixed-step loop, the title and restart screens |
| `game/src/sim.js` | the simulation: player, traffic, pedestrians, police, combat, missions |
| `game/src/city.js` | the city layout and the road network |
| `game/src/world.js` | missions, landmarks and the world's rules |
| `game/src/render.js` | three.js scene, meshes and camera |
| `game/src/hud.js` | the HUD and minimap on the 2D canvas |
| `game/src/shots.js` | the staged screenshot scenes |
| `game/src/config.js` | the tuned constants |
| `vendor/makefun-game.ts` | the kit's dossier library, unchanged |

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
