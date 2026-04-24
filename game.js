'use strict';

const PLAYER_W = 16;
const PLAYER_H = 18;
const CS = 20;
const SKIN = 0.5;

const GRAVITY = 900;
const JUMP_VEL = -380;
const MOVE_SPD = 150;
const MAX_FALL = 600;
const DEATH_DUR = 1.0;
const INVIN_DUR = 1.333;
const GRAV_DUR = 3.0;
const TARGET_DT = 1 / 60;
const MAX_DT = 1 / 20;

const TAUNTS = ['NICE TRY', 'SKILL ISSUE', 'PATHETIC', 'LOL', 'ARE YOU TRYING?'];

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
    switch (type) {
      case 'jump':
        o.type = 'square'; o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(440, t + 0.08);
        g.gain.setValueAtTime(0.18, t).exponentialRampToValueAtTime(0.001, t + 0.12);
        o.start(t); o.stop(t + 0.12); break;
      case 'die':
        o.type = 'sawtooth'; o.frequency.setValueAtTime(440, t);
        o.frequency.exponentialRampToValueAtTime(55, t + 0.35);
        g.gain.setValueAtTime(0.25, t).exponentialRampToValueAtTime(0.001, t + 0.35);
        o.start(t); o.stop(t + 0.35); break;
      case 'trap':
        o.type = 'square'; o.frequency.setValueAtTime(880, t);
        o.frequency.exponentialRampToValueAtTime(110, t + 0.15);
        g.gain.setValueAtTime(0.2, t).exponentialRampToValueAtTime(0.001, t + 0.15);
        o.start(t); o.stop(t + 0.15); break;
      case 'win':
        o.type = 'triangle'; o.frequency.setValueAtTime(440, t);
        o.frequency.linearRampToValueAtTime(1760, t + 0.2);
        g.gain.setValueAtTime(0.22, t).exponentialRampToValueAtTime(0.001, t + 0.3);
        o.start(t); o.stop(t + 0.3); break;
    }
  } catch (e) {}
}

const PAL = {
  bg: '#04060f', floor: '#0e2030', floorG: '#1a3a50',
  spike: '#ff3040', spikeG: '#ff8090', ghost: 'rgba(40,180,120,.45)',
  exit: '#00ffcc', grav: '#ff00aa', player: '#e0f0ff', eye: '#00ffcc',
};

class Entity {
  constructor(config) {
    this.id = config.id || 'entity';
    this.state = 'IDLE';
    this.timer = 0;
    this._dead = false;
  }

  static STATES = { IDLE: 'IDLE', TRIGGERED: 'TRIGGERED', ACTIVE: 'ACTIVE', RESET: 'RESET' };

  trigger() {
    if (this.state === Entity.STATES.IDLE) {
      this.state = Entity.STATES.TRIGGERED;
      this.timer = 0;
    }
  }

  update(dt, game) {
    this.timer = Math.max(0, this.timer - dt);
    if (this.state === Entity.STATES.TRIGGERED && this.timer <= 0) {
      this.activate(game);
    }
  }

  activate(game) {
    this.state = Entity.STATES.ACTIVE;
  }

  reset() {
    this.state = Entity.STATES.IDLE;
    this.timer = 0;
  }
}

class DropBlock extends Entity {
  constructor(config) {
    super(config);
    this.col = config.col;
    this.row = config.row;
    this.fallSpeed = 0;
    this.y = this.row * CS;
    this.landed = false;
  }

  activate(game) {
    this.state = Entity.STATES.ACTIVE;
    this.fallSpeed = 120;
    sfx('trap');
  }

  update(dt, game) {
    if (this.state !== Entity.STATES.ACTIVE || this.landed) return;
    
    this.fallSpeed = Math.min(this.fallSpeed + 1440 * dt, 840);
    this.y += this.fallSpeed * dt;
    
    const row = Math.floor(this.y / CS);
    const nextRow = game.tiles[row + 1];
    if (row >= game.level.ph - 1 || (nextRow && game.isSolid(nextRow[col]))) {
      this.landed = true;
      game.tiles[row] = game.tiles[row] || [];
      game.tiles[row][this.col] = 1;
      
      const p = game.player;
      const pc = Math.floor((p.x + PLAYER_W / 2) / CS);
      if (pc === this.col && Math.abs(p.y + PLAYER_H / 2 - this.y) < CS * 1.5) {
        game.killPlayer();
      }
    }
  }
}

class SpikeWall extends Entity {
  constructor(config) {
    super(config);
    this.cols = config.cols || [];
    this.row = config.row;
  }

