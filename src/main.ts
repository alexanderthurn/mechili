import { Application, Container, Text } from 'pixi.js';
import { Game } from './game/game';

// layered setup: three.js world canvas below, transparent Pixi UI canvas on top
const wrapper = document.createElement('div');
wrapper.style.cssText = 'position:fixed;inset:0;overflow:hidden;';

const threeCanvas = document.createElement('canvas');
threeCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
wrapper.appendChild(threeCanvas);

// the wrapper must be in the DOM before init so resizeTo measures its real size
document.body.appendChild(wrapper);

const app = new Application();
await app.init({ backgroundAlpha: 0, resizeTo: wrapper, antialias: true });
// don't touch width/height styles — Pixi's resize handling owns those
app.canvas.style.position = 'absolute';
app.canvas.style.inset = '0';
wrapper.appendChild(app.canvas);

const title = new Container();

const heading = new Text({
    text: 'MECHILI',
    style: {
        fill: 0x00ffff,
        fontSize: 96,
        fontWeight: 'bold',
        letterSpacing: 12,
    },
});
heading.anchor.set(0.5);
title.addChild(heading);

const subtitle = new Text({
    text: 'click to deploy',
    style: {
        fill: 0xaa00ff,
        fontSize: 32,
        letterSpacing: 6,
    },
});
subtitle.anchor.set(0.5);
title.addChild(subtitle);

app.stage.addChild(title);

function layoutTitle() {
    heading.position.set(app.screen.width / 2, app.screen.height / 2 - 30);
    subtitle.position.set(app.screen.width / 2, app.screen.height / 2 + 60);
}
layoutTitle();
app.renderer.on('resize', layoutTitle);

let t = 0;
const pulse = (ticker: { deltaMS: number }) => {
    t += ticker.deltaMS / 1000;
    subtitle.alpha = 0.55 + 0.45 * Math.sin(t * 2);
};
app.ticker.add(pulse);

let started = false;
function start() {
    if (started) return;
    started = true;
    window.removeEventListener('keydown', onKey);
    app.renderer.off('resize', layoutTitle);
    app.ticker.remove(pulse);
    title.destroy({ children: true });
    new Game(app, threeCanvas, wrapper);
}

function onKey(e: KeyboardEvent) {
    if (e.code === 'Enter' || e.code === 'Space') start();
}

app.canvas.addEventListener('pointerdown', start, { once: true });
window.addEventListener('keydown', onKey);
