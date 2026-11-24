// The HUD, drawn on a 2D canvas over the WebGL view: the health and armour arcs, the money and
// wanted stars, the mission card, the speedometer while driving, and the rotating minimap with the
// roads, the player, the police and the mission marker. Everything is drawn from the simulation's
// state each frame, so nothing here can drift from the game.
import { HALF_SPAN, POLICE } from './config.js';
import { MODE_CAR } from './sim.js';
import { CITY_NAME, LANDMARKS, ROAD_CENTRES } from './city.js';

const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';

export function createHud(canvas) {
  const ctx = canvas.getContext('2d');
  let width = 1;
  let height = 1;

  function resize(w, h) {
    // Draw in CSS pixels, with the backing store scaled for sharpness.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    width = w;
    height = h;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shadowed(text, x, y, size, color, align = 'left', weight = '700') {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(text, x + 1.5, y + 1.5);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /** Wrap a line of text to maxWidth, drawing at most maxLines rows. Returns the rows drawn. */
  function wrapText(text, x, y, maxWidth, lineHeight, size, color, maxLines = 2) {
    ctx.font = `400 ${size}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    const words = String(text).split(/\s+/);
    let line = '';
    let row = 0;
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        ctx.fillText(line, x, y + row * lineHeight);
        row += 1;
        line = word;
        if (row >= maxLines) return row;
      } else {
        line = next;
      }
    }
    if (line && row < maxLines) {
      ctx.fillText(line, x, y + row * lineHeight);
      row += 1;
    }
    return row;
  }

  /** The health arc plus the armour arc, bottom-left, the way a crime game does it. */
  function drawVitals(p) {
    const cx = 84;
    const cy = height - 84;
    const r = 44;
    ctx.save();
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';

    ctx.strokeStyle = 'rgba(8,12,18,0.62)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 0.72, Math.PI * 2.28);
    ctx.stroke();

    const health = Math.max(0, p.health) / 100;
    const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    grad.addColorStop(0, health > 0.35 ? '#4fe08a' : '#ff5c5c');
    grad.addColorStop(1, health > 0.35 ? '#a8f0c4' : '#ff9a9a');
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 0.72, Math.PI * (0.72 + 1.56 * health));
    ctx.stroke();

    if (p.armour > 0) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(120,200,255,0.92)';
      ctx.beginPath();
      ctx.arc(cx, cy, r - 10, Math.PI * 0.72, Math.PI * (0.72 + 1.56 * (p.armour / 100)));
      ctx.stroke();
    }

    shadowed(`${Math.round(p.health)}`, cx, cy + 8, 22, '#ffffff', 'center');
    // A small label under the ring so the number is not ambiguous against the speedometer.
    shadowed('HP', cx, cy - 26, 11, 'rgba(255,255,255,0.55)', 'center', '700');
    ctx.restore();
  }

  /** A five-pointed star. */
  function star(cx, cy, outer, inner, fill) {
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const r = i % 2 === 0 ? outer : inner;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawWanted(p) {
    for (let i = 0; i < POLICE.maxStars; i += 1) {
      const x = 58 + i * 30;
      const y = 46;
      const on = i < p.wanted;
      star(x, y, 12, 5.2, on ? '#ffd166' : 'rgba(6,10,16,0.7)');
      ctx.strokeStyle = on ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.34)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }

  function drawMoney(p) {
    shadowed(`$${p.money.toLocaleString('en-US')}`, width - 28, 56, 30, '#8ef0a8', 'right');
  }

  function drawMission(m) {
    const pad = 22;
    const w = 336;
    const h = 96;
    const x = width - w - pad;
    const y = 82;
    roundRect(x, y, w, h, 12);
    ctx.fillStyle = 'rgba(10,16,24,0.58)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,209,102,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const mission = m.current;
    if (!mission) {
      shadowed('ALL MISSIONS CLEAR', x + 16, y + 34, 17, '#8ef0a8');
      shadowed(`${CITY_NAME} is yours.`, x + 16, y + 60, 14, 'rgba(255,255,255,0.7)', 'left', '400');
      return;
    }
    shadowed('MISSION', x + 16, y + 26, 12, '#ffd166', 'left', '700');
    shadowed(mission.name, x + 16, y + 50, 19, '#ffffff');
    // Wrap inside the panel: the briefs are longer than the box, and canvas text does not clip
    // gracefully — it just runs off the edge of the screen.
    wrapText(mission.brief, x + 16, y + 72, w - 32, 15, 12, 'rgba(255,255,255,0.8)');
  }

  function drawSpeed(car) {
    if (!car) return;
    const kmh = Math.round(Math.abs(car.speed) * 3.6);
    // Sits to the left of the minimap, which owns the bottom-right corner.
    const cx = width - 208 - 66;
    const cy = height - 56;
    roundRect(cx - 52, cy - 34, 104, 58, 10);
    ctx.fillStyle = 'rgba(10,16,24,0.55)';
    ctx.fill();
    shadowed(`${kmh}`, cx + 4, cy + 8, 28, '#ffffff', 'right');
    shadowed('km/h', cx + 10, cy + 8, 12, 'rgba(255,255,255,0.65)', 'left', '600');
  }

  /**
   * The minimap: a square window on the city that turns with the player. Roads are drawn from the
   * same grid the city is built on, so the map and the world always agree.
   */
  function drawMinimap(p, cars, cops, mission) {
    const size = 186;
    const x = width - size - 22;
    const y = height - size - 22;
    const scale = size / 300;

    ctx.save();
    roundRect(x, y, size, size, 14);
    ctx.fillStyle = 'rgba(9,14,20,0.62)';
    ctx.fill();
    ctx.clip();

    ctx.translate(x + size / 2, y + size / 2);
    ctx.rotate(-p.angle);

    // Roads: a thick line per centre, on both axes.
    ctx.strokeStyle = 'rgba(150,170,190,0.34)';
    ctx.lineWidth = 5;
    for (const c of ROAD_CENTRES) {
      const ox = (c - p.x) * scale;
      const oz = (c - p.z) * scale;
      ctx.beginPath();
      ctx.moveTo(-size, oz);
      ctx.lineTo(size, oz);
      ctx.moveTo(ox, -size);
      ctx.lineTo(ox, size);
      ctx.stroke();
    }

    // A yellow line for the road the player is on.
    ctx.strokeStyle = 'rgba(255,209,102,0.55)';
    ctx.lineWidth = 2;
    for (const c of ROAD_CENTRES) {
      if (Math.abs(p.x - c) < 12) {
        ctx.beginPath();
        ctx.moveTo((c - p.x) * scale, -size);
        ctx.lineTo((c - p.x) * scale, size);
        ctx.stroke();
      }
      if (Math.abs(p.z - c) < 12) {
        ctx.beginPath();
        ctx.moveTo(-size, (c - p.z) * scale);
        ctx.lineTo(size, (c - p.z) * scale);
        ctx.stroke();
      }
    }

    // Traffic as small light dots: the city feels alive at a glance.
    ctx.fillStyle = 'rgba(210,225,240,0.5)';
    for (const car of cars) {
      if (!car.alive || car.kind === 'player') continue;
      ctx.fillRect((car.x - p.x) * scale - 1.4, (car.z - p.z) * scale - 1.4, 2.8, 2.8);
    }

    // Police blips, red and pulsing.
    for (const cop of cops) {
      ctx.beginPath();
      ctx.fillStyle = '#ff3b52';
      ctx.arc((cop.x - p.x) * scale, (cop.z - p.z) * scale, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // The mission marker, a gold diamond, plus an edge arrow when it is off the map.
    if (mission) {
      const mx = (mission.x - p.x) * scale;
      const mz = (mission.z - p.z) * scale;
      ctx.save();
      ctx.fillStyle = '#ffd166';
      ctx.translate(mx, mz);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
    }

    ctx.restore();

    // The player arrow is drawn in screen space, always pointing up.
    ctx.save();
    ctx.translate(x + size / 2, y + size / 2);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    roundRect(x, y, size, size, 14);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // A compass letter so the map reads as a map.
    shadowed('N', x + size - 14, y + 22, 13, 'rgba(255,255,255,0.5)', 'right', '700');
  }

  /**
   * The key-art lockup: a vignette to focus the frame, a big gradient wordmark and a tagline. Drawn
   * on the HUD canvas so the cover shot needs no DOM overlay.
   */
  function drawCoverTitle() {
    const g = ctx.createRadialGradient(width * 0.5, height * 0.44, height * 0.15, width * 0.5, height * 0.44, height * 0.92);
    g.addColorStop(0, 'rgba(8,12,20,0)');
    g.addColorStop(1, 'rgba(8,12,20,0.62)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);

    const cx = width * 0.5;
    const titleY = height * 0.3;
    // A soft dark band behind the lockup: the wordmark crosses both a bright facade and pale sky,
    // so without a scrim the right half of the title loses its edge.
    const band = ctx.createLinearGradient(0, titleY - height * 0.16, 0, titleY + height * 0.14);
    band.addColorStop(0, 'rgba(8,12,20,0)');
    band.addColorStop(0.42, 'rgba(8,12,20,0.5)');
    band.addColorStop(1, 'rgba(8,12,20,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, titleY - height * 0.16, width, height * 0.3);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `800 ${Math.round(width * 0.082)}px ${FONT}`;
    ctx.save();
    ctx.shadowColor = 'rgba(255,120,70,0.45)';
    ctx.shadowBlur = 42;
    const grad = ctx.createLinearGradient(0, 0, width, 0);
    // Warm on the left, cool on the right: a gradient running from dark to light is exactly wrong
    // here, because the right half of the frame is the bright facade.
    grad.addColorStop(0, '#fff4d0');
    grad.addColorStop(0.45, '#ffab60');
    grad.addColorStop(1, '#f2607f');
    ctx.fillStyle = grad;
    ctx.fillText(CITY_NAME.toUpperCase(), cx, titleY);
    ctx.restore();

    // A hard dark outline under the gradient fill keeps every glyph edge off the background value.
    ctx.save();
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(10,14,24,0.55)';
    ctx.lineJoin = 'round';
    ctx.strokeText(CITY_NAME.toUpperCase(), cx, titleY);
    ctx.restore();
    ctx.fillStyle = grad;
    ctx.fillText(CITY_NAME.toUpperCase(), cx, titleY);

    // A rule and a tagline under the wordmark.
    ctx.strokeStyle = 'rgba(255,209,102,0.75)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - width * 0.1, titleY + 26);
    ctx.lineTo(cx + width * 0.1, titleY + 26);
    ctx.stroke();

    ctx.font = `700 ${Math.round(width * 0.0215)}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    const tag = 'AN OPEN-WORLD CRIME GAME';
    ctx.letterSpacing = '4px';
    ctx.save();
    ctx.shadowColor = 'rgba(8,12,20,0.85)';
    ctx.shadowBlur = 12;
    ctx.fillText(tag, cx, titleY + 70);
    ctx.restore();
    ctx.letterSpacing = '0px';
  }

  return {
    resize,
    /** Everything the HUD shows, in the order that keeps text on top. */
    draw(state, missionTarget, label, opts) {
      ctx.clearRect(0, 0, width, height);
      const p = state.player;
      if (opts && opts.cover) {
        // Key art carries a title lockup, not a live HUD.
        drawCoverTitle();
        return;
      }
      drawMinimap(p, state.cars, state.cops, missionTarget);
      drawVitals(p);
      drawWanted(p);
      drawMoney(p);
      drawMission({ current: label, target: missionTarget });
      if (p.mode === MODE_CAR && state.cars[p.car]) drawSpeed(state.cars[p.car]);
    },
    clear() {
      ctx.clearRect(0, 0, width, height);
    },
  };
}

export { LANDMARKS };