  activate(game) {
    for (const c of this.cols) {
      game.tiles[this.row] = game.tiles[this.row] || [];
      game.tiles[this.row][c] = 3;
    }
    sfx('trap');
  }
}

class GravityFlip extends Entity {
  activate(game) {
    game.gravFlip = true;
    game.gravTimer = GRAV_DUR;
    sfx('trap');
  }
}

class InvisibleTrigger {
  constructor(config) {
    this.id = config.id;
    this.cx = config.cx;
    this.cy = config.cy;
    this.r = config.r;
    this.action = config.action;
    this.params = config.params || {};
    this.fired = false;
  }

  check(player, game) {
    if (this.fired) return;
    const pc = (player.x + PLAYER_W / 2) / CS;
    const pr = (player.y + PLAYER_H / 2) / CS;
    if (Math.hypot(pc - this.cx, pr - this.cy) < this.r) {
      this.fire(game);
    }
  }

  fire(game) {
    this.fired = true;
    const action = this.action;
    const params = this.params;
    
    switch (action) {
      case 'drop_block':
        game.entities.push(new DropBlock({ id: this.id, col: params.blockCol, row: params.blockRow }));
        break;
      case 'spike_wall':
        game.entities.push(new SpikeWall({ id: this.id, cols: params.cols, row: params.row }));
        break;
      case 'gravity_flip':
        game.entities.push(new GravityFlip({ id: this.id }));
        break;
    }
    sfx('trap');
  }
}

class LevelManager {
  constructor() {
    this.levels = [];
    this.currentIdx = 0;
  }

  async load(url = './mapa.json') {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load');
      this.levels = await res.json();
      return true;
    } catch (e) {
      console.error('Level load error:', e);
      return false;
    }
  }

  getLevel(idx) {
    return this.levels[idx] || null;
  }

  get count() {
    return this.levels.length;
  }
}

class Game {
  constructor() {
    this.levelManager = new LevelManager();
    this.tiles = [];
    this.entities = [];
    this.triggers = [];
    this.player = { x: 0, y: 0, vx: 0, vy: 0, onGround: false };
    this.level = null;
    this.keys = { left: false, right: false, jump: false };
    this.state = {
      running: false, paused: false, lvlIdx: 0, deaths: 0,
      dying: false, deathTimer: 0, invinTimer: 0,
      flashTimer: 0, gravFlip: false, gravTimer: 0,
      msg: '', msgTimer: 0, overlay: null,
      started: false, loading: true, loaded: false
    };
    this._lastTS = 0;
    console.log('1. DOM Cargado');
  }

  async init(canvasId = 'game') {
    console.log('2. Iniciando load...');
    const loaded = await this.levelManager.load();
    console.log('3. JSON cargado:', loaded);
    if (!loaded) {
      this._showMsg('LOAD ERROR');
      this.state.loading = false;
      return;
    }
    this.state.loaded = true;
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this.loadLevel(0);
    this._bindEvents();
    console.log('4. Botón de inicio vinculado');
    this.state.running = true;
    requestAnimationFrame(t => this._loop(t));
    console.log('5. Game Loop iniciado');
  }

_resize() {
    const c = this.canvas;
    c.width = c.parentElement && c.parentElement.clientWidth || 400;
    c.height = c.height || 300;
  }

