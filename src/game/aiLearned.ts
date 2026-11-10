/** written by `npm run lab` (scripts/battle-lab.mjs) — don't edit by hand; run it again after balance changes */
import type { LearnedData } from './aiLab';

export const AI_LEARNED: LearnedData | null = {
    "hash": "207641bb",
    "generated": "2026-11-10",
    "battles": 4850,
    "unitValue": {
        "dwarf": -52.7,
        "goblin": 101.9,
        "hammerer": -173.8,
        "ogre": 114.3,
        "archer": -574.7,
        "wizard": -159.7,
        "crowRider": 154.5,
        "mortar": -328.9,
        "prismCannon": -328.1,
        "ballista": 1247.2
    },
    "counters": {
        "dwarf": {
            "goblin": 400,
            "hammerer": -560,
            "ogre": -960,
            "archer": 400,
            "wizard": 454,
            "crowRider": -960,
            "mortar": -360,
            "prismCannon": 444.8,
            "ballista": -880
        },
        "goblin": {
            "dwarf": -400,
            "hammerer": -560,
            "ogre": 158.2,
            "archer": 369.2,
            "wizard": 404,
            "crowRider": -510,
            "mortar": -960,
            "prismCannon": 133.4,
            "ballista": -1920
        },
        "hammerer": {
            "dwarf": 560,
            "goblin": 560,
            "ogre": -960,
            "archer": -560,
            "wizard": -1300,
            "crowRider": -960,
            "mortar": -50,
            "prismCannon": -880,
            "ballista": -1920
        },
        "ogre": {
            "dwarf": 960,
            "goblin": -158.2,
            "hammerer": 960,
            "archer": 960,
            "wizard": 960,
            "crowRider": -960,
            "mortar": 960,
            "prismCannon": 480,
            "ballista": -960
        },
        "archer": {
            "dwarf": -400,
            "goblin": -369.2,
            "hammerer": 560,
            "ogre": -960,
            "wizard": -1200,
            "crowRider": 560,
            "mortar": -900,
            "prismCannon": -640,
            "ballista": -1920
        },
        "wizard": {
            "dwarf": -454,
            "goblin": -404,
            "hammerer": 1300,
            "ogre": -960,
            "archer": 1200,
            "crowRider": -960,
            "mortar": -890,
            "prismCannon": 1840,
            "ballista": -1920
        },
        "crowRider": {
            "dwarf": 960,
            "goblin": 510,
            "hammerer": 960,
            "ogre": 960,
            "archer": -560,
            "wizard": 960,
            "mortar": 960,
            "prismCannon": 120,
            "ballista": 960
        },
        "mortar": {
            "dwarf": 360,
            "goblin": 960,
            "hammerer": 50,
            "ogre": -960,
            "archer": 900,
            "wizard": 890,
            "crowRider": -960,
            "prismCannon": 830,
            "ballista": -1920
        },
        "prismCannon": {
            "dwarf": -444.8,
            "goblin": -133.4,
            "hammerer": 880,
            "ogre": -480,
            "archer": 640,
            "wizard": -1840,
            "crowRider": -120,
            "mortar": -830,
            "ballista": -1920
        },
        "ballista": {
            "dwarf": 880,
            "goblin": 1920,
            "hammerer": 1920,
            "ogre": 960,
            "archer": 1920,
            "wizard": 1920,
            "crowRider": -960,
            "mortar": 1920,
            "prismCannon": 1920
        }
    },
    "formations": {
        "line": -18.3,
        "block": -47.1,
        "flanks": -25.9,
        "back": 32.2,
        "sorted": -73.7,
        "left": 132.7
    },
    "mixes": [
        {
            "budget": 1000,
            "formation": "flanks",
            "shares": {
                "ballista": 0.9,
                "goblin": 0.1
            },
            "score": 834.4
        },
        {
            "budget": 1000,
            "formation": "left",
            "shares": {
                "ballista": 0.6,
                "crowRider": 0.2,
                "dwarf": 0.1,
                "goblin": 0.1
            },
            "score": 791.6
        },
        {
            "budget": 1000,
            "formation": "flanks",
            "shares": {
                "ballista": 0.8,
                "goblin": 0.1,
                "dwarf": 0.1
            },
            "score": 665.8
        },
        {
            "budget": 2500,
            "formation": "sorted",
            "shares": {
                "crowRider": 0.52,
                "ballista": 0.44,
                "archer": 0.04
            },
            "score": 632
        },
        {
            "budget": 2500,
            "formation": "sorted",
            "shares": {
                "ballista": 0.36,
                "goblin": 0.34,
                "crowRider": 0.24,
                "archer": 0.06
            },
            "score": 604.2
        },
        {
            "budget": 2500,
            "formation": "sorted",
            "shares": {
                "ballista": 0.56,
                "crowRider": 0.4,
                "archer": 0.04
            },
            "score": 566
        },
        {
            "budget": 5000,
            "formation": "flanks",
            "shares": {
                "prismCannon": 0.72,
                "ballista": 0.28
            },
            "score": 608
        },
        {
            "budget": 5000,
            "formation": "flanks",
            "shares": {
                "prismCannon": 0.63,
                "ballista": 0.29,
                "ogre": 0.08
            },
            "score": 576
        },
        {
            "budget": 5000,
            "formation": "flanks",
            "shares": {
                "prismCannon": 0.51,
                "ballista": 0.49
            },
            "score": 560
        }
    ]
};
