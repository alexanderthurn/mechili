import { Application, Text } from 'pixi.js';

const app = new Application();
await app.init({ background: '#080820', resizeTo: window });
document.body.appendChild(app.canvas);

const title = new Text({
    text: 'MECHILI',
    style: {
        fill: 0x00ffff,
        fontSize: 96,
        fontWeight: 'bold',
        letterSpacing: 12,
    },
});
title.anchor.set(0.5);
app.stage.addChild(title);

const subtitle = new Text({
    text: 'coming soon',
    style: {
        fill: 0xaa00ff,
        fontSize: 32,
        letterSpacing: 6,
    },
});
subtitle.anchor.set(0.5);
app.stage.addChild(subtitle);

function layout() {
    title.position.set(app.screen.width / 2, app.screen.height / 2 - 30);
    subtitle.position.set(app.screen.width / 2, app.screen.height / 2 + 60);
}
layout();
app.renderer.on('resize', layout);

let t = 0;
app.ticker.add((ticker) => {
    t += ticker.deltaMS / 1000;
    subtitle.alpha = 0.55 + 0.45 * Math.sin(t * 2);
});