  _bindEvents() {
    const k = this.keys, g = this;
    window.addEventListener('keydown', e => {
      if (!g.state.started && g.state.loaded) {
        g.state.started = true;
        initAudio();
        return;
      }
      if (!g.state.started) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') k.left = true;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') k.right = true;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { k.jump = true; }
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') k.left = false;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') k.right = false;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') k.jump = false;
    });
    
    const tc = this.canvas;
    tc.addEventListener('touchstart', e => {
      e.preventDefault();
      if (!g.state.started && g.state.loaded) {
        g.state.started = true;
        initAudio();
        return;
      }
      if (!g.state.started) return;
      const t = e.touches[0];
      const rect = tc.getBoundingClientRect();
      const x = t.clientX - rect.left;
      if (x < rect.width / 2) k.left = true; else k.right = true;
      k.jump = true;
    }, { passive: false });
    tc.addEventListener('touchend', e => {
      e.preventDefault();
      k.left = k.right = k.jump = false;
    }, { passive: false });
    tc.addEventListener('click', e => {
      if (!g.state.started && g.state.loaded) {
        g.state.started = true;
        initAudio();
      }
    });
  }

  loadLevel(idx) {
    const lvl = this.levelManager.getLevel(idx);
    if (!lvl) return;
    this.level = lvl;
    this.tiles = [];
    for (let r = 0; r < lvl.map.length; r++) {
      this.tiles[r] = [...lvl.map[r]];
    }
    this.entities = [];
    this.triggers = [];
    
    if (lvl.triggers) {
      for (const t of lvl.triggers) {
        this.triggers.push(new InvisibleTrigger(t));
      }
    }
    
    this.player.x = lvl.sx * CS + CS / 2 - PLAYER_W / 2;
    this.player.y = lvl.sy * CS - PLAYER_H;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.onGround = false;
    
    this.state.lvlIdx = idx;
    this.state.gravFlip = false;
    this.state.gravTimer = 0;
    this.state.dying = false;
    this.state.invinTimer = INVIN_DUR;
    this.state.msg = '';
  }

  isSolid(tile) {
    return tile === 1 || tile === 5 || tile === 6;
  }

  getTile(c, r) {
    return (this.tiles[r] && this.tiles[r][c]) || 1;
  }

  setTile(c, r, v) {
    this.tiles[r] = this.tiles[r] || [];
    this.tiles[r][c] = v;
  }

  _sweepX(x, y, dx) {
    if (Math.abs(dx) < SKIN) return { nx: x, hitWall: false };
    const nx = x + dx;
    const col = dx > 0 ? Math.floor((nx + PLAYER_W - 1) / CS) : Math.floor(nx / CS);
    const r0 = Math.floor(y / CS), r1 = Math.floor((y + PLAYER_H - 1) / CS);
    for (let r = r0; r <= r1; r++) {
      if (this.isSolid(this.getTile(col, r))) {
        return { nx: dx > 0 ? col * CS - PLAYER_W : (col + 1) * CS, hitWall: true };
      }
    }
    return { nx, hitWall: false };
  }

  _sweepY(x, y, dy) {
    if (Math.abs(dy) < SKIN) return { ny: y, hitFloor: false, hitCeiling: false };
    const ny = y + dy;
    const row = dy > 0 ? Math.floor((ny + PLAYER_H - 1) / CS) : Math.floor(ny / CS);
    const c0 = Math.floor(x / CS), c1 = Math.floor((x + PLAYER_W - 1) / CS);
    for (let c = c0; c <= c1; c++) {
      const checkRow = game.tiles[row];
    if (checkRow && game.isSolid(checkRow[col])) {
        return { ny: dy > 0 ? row * CS - PLAYER_H : (row + 1) * CS, hitFloor: dy > 0, hitCeiling: dy < 0 };
      }
    }
    return { ny, hitFloor: false, hitCeiling: false };
  }

  checkSpikes() {
    const p = this.player;
    const c0 = Math.floor(p.x / CS), c1 = Math.floor((p.x + PLAYER_W - 1) / CS);
    const r0 = Math.floor(p.y / CS), r1 = Math.floor((p.y + PLAYER_H - 1) / CS);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const t = this.getTile(c, r);
        if (t === 3 || t === 4) return true;
      }
    }
    return false;
  }

  checkExit() {
    const p = this.player;
    const c = Math.floor((p.x + PLAYER_W / 2) / CS);
    const r = Math.floor((p.y + PLAYER_H / 2) / CS);
    if (this.getTile(c, r) === 8) {
      this._levelComplete();
    }
  }

  _levelComplete() {
    sfx('win');
    if (this.state.lvlIdx < this.levelManager.count - 1) {
      this._showOverlay('ZONE CLEARED', `Level ${this.state.lvlIdx + 1}`, 'NEXT', () => {
        this.loadLevel(this.state.lvlIdx + 1);
        this._hideOverlay();
      });
    } else {
      this._showOverlay('YOU WON', `Deaths: ${this.state.deaths}`, 'PLAY AGAIN', () => {
        this.state.deaths = 0;
        this.loadLevel(0);
        this._hideOverlay();
      });
    }
  }

  killPlayer() {
    if (this.state.dying || this.state.invinTimer > 0) return;
    this.state.dying = true;
    this.state.deathTimer = DEATH_DUR;
    this.state.deaths++;
    document.getElementById('hv-deaths').textContent = this.state.deaths;
    sfx('die');
    const taunt = TAUNTS[Math.floor(Math.random() * TAUNTS.length)];
    this._showMsg(taunt);
  }

  _showMsg(text) {
    this.state.msg = text;
    this.state.msgTimer = 2;
  }

  _showOverlay(title, subtitle, btnText, onClick) {
    this.state.overlay = { title, subtitle, btnText, onClick };
  }

  _hideOverlay() {
    this.state.overlay = null;
  }

  _loop(ts) {
    requestAnimationFrame(t => this._loop(t));
    if (!this.state.running || this.state.paused) return;
    if (!this.state.loaded) return;
    if (!this.state.started) return;
    
    if (this._lastTS === 0) this._lastTS = ts;
    const rawDt = Math.min((ts - this._lastTS) * 0.001, MAX_DT);
    this._lastTS = ts;

    this._physicsStep(TARGET_DT);
    this.render();
  }

  _physicsStep(dt) {
    const s = this.state;
    if (!s.started) return;
    if (!this.level) return;
    if (s.msgTimer > 0) s.msgTimer -= dt;
    if (s.invinTimer > 0) s.invinTimer = Math.max(0, s.invinTimer - dt);
    if (s.gravTimer > 0) {
      s.gravTimer -= dt;
      if (s.gravTimer <= 0) { s.gravFlip = false; this._showMsg('GRAVITY RESTORED'); }
    }

    if (s.dying) {
      s.deathTimer -= dt;
      if (s.deathTimer <= 0) {
        this.player.x = this.level.sx * CS + CS / 2 - PLAYER_W / 2;
        this.player.y = this.level.sy * CS - PLAYER_H;
        this.player.vx = 0;
        this.player.vy = 0;
        this.player.onGround = false;
        s.dying = false;
        s.invinTimer = INVIN_DUR;
      }
      return;
    }

    for (const tr of this.triggers) tr.check(this.player, this);

    for (let i = this.entities.length - 1; i >= 0; i--) {
      this.entities[i].update(dt, this);
      if (this.entities[i]._dead) this.entities.splice(i, 1);
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
    const dx = p.vx * dt, dy = p.vy * dt;
    const rx = this._sweepX(p.x, p.y, dx);
    if (rx.hitWall) p.vx = 0;
    p.x = rx.nx;
    const ry = this._sweepY(p.x, p.y, dy);
    if (ry.hitFloor) { p.onGround = true; p.vy = 0; p.y = Math.round(ry.ny); }
    if (ry.hitCeiling) p.vy = 0;
    p.y = ry.ny;

    if (this.checkSpikes()) this.killPlayer();
    this.checkExit();

    const ec = Math.floor((p.x + PLAYER_W / 2) / CS);
    const er = Math.floor((p.y + PLAYER_H / 2) / CS);
    if (p.y > this.level.ph * CS + CS) this.killPlayer();
  }

  render() {
    const ctx = this.ctx;
    
    if (!this.state.loaded) {
      ctx.fillStyle = PAL.bg;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = '18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('LOADING...', ctx.canvas.width / 2, ctx.canvas.height / 2);
      return;
    }
    
    if (!this.state.started) {
      ctx.fillStyle = PAL.bg;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 32px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('FLUXTRAP', ctx.canvas.width / 2, ctx.canvas.height / 2 - 40);
      ctx.font = '18px monospace';
      ctx.fillStyle = PAL.grav;
      ctx.fillText('START SUFFERING', ctx.canvas.width / 2, ctx.canvas.height / 2 + 20);
      ctx.font = '14px monospace';
      ctx.fillStyle = '#666';
      ctx.fillText('TAP OR PRESS ANY KEY', ctx.canvas.width / 2, ctx.canvas.height / 2 + 60);
      return;
    }
    
    const lvl = this.level;
    if (!lvl) return;
    
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

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
    ctx.fillStyle = p.onGround ? PAL.player : '#a0c0d0';
    ctx.fillRect(p.x, p.y, PLAYER_W, PLAYER_H);
    ctx.fillStyle = PAL.eye;
    ctx.fillRect(p.x + 4, p.y + 4, 3, 3);
    ctx.fillRect(p.x + 9, p.y + 4, 3, 3);

    ctx.restore();

    if (this.state.msg && this.state.msgTimer > 0) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.state.msg, ctx.canvas.width / 2, 40);
    }

    if (this.state.overlay) {
      const ov = this.state.overlay;
      ctx.fillStyle = 'rgba(0,0,0,.85)';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 32px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(ov.title, ctx.canvas.width / 2, ctx.canvas.height / 2 - 40);
      ctx.font = '18px monospace';
      ctx.fillText(ov.subtitle, ctx.canvas.width / 2, ctx.canvas.height / 2);
    }
  }
}

const game = new Game();
window.addEventListener('DOMContentLoaded', () => game.init());