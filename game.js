'use strict';

const PLAYER_W = 16, PLAYER_H = 18, CS = 20;
const GRAVITY = 900, JUMP_VEL = -380, MOVE_SPD = 150;
const MAX_FALL = 600, DEATH_DUR = 1.0;
const INVIN_DUR = 1.333, GRAV_DUR = 3.0;
const TARGET_DT = 1 / 60, MAX_DT = 1 / 20;
const SKIN = 0.5;

const PAL = {
  bg: '#04060f', floor: '#0e2030', floorG: '#1a3a50',
  spike: '#ff3040', exit: '#00ffcc', grav: '#ff00aa',
  player: '#e0f0ff', eye: '#00ffcc'
};

let actx = null;
function initAudio() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
}

function sfx(type) {
  try {
    if (!actx) return;
    const g = actx.createGain(), o = actx.createOscillator();
    o.connect(g);
    g.connect(actx.destination);
    const t = actx.currentTime;
    if (type === 'jump') {
      o.type = 'square'; o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(440, t + 0.08);
      g.gain.setValueAtTime(0.18, t).exponentialRampToValueAtTime(0.001, t + 0.12);
      o.start(t); o.stop(t + 0.12);
    } else if (type === 'die') {
      o.type = 'sawtooth'; o.frequency.setValueAtTime(440, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.35);
      g.gain.setValueAtTime(0.25, t).exponentialRampToValueAtTime(0.001, t + 0.35);
      o.start(t); o.stop(t + 0.35);
    } else if (type === 'win') {
      o.type = 'triangle'; o.frequency.setValueAtTime(440, t);
      o.frequency.linearRampToValueAtTime(1760, t + 0.2);
      g.gain.setValueAtTime(0.22, t).exponentialRampToValueAtTime(0.001, t + 0.3);
      o.start(t); o.stop(t + 0.3);
    } else if (type === 'trap') {
      o.type = 'square'; o.frequency.setValueAtTime(880, t);
      o.frequency.exponentialRampToValueAtTime(110, t + 0.15);
      g.gain.setValueAtTime(0.2, t).exponentialRampToValueAtTime(0.001, t + 0.15);
      o.start(t); o.stop(t + 0.15);
    }
  } catch (e) {}
}

class LevelManager {
  constructor() { this.levels = []; }
  async load(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed');
      this.levels = await res.json();
      console.log('Levels loaded:', this.levels.length);
      return true;
    } catch (e) { console.error('Load error:', e); return false; }
  }
  getLevel(idx) { return this.levels[idx] || null; }
}

class Game {
  constructor() {
    this.lm = new LevelManager();
    this.tiles = [];
    this.player = { x: 0, y: 0, vx: 0, vy: 0, onGround: false };
    this.keys = { left: false, right: false, jump: false };
    this.state = { running: false, started: false, loaded: false, lvlIdx: 0, deaths: 0, dying: false, deathTimer: 0, invinTimer: 0, gravFlip: false, gravTimer: 0 };
    this._lastTS = 0;
    console.log('Game created');
  }

  async init() {
    console.log('Init starting...');
    const loaded = await this.lm.load('./mapa.json');
    if (!loaded) { console.log('LOAD FAILED'); return; }
    this.state.loaded = true;
    this.canvas = document.getElementById('c');
    this.ctx = this.canvas.getContext('2d');
    this._resize();
    this.loadLevel(0);
    this._bindEvents();
    this.state.running = true;
    requestAnimationFrame(t => this._loop(t));
    console.log('Game running');
  }

  _resize() {
    const c = this.canvas;
    c.width = c.parentElement ? c.parentElement.clientWidth : 400;
    c.height = c.height || 300;
  }

  _bindEvents() {
    const g = this;
    
    const startHandler = function(e) {
      console.log('Event:', e.type, 'started:', g.state.started, 'loaded:', g.state.loaded);
      if (g.state.started) return;
      if (!g.state.loaded) return;
      console.log('STARTING!');
      g.state.started = true;
      initAudio();
    };
    
    window.addEventListener('keydown', startHandler);
    window.addEventListener('touchstart', startHandler, false);
    window.addEventListener('click', startHandler);
    
    window.addEventListener('keyup', e => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') g.keys.left = false;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') g.keys.right = false;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') g.keys.jump = false;
    });
    
    window.addEventListener('touchstart', e => {
      if (!g.state.started) return;
      e.preventDefault();
      const t = e.touches[0];
      const rect = g.canvas.getBoundingClientRect();
      const x = t.clientX - rect.left;
      g.keys.left = x < rect.width / 2;
      g.keys.right = x >= rect.width / 2;
      g.keys.jump = true;
    }, { passive: false });
    
    window.addEventListener('touchend', e => {
      g.keys.left = g.keys.right = g.keys.jump = false;
    }, { passive: false });
  }

  loadLevel(idx) {
    const lvl = this.lm.getLevel(idx);
    if (!lvl) return;
    this.level = lvl;
    this.tiles = [];
    for (let r = 0; r < lvl.map.length; r++) this.tiles[r] = [...lvl.map[r]];
    this.player.x = lvl.sx * CS + CS / 2 - PLAYER_W / 2;
    this.player.y = lvl.sy * CS - PLAYER_H;
    this.player.vx = 0; this.player.vy = 0;
    this.state.lvlIdx = idx;
    this.state.gravFlip = false;
  }

  getTile(c, r) { return this.tiles[r] && this.tiles[r][c]; }
  isSolid(t) { return t === 1 || t === 5 || t === 6; }

  _sweepX(x, y, dx) {
    if (Math.abs(dx) < SKIN) return { nx: x, hitWall: false };
    const nx = x + dx;
    const col = dx > 0 ? Math.floor((nx + PLAYER_W - 1) / CS) : Math.floor(nx / CS);
    const r0 = Math.floor(y / CS), r1 = Math.floor((y + PLAYER_H - 1) / CS);
    for (let r = r0; r <= r1; r++) {
      if (this.isSolid(this.getTile(col, r))) return { nx: dx > 0 ? col * CS - PLAYER_W : (col + 1) * CS, hitWall: true };
    }
    return { nx, hitWall: false };
  }

  _sweepY(x, y, dy) {
    if (Math.abs(dy) < SKIN) return { ny: y, hitFloor: false, hitCeiling: false };
    const ny = y + dy;
    const row = dy > 0 ? Math.floor((ny + PLAYER_H - 1) / CS) : Math.floor(ny / CS);
    const c0 = Math.floor(x / CS), c1 = Math.floor((x + PLAYER_W - 1) / CS);
    for (let c = c0; c <= c1; c++) {
      const checkRow = this.tiles[row];
      if (checkRow && this.isSolid(checkRow[c])) return { ny: dy > 0 ? row * CS - PLAYER_H : (row + 1) * CS, hitFloor: dy > 0, hitCeiling: dy < 0 };
    }
    return { ny, hitFloor: false, hitCeiling: false };
  }

  checkSpikes() {
    const p = this.player;
    const c0 = Math.floor(p.x / CS), c1 = Math.floor((p.x + PLAYER_W - 1) / CS);
    const r0 = Math.floor(p.y / CS), r1 = Math.floor((p.y + PLAYER_H - 1) / CS);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const t = this.getTile(c, r);
      if (t === 3 || t === 4) return true;
    }
    return false;
  }

  checkExit() {
    const p = this.player, c = Math.floor((p.x + PLAYER_W / 2) / CS);
    const r = Math.floor((p.y + PLAYER_H / 2) / CS);
    if (this.getTile(c, r) === 8) {
      sfx('win');
      if (this.state.lvlIdx < this.lm.levels.length - 1) {
        this.loadLevel(this.state.lvlIdx + 1);
      } else {
        this.state.deaths = 0;
        this.loadLevel(0);
      }
    }
  }

  killPlayer() {
    if (this.state.dying || this.state.invinTimer > 0) return;
    this.state.dying = true;
    this.state.deathTimer = DEATH_DUR;
    this.state.deaths++;
    document.getElementById('hv-deaths').textContent = this.state.deaths;
    sfx('die');
  }

  _loop(ts) {
    requestAnimationFrame(t => this._loop(t));
    if (!this.state.running) return;
    if (this._lastTS === 0) this._lastTS = ts;
    this._lastTS = ts;
    if (this.state.loaded) this._physicsStep(TARGET_DT);
    this.render();
  }

  _physicsStep(dt) {
    const s = this.state;
    if (!s.started) return;
    if (!this.level) return;
    if (s.dying) {
      s.deathTimer -= dt;
      if (s.deathTimer <= 0) {
        this.player.x = this.level.sx * CS + CS / 2 - PLAYER_W / 2;
        this.player.y = this.level.sy * CS - PLAYER_H;
        this.player.vx = 0; this.player.vy = 0;
        s.dying = false;
        s.invinTimer = INVIN_DUR;
      }
      return;
    }

    if (s.invinTimer > 0) s.invinTimer -= dt;
    if (s.gravTimer > 0) {
      s.gravTimer -= dt;
      if (s.gravTimer <= 0) s.gravFlip = false;
    }

    const p = this.player;
    const gDir = s.gravFlip ? -1 : 1;
    p.vy += GRAVITY * gDir * dt;
    if (Math.abs(p.vy) > MAX_FALL) p.vy = MAX_FALL * Math.sign(p.vy);

    p.vx = this.keys.left ? -MOVE_SPD : (this.keys.right ? MOVE_SPD : 0);
    if (this.keys.jump && (p.onGround || s.gravFlip)) {
      p.vy = JUMP_VEL * (s.gravFlip ? -1 : 1);
      p.onGround = false;
      sfx('jump');
      this.keys.jump = false;
    }

    p.onGround = false;
    const rx = this._sweepX(p.x, p.y, p.vx * dt);
    if (rx.hitWall) p.vx = 0;
    p.x = rx.nx;
    const ry = this._sweepY(p.x, p.y, p.vy * dt);
    if (ry.hitFloor) { p.onGround = true; p.vy = 0; p.y = Math.round(ry.ny); }
    if (ry.hitCeiling) p.vy = 0;
    p.y = ry.ny;

    if (this.checkSpikes()) this.killPlayer();
    this.checkExit();
  }

  render() {
    const ctx = this.ctx;
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    if (!this.state.loaded) {
      ctx.fillStyle = '#fff';
      ctx.font = '20px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('LOADING...', ctx.canvas.width / 2, ctx.canvas.height / 2);
      return;
    }
    
    if (!this.state.started) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 36px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('FLUXTRAP', ctx.canvas.width / 2, ctx.canvas.height / 2 - 40);
      ctx.font = '22px monospace';
      ctx.fillStyle = PAL.grav;
      ctx.fillText('TAP TO START', ctx.canvas.width / 2, ctx.canvas.height / 2 + 20);
      return;
    }
    
    const lvl = this.level;
    if (!lvl) return;
    const offX = (ctx.canvas.width - lvl.pw * CS) / 2;
    const offY = (ctx.canvas.height - lvl.ph * CS) / 2;
    ctx.save();
    ctx.translate(offX, offY);
    
    for (let r = 0; r < lvl.ph; r++) {
      for (let c = 0; c < lvl.pw; c++) {
        const t = this.getTile(c, r);
        const x = c * CS, y = r * CS;
        if (t === 1) {
          ctx.fillStyle = PAL.floor;
          ctx.fillRect(x, y, CS, CS);
          ctx.fillStyle = PAL.floorG;
          ctx.fillRect(x + 2, y + 2, CS - 4, CS - 4);
        } else if (t === 3 || t === 4) {
          ctx.fillStyle = PAL.spike;
          ctx.beginPath();
          ctx.moveTo(x, y + CS);
          ctx.lineTo(x + CS / 2, y);
          ctx.lineTo(x + CS, y + CS);
          ctx.fill();
        } else if (t === 8) {
          ctx.fillStyle = PAL.exit;
          ctx.fillRect(x + 4, y + 4, CS - 8, CS - 8);
        }
      }
    }
    
    const p = this.player;
    ctx.fillStyle = this.state.dying ? '#f00' : PAL.player;
    ctx.fillRect(p.x, p.y, PLAYER_W, PLAYER_H);
    ctx.fillStyle = PAL.eye;
    ctx.fillRect(p.x + 4, p.y + 4, 3, 3);
    ctx.fillRect(p.x + 9, p.y + 4, 3, 3);
    ctx.restore();
  }
}

const game = new Game();
window.addEventListener('DOMContentLoaded', () => game.init());