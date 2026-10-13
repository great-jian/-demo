'use strict';

(() => {
  const WIDTH = 1600;
  const HEIGHT = 900;
  const GROUND = 1180;
  const WORLD_WIDTH = 4600;
  const BLADE_COLORS = ['#ecf2df', '#f3cf70', '#ff7960'];
  const BLADE_MULTIPLIERS = [1, 1.35, 1.85];
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const lerp = (start, end, amount) => start + (end - start) * amount;
  const ease = value => 1 - Math.pow(1 - clamp(value, 0, 1), 3);
  const byId = id => document.getElementById(id);

  class Sound {
    constructor() { this.enabled = false; this.context = null; }
    enable() {
      this.enabled = !this.enabled;
      if (this.enabled) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) this.context ||= new AudioContext();
        this.context?.resume();
      }
      byId('soundButton').textContent = this.enabled ? '♪ 声音开启' : '♪ 声音关闭';
      byId('soundButton').setAttribute('aria-pressed', String(this.enabled));
    }
    play(kind) {
      if (!this.enabled || !this.context) return;
      const context = this.context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const settings = { slash: [360, 70, 0.1, 'triangle'], hit: [140, 30, 0.13, 'sawtooth'], counter: [420, 1300, 0.3, 'sine'], level: [440, 880, 0.4, 'triangle'], stomp: [75, 18, 0.4, 'sawtooth'], oil: [105, 35, 0.35, 'triangle'] };
      const [start, end, length, type] = settings[kind] || settings.slash;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(start, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(end, context.currentTime + length);
      gain.gain.setValueAtTime(kind === 'stomp' ? 0.12 : 0.065, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + length);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + length);
    }
  }

  class HuntGame {
    constructor() {
      this.canvas = byId('game');
      this.context = this.canvas.getContext('2d');
      this.dragonImage = new Image();
      this.dragonImage.src = 'assets/dragon.png';
      this.dragonBody = new Image();
      this.dragonBody.src = 'assets/dragon-body.png';
      this.dragonForeleg = new Image();
      this.dragonForeleg.src = 'assets/dragon-foreleg.png';
      this.sound = new Sound();
      this.keys = new Set();
      this.randomSeed = 529;
      this.scenery = this.makeScenery();
      this.reset(false);
      this.bindEvents();
      this.lastFrame = performance.now();
      this.tick = this.tick.bind(this);
      requestAnimationFrame(this.tick);
    }
    random() {
      this.randomSeed = (this.randomSeed * 1664525 + 1013904223) >>> 0;
      return this.randomSeed / 4294967296;
    }
    makeScenery() {
      return {
        peaks: Array.from({ length: 32 }, (_, index) => ({ x: index * 175 - 700, height: 160 + this.random() * 230, width: 160 + this.random() * 220 })),
        rocks: Array.from({ length: 100 }, () => ({ x: this.random() * WORLD_WIDTH, depth: this.random(), size: 5 + this.random() * 25 })),
        embers: Array.from({ length: 90 }, () => ({ x: this.random() * WIDTH, y: this.random() * HEIGHT, speed: 8 + this.random() * 35, size: 1 + this.random() * 2, phase: this.random() * 6.28 })),
        fires: [450, 1110, 1660, 2900, 3500, 4210],
      };
    }
    reset(practice = this.practice) {
      this.practice = practice;
      this.mode = 'title';
      byId('arena').classList.add('menu-active');
      this.time = 0;
      this.ambientTime = 0;
      this.hits = 0;
      this.counters = 0;
      this.damageDone = 0;
      this.keys.clear();
      this.player = {
        x: 1900, y: GROUND, previousX: 1900, velocityY: 0, direction: 1, hp: 200, maxHp: 200,
        energy: 35, stamina: 100, blade: 0, action: null, combo: 0, spiritCombo: 0,
        comboDeadline: 0, spiritDeadline: 0, recentAttack: -100, invulnerable: 0, buffer: null,
        sheath: false, sheathReady: 0, releaseUntil: 0, finisherUntil: 0, slow: false,
        step: 0, trail: [],
      };
      this.boss = {
        x: 2630, hp: 14500, maxHp: 14500, direction: -1, phase: 1, action: null,
        cooldown: 2.5, actionIndex: 0, hurt: 0, wound: 0, weakUntil: 0,
        sequence: ['slam', 'sweep', 'oil', 'charge', 'tail', 'sweep', 'slam', 'oil'],
      };
      this.camera = { x: 2380, zoom: 0.58, shake: 0 };
      this.effects = [];
      this.slashes = [];
      this.numbers = [];
      this.oilPools = [];
      this.projectiles = [];
      this.announcement = { text: '', until: 0 };
      this.prompt = { text: '', until: 0 };
      this.spiritHeld = null;
      this.hitStop = 0;
      this.flash = 0;
      this.manualPaused = false;
      for (const id of ['pauseScreen', 'endScreen', 'practiceBadge']) byId(id).classList.add('hidden');
      byId('startScreen').classList.remove('hidden');
      this.updateHud();
    }
    start(practice = false) {
      this.reset(practice);
      this.mode = 'playing';
      byId('arena').classList.remove('menu-active');
      byId('startScreen').classList.add('hidden');
      byId('practiceBadge').classList.toggle('hidden', !practice);
      this.canvas.focus({ preventScroll: true });
      this.announce(practice ? '练习开始 · 从一次居合开始' : '狩猎开始 · 巨影苏醒', 2.5);
    }
    bindEvents() {
      byId('startButton').onclick = () => this.start(false);
      byId('practiceButton').onclick = () => this.start(true);
      byId('restartButton').onclick = () => this.start(this.practice);
      byId('resetButton').onclick = () => this.start(this.practice);
      byId('pauseButton').onclick = () => this.togglePause();
      byId('resumeButton').onclick = () => this.togglePause();
      byId('fullscreenButton').onclick = () => this.toggleFullscreen();
      byId('soundButton').onclick = () => this.sound.enable();
      byId('helpButton').onclick = () => {
        if (this.mode === 'playing') { this.togglePause(); this.manualPaused = true; }
        byId('manual').showModal();
      };
      byId('closeHelp').onclick = () => byId('manual').close();
      byId('manual').addEventListener('close', () => {
        if (this.manualPaused && this.mode === 'paused') this.togglePause();
        this.manualPaused = false;
      });
      window.addEventListener('keydown', event => {
        if (byId('manual').open || event.target instanceof HTMLInputElement) return;
        const key = event.code;
        const controls = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyJ', 'KeyK', 'KeyU', 'KeyI', 'KeyO', 'KeyH', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyP', 'KeyR', 'KeyF', 'Escape'];
        if (!controls.includes(key)) return;
        event.preventDefault();
        if (event.repeat) return;
        this.keys.add(key);
        if (key === 'KeyP' || key === 'Escape') { this.togglePause(); return; }
        if (key === 'KeyR') { this.start(this.practice); return; }
        if (key === 'KeyF') { this.toggleFullscreen(); return; }
        if (this.mode !== 'playing') return;
        if (key === 'KeyJ' || key === 'KeyK') {
          if (this.keys.has('KeyJ') && this.keys.has('KeyK')) this.request('retreat');
          else this.request(key === 'KeyJ' ? 'light' : 'heavy');
        }
        if (key === 'KeyI') this.request('foresight');
        if (key === 'KeyO') this.request(this.player.sheath ? 'iai' : 'sheath');
        if (key === 'KeyH') this.request(this.player.blade === 2 ? 'thrust' : 'focus');
        if (key === 'Space' || key === 'KeyW') this.jump();
        if (key === 'ShiftLeft' || key === 'ShiftRight') this.request('dodge');
        if (key === 'KeyU') {
          if (this.player.sheath) this.request('iai');
          else if (this.player.action?.kind === 'helmRise' || this.player.releaseUntil > this.time) this.request('spirit');
          else this.spiritHeld = { since: this.time, charging: false };
        }
      });
      window.addEventListener('keyup', event => {
        this.keys.delete(event.code);
        if (event.code !== 'KeyU' || !this.spiritHeld) return;
        const held = this.spiritHeld;
        this.spiritHeld = null;
        if (this.mode !== 'playing') return;
        if (held.charging && this.player.action?.kind === 'charge') this.finishCharge();
        else this.request('spirit');
      });
      window.addEventListener('blur', () => {
        this.keys.clear();
        this.spiritHeld = null;
        if (this.player.action?.kind === 'charge') this.player.action = null;
        if (this.mode === 'playing') this.togglePause();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.mode === 'playing') this.togglePause();
      });
    }
    toggleFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      else byId('arena').requestFullscreen?.().catch(() => this.hint('浏览器未允许全屏'));
    }
    togglePause() {
      if (!['playing', 'paused'].includes(this.mode)) return;
      this.mode = this.mode === 'playing' ? 'paused' : 'playing';
      this.keys.clear();
      this.spiritHeld = null;
      if (this.player.action?.kind === 'charge') this.player.action = null;
      byId('pauseScreen').classList.toggle('hidden', this.mode !== 'paused');
      byId('pauseButton').textContent = this.mode === 'paused' ? '▷' : 'Ⅱ';
      if (this.mode === 'playing') this.canvas.focus({ preventScroll: true });
    }
    announce(text, duration = 1.8) { this.announcement = { text, until: this.time + duration }; }
    hint(text, duration = 1.8) { this.prompt = { text, until: this.time + duration }; }
    jump() {
      const player = this.player;
      if (player.y < GROUND || player.action || player.sheath) return;
      player.velocityY = -790;
      player.stamina = Math.max(0, player.stamina - 12);
      this.burst(player.x, GROUND - 4, '#a2aa9b', 9, 150);
    }
    request(kind) {
      const player = this.player;
      const current = player.action;
      if (kind === 'spirit' && current?.kind === 'helmRise') { this.startHelm(); return true; }
      if (kind === 'spirit' && player.releaseUntil > this.time && !current) { this.startRelease(); return true; }
      if (kind === 'iai' && player.sheath) {
        if (this.time < player.sheathReady) { this.hint('刀尚未归鞘 · 稍等一瞬'); return false; }
        this.attack('iai'); return true;
      }
      if (kind === 'foresight') {
        if (this.time - player.recentAttack > 1.2 || current?.kind === 'hurt') { this.hint('看破需在普攻后派生'); return false; }
        if (current && !['light', 'heavy', 'retreat', 'focus', 'spirit', 'roundslash'].includes(current.kind)) return false;
        this.attack('foresight'); return true;
      }
      if (kind === 'sheath') {
        if (current?.kind === 'hurt' || current?.kind === 'release' || current?.kind === 'helmFall') return false;
        if (current && current.t < current.windup) { player.buffer = { kind, until: this.time + 0.8 }; return false; }
        this.attack('sheath'); return true;
      }
      if (kind === 'retreat' && current && ['light', 'heavy'].includes(current.kind) && current.t < 0.1) {
        this.attack('retreat'); return true;
      }
      if (kind === 'dodge') {
        if (player.stamina < 22) { this.hint('耐力不足'); return false; }
        if (current && current.kind !== 'thrustMiss' && (current.t < current.windup + current.active || ['helmFall', 'release', 'hurt'].includes(current.kind))) return false;
        player.stamina -= 22;
        this.attack('dodge'); return true;
      }
      if (current) {
        player.buffer = { kind, until: this.time + 0.9 };
        return false;
      }
      if (player.sheath) { this.hint('O / U 居合出刀 · 移动可取消纳刀'); return false; }
      return this.attack(kind);
    }
    attack(kind) {
      const player = this.player;
      let spec;
      let step = 1;
      if (kind === 'light' || kind === 'heavy') {
        step = this.time < player.comboDeadline ? player.combo % 3 + 1 : 1;
        player.combo = step;
        player.comboDeadline = this.time + 1.5;
        const red = player.blade === 2;
        const windups = kind === 'light' ? (red ? [0.085, 0.11, 0.15] : [0.14, 0.17, 0.22]) : [0.4, 0.49, 0.6];
        const damage = kind === 'light' ? [42, 52, 70][step - 1] : [100, 130, 185][step - 1];
        spec = {
          name: `${kind === 'light' ? (red ? '赤刃斩' : '轻斩') : '重斩'} · ${['Ⅰ', 'Ⅱ', 'Ⅲ'][step - 1]}`,
          windup: windups[step - 1], active: 0.15, recovery: kind === 'light' ? 0.14 : 0.25,
          damage, range: kind === 'light' ? 230 : 285, gain: kind === 'light' ? 13 : 21, lunge: kind === 'light' ? 42 : 55,
        };
        player.recentAttack = this.time;
      } else if (kind === 'spirit') {
        if (this.time < player.finisherUntil) kind = 'roundslash';
        else {
          step = this.time < player.spiritDeadline ? player.spiritCombo % 4 + 1 : 1;
          if (step === 4) kind = 'roundslash';
        }
        const cost = kind === 'roundslash' ? 24 : 16;
        if (player.energy < cost) { this.hint(`练气不足 · 普攻回气（需要 ${cost}）`); return false; }
        player.energy -= cost;
        player.spiritCombo = step;
        player.spiritDeadline = this.time + 2.2;
        if (kind === 'roundslash') {
          spec = { name: '气刃大回旋', windup: 0.27, active: 0.25, recovery: 0.23, damage: 230, range: 350, gain: 0, lunge: 100, upgrade: true };
          player.finisherUntil = 0;
          player.spiritCombo = 0;
        } else {
          spec = { name: `气刃斩 · ${['Ⅰ', 'Ⅱ', 'Ⅲ'][step - 1]}`, windup: 0.18 + step * 0.025, active: 0.18, recovery: 0.17, damage: [85, 112, 150][step - 1], range: 290 + step * 15, gain: 0, lunge: 48 };
        }
      } else if (kind === 'roundslash') {
        spec = { name: '蓄力气刃大回旋', windup: 0.1, active: 0.29, recovery: 0.26, damage: 310, range: 390, gain: 0, lunge: 110, upgrade: true };
        player.spiritCombo = 0;
      } else if (kind === 'foresight') {
        spec = { name: '看破斩', windup: 0.42, active: 0.2, recovery: 0.2, damage: 105, range: 335, gain: 0, countered: false, lunge: 220 };
        player.energy = 0;
        player.combo = 0;
      } else if (kind === 'sheath') {
        player.sheath = true;
        player.sheathReady = this.time + (this.time - player.recentAttack < 1.4 ? 0.24 : 0.43);
        player.action = null;
        player.buffer = null;
        this.sound.play('slash');
        return true;
      } else if (kind === 'iai') {
        player.sheath = false;
        spec = { name: '居合气刃斩', windup: 0.08, active: 0.2, recovery: 0.86, damage: 165, range: 430, gain: 0, lunge: 240, countered: false };
      } else if (kind === 'retreat') {
        spec = { name: '后撤斩', windup: 0.12, active: 0.2, recovery: 0.21, damage: 72, range: 310, gain: 36, lunge: -150 };
        player.recentAttack = this.time;
      } else if (kind === 'dodge') {
        spec = { name: '翻滚回避', windup: 0, active: 0, recovery: 0.44, damage: 0, range: 0, gain: 0, lunge: 0 };
      } else if (kind === 'focus') {
        if (player.energy < 20) { this.hint('集中刺击需要 20 练气'); return false; }
        player.energy -= 20;
        spec = { name: '集中弱点刺击', windup: 0.31, active: 0.18, recovery: 0.34, damage: 155, range: 370, gain: 0, lunge: 80 };
      } else if (kind === 'thrust') {
        if (player.blade !== 2) return false;
        if (player.energy < 25) { this.hint('登龙需要红刃与 25 练气'); return false; }
        spec = { name: '气刃突刺', windup: 0.21, active: 0.2, recovery: 0.26, damage: 65, range: 390, gain: 0, lunge: 180 };
      } else return false;
      const duration = spec.windup + spec.active + spec.recovery;
      player.action = { ...spec, kind, step, t: 0, duration, hitDone: false, slashDone: false, startX: player.x, blade: player.blade };
      player.buffer = null;
      return true;
    }
    startCharge() {
      const action = this.player.action;
      if (action && action.kind !== 'iai' && action.t < action.windup + action.active) return false;
      if (action && ['hurt', 'release', 'helmRise', 'helmFall', 'dodge', 'foresight'].includes(action.kind)) return false;
      this.player.sheath = false;
      this.player.action = { kind: 'charge', name: '蓄力气刃大回旋', t: 0, duration: Infinity, windup: 1.1, active: 0, power: 0, startX: this.player.x, blade: this.player.blade };
      this.player.buffer = null;
      return true;
    }
    finishCharge() {
      const player = this.player;
      const charge = player.action;
      if (!charge || charge.kind !== 'charge') return;
      player.action = null;
      if (charge.t < 1.1) { this.hint('蓄力未满 · 派生气刃斩'); this.attack('spirit'); return; }
      if (player.energy < 40) { this.hint('蓄力大回旋需要 40 练气'); return; }
      player.energy -= 40;
      this.attack('roundslash');
    }
    startHelm() {
      const player = this.player;
      player.action = { kind: 'helmFall', name: '气刃兜割 · 登龙', t: 0, duration: 1.05, windup: 0.13, active: 0.6, ticks: 0, blade: player.blade, startX: player.x, damage: 80, range: 460 };
      player.velocityY = Math.max(650, player.velocityY);
      this.addSlash(player.x + player.direction * 85, player.y - 80, 440, '#ffb391', 'vertical', 0.5);
      this.sound.play('counter');
    }
    startRelease() {
      this.player.releaseUntil = 0;
      this.player.action = { kind: 'release', name: '练气解放・无双斩', t: 0, duration: 1.65, windup: 0.45, active: 0.85, ticks: 0, blade: 2, startX: this.player.x, damage: 115, range: 530 };
      this.announce('练气解放・无双斩', 1.7);
    }
    bladeUp(reason) {
      const player = this.player;
      const before = player.blade;
      player.blade = Math.min(2, before + 1);
      this.burst(player.x, player.y - 70, BLADE_COLORS[player.blade], 35, 270);
      this.sound.play('level');
      this.announce(before === 2 ? `${reason} · 红刃维持` : `${reason} · ${player.blade === 1 ? '黄刃开启' : '红刃开启'}`);
    }
    inRange(range, bothSides = false) {
      const player = this.player;
      const boss = this.boss;
      const targets = [boss.x + boss.direction * 450, boss.x - boss.direction * 390];
      if (player.y < GROUND - 170) targets.push(clamp(player.x, boss.x - 590, boss.x + 560));
      return targets.find(target => Math.abs(target - player.x) < range + 80 && (bothSides || (target - player.x) * player.direction > -75));
    }
    hitBoss(action, damage = action.damage, bothSides = false) {
      if (this.boss.hp <= 0) return false;
      const target = this.inRange(action.range, bothSides);
      if (target === undefined) return false;
      const blade = action.blade ?? this.player.blade;
      let amount = Math.round(damage * BLADE_MULTIPLIERS[blade]);
      if (action.kind === 'iai' && action.countered) amount = Math.round(amount * 2.2);
      const weakX = this.boss.x + this.boss.direction * 450;
      const hitsWeak = this.boss.weakUntil > this.time && Math.abs(target - weakX) < 200;
      if (hitsWeak) amount = Math.round(amount * 1.2);
      this.boss.hp = Math.max(0, this.boss.hp - amount);
      this.boss.hurt = 0.14;
      this.boss.wound += amount;
      this.damageDone += amount;
      this.hits++;
      const hitY = Math.max(this.player.y - 95, GROUND - 350);
      this.burst(target, hitY, BLADE_COLORS[blade], action.kind === 'heavy' ? 24 : 15, 210);
      this.numbers.push({ x: target + (this.random() - 0.5) * 85, y: hitY - 25, text: String(amount), life: 1.05, maxLife: 1.05, color: blade === 2 ? '#ffc297' : '#f5e4a8', big: amount >= 200 });
      this.sound.play('hit');
      this.hitStop = Math.max(this.hitStop, action.kind === 'heavy' ? 0.045 : 0.022);
      this.camera.shake = Math.max(this.camera.shake, amount > 250 ? 10 : 4);
      this.player.energy = clamp(this.player.energy + (action.gain || 0), 0, 100);
      if (action.upgrade) this.bladeUp('大回旋命中');
      if (action.kind === 'foresight' && action.countered) {
        this.player.energy = 100;
        this.player.finisherUntil = this.time + 1.8;
        this.bladeUp('看破成功');
        this.hint('U 直接接气刃大回旋', 1.8);
      }
      if (action.kind === 'focus' && hitsWeak) {
        this.boss.weakUntil = 0;
        this.boss.wound = 0;
        this.bladeUp('伤口破坏');
        this.boss.cooldown += 1.3;
        this.camera.shake = 13;
      }
      if (this.boss.wound > 700 && this.boss.weakUntil <= this.time) {
        this.boss.weakUntil = this.time + 12;
        this.boss.wound = 0;
        this.hint('爪部伤口暴露 · H 集中弱点攻击升刃', 3);
      }
      if (this.boss.hp <= 0) this.end(true);
      return true;
    }
    damagePlayer(damage, sourceX) {
      const player = this.player;
      const action = player.action;
      if (action?.kind === 'iai' && action.t >= 0.03 && action.t <= 0.25) {
        if (!action.countered) {
          action.countered = true;
          player.invulnerable = 0.65;
          this.counters++;
          this.bladeUp('居合成功');
          player.energy = Math.min(100, player.energy + 25);
          this.flash = 0.16;
          this.hitStop = 0.12;
          this.addSlash(player.x, player.y - 90, 650, '#f2f7df', 'horizontal', 0.5);
          this.sound.play('counter');
        }
        return 'counter';
      }
      if (action?.kind === 'foresight' && action.t < 0.42) {
        if (!action.countered) {
          action.countered = true;
          player.invulnerable = 0.45;
          this.counters++;
          this.flash = 0.08;
          this.burst(player.x, player.y - 70, '#a3e4d2', 28, 300);
          this.sound.play('counter');
          this.hint('见切成功 · 回斩命中升刃');
        }
        return 'counter';
      }
      if (player.invulnerable > 0 || (action?.kind === 'dodge' && action.t < 0.3)) return 'immune';
      if (action?.kind === 'release') {
        if (!this.practice) player.hp = Math.max(0, player.hp - Math.round(damage * 0.35));
        player.invulnerable = 0.25;
        this.burst(player.x, player.y - 60, '#f7c28e', 15, 190);
        if (player.hp <= 0) this.end(false);
        return 'armor';
      }
      if (!this.practice) player.hp = Math.max(0, player.hp - damage);
      player.invulnerable = 1.05;
      player.sheath = false;
      player.releaseUntil = 0;
      player.buffer = null;
      player.x = clamp(player.x + (player.x > sourceX ? 110 : -110), 150, WORLD_WIDTH - 150);
      player.velocityY = -260;
      player.action = { kind: 'hurt', name: this.practice ? '受击 · 练习保护' : '受击硬直', t: 0, duration: 0.58, windup: 0, active: 0, startX: player.x };
      this.camera.shake = 15;
      this.burst(player.x, player.y - 45, '#d77861', 24, 220);
      this.numbers.push({ x: player.x, y: player.y - 130, text: this.practice ? '保护' : `−${damage}`, life: 1.2, maxLife: 1.2, color: '#f2947e', big: false });
      if (player.hp <= 0) this.end(false);
      return 'hit';
    }
    end(won) {
      this.mode = won ? 'won' : 'lost';
      this.keys.clear();
      this.spiritHeld = null;
      this.player.action = null;
      this.player.sheath = false;
      byId('endScreen').classList.remove('hidden');
      byId('endEyebrow').textContent = won ? 'QUEST COMPLETE / 狩猎完成' : 'QUEST FAILED / 狩猎未竟';
      byId('endTitle').textContent = won ? '巨影落，刀未锈。' : '调整呼吸，再拔刀。';
      const minutes = String(Math.floor(this.time / 60)).padStart(2, '0');
      const seconds = String(Math.floor(this.time % 60)).padStart(2, '0');
      byId('endSummary').textContent = `${this.practice ? '练习 · ' : ''}${minutes}:${seconds} · 命中 ${this.hits} 次 · 成功反击 ${this.counters} 次 · 总伤害 ${this.damageDone}`;
      this.updateHud();
    }
    startBossAttack(kind) {
      const boss = this.boss;
      if (!kind) {
        const behind = (this.player.x - boss.x) * boss.direction < -360;
        kind = behind && boss.actionIndex % 2 === 0 ? 'tail' : boss.sequence[boss.actionIndex % boss.sequence.length];
      }
      boss.actionIndex++;
      if (kind !== 'tail') boss.direction = this.player.x < boss.x ? -1 : 1;
      const foreX = boss.x + boss.direction * 450;
      const targetX = clamp(this.player.x, boss.x - 1100, boss.x + 1100);
      const definitions = {
        slam: { name: boss.phase === 2 ? '液化 · 连续下砸' : '前爪下砸', windup: 1.22, duration: boss.phase === 2 ? 2.65 : 2.1, events: boss.phase === 2 ? [1.22, 1.82] : [1.22], x: foreX, radius: 410, damage: 38 },
        sweep: { name: '横扫爪击', windup: 0.88, duration: 1.75, events: [0.88], x: foreX - boss.direction * 20, radius: 600, damage: 29, height: 150 },
        tail: { name: '甩尾', windup: 0.47, duration: 1.28, events: [0.47], x: boss.x - boss.direction * 640, radius: 650, damage: 32, height: 170 },
        oil: { name: '龙骨油喷射', windup: 1.05, duration: 1.9, events: [1.05], x: targetX, radius: 290, damage: 17 },
        charge: { name: '龙车 · 突进冲撞', windup: 1.28, duration: 2.55, events: [], x: boss.x, radius: 780, damage: 42 },
      };
      boss.action = { ...definitions[kind], kind, t: 0, fired: 0, startX: boss.x, targetX, hitPlayer: false };
    }
    bossImpact(action, eventIndex) {
      if (action.kind === 'oil') {
        this.projectiles.push({ startX: this.boss.x + this.boss.direction * 680, startY: GROUND - 620, x: this.boss.x + this.boss.direction * 680, y: GROUND - 620, targetX: action.x, t: 0, duration: 0.7, phase: this.boss.phase });
        this.sound.play('oil');
        return;
      }
      const impactX = action.x + (eventIndex === 1 ? this.boss.direction * 180 : 0);
      if (Math.abs(this.player.x - impactX) < action.radius && GROUND - this.player.y < (action.height || 210)) this.damagePlayer(action.damage, this.boss.x);
      this.burst(impactX, GROUND - 20, action.kind === 'slam' ? '#d1ac74' : '#ad9d7c', action.kind === 'slam' ? 55 : 30, 450);
      this.effects.push({ kind: 'shockwave', x: impactX, y: GROUND, radius: action.radius, life: 0.55, maxLife: 0.55, color: '#dcc28a' });
      this.camera.shake = action.kind === 'slam' ? 20 : 11;
      this.sound.play('stomp');
    }
    updateBoss(delta) {
      const boss = this.boss;
      boss.hurt = Math.max(0, boss.hurt - delta);
      if (boss.hp <= boss.maxHp * 0.5 && boss.phase === 1) {
        boss.phase = 2;
        this.announce('龙骨油液化 · 双重下砸与燃油爆破', 3.5);
        this.camera.shake = 14;
        this.sound.play('stomp');
      }
      if (!boss.action) {
        boss.cooldown -= delta;
        if (boss.cooldown <= 0) this.startBossAttack();
        return;
      }
      const action = boss.action;
      action.t += delta;
      while (action.fired < action.events.length && action.t >= action.events[action.fired]) {
        this.bossImpact(action, action.fired);
        action.fired++;
      }
      if (action.kind === 'charge' && action.t >= action.windup && action.t < 2.1) {
        const progress = (action.t - action.windup) / (2.1 - action.windup);
        boss.x = clamp(action.startX + boss.direction * 1050 * ease(progress), 1200, WORLD_WIDTH - 1100);
        const front = boss.x + boss.direction * 490;
        if (!action.hitPlayer && Math.abs(this.player.x - front) < 390 && GROUND - this.player.y < 260) {
          this.damagePlayer(action.damage, boss.x);
          action.hitPlayer = true;
        }
        if (this.random() < 0.5) this.burst(front, GROUND - 20, '#9e8c73', 3, 170);
        this.camera.shake = Math.max(this.camera.shake, 5);
      }
      if (action.t >= action.duration) {
        boss.action = null;
        boss.cooldown = boss.phase === 2 ? 1.25 : 1.75;
      }
    }
    updatePlayer(delta) {
      const player = this.player;
      player.previousX = player.x;
      player.invulnerable = Math.max(0, player.invulnerable - delta);
      player.stamina = Math.min(100, player.stamina + delta * 19);
      player.slow = this.oilPools.some(pool => pool.life > 0 && Math.abs(pool.x - player.x) < pool.radius && player.y >= GROUND - 10);
      if (this.spiritHeld && !this.spiritHeld.charging && this.time - this.spiritHeld.since > 0.24) {
        if (this.startCharge()) this.spiritHeld.charging = true;
      }
      let action = player.action;
      const movement = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
      if (!action || action.kind === 'charge' || action.kind === 'helmRise') {
        if (movement && action?.kind !== 'charge') {
          player.direction = movement;
          player.x += movement * (player.slow ? 135 : 365) * delta;
          player.step += delta * (player.slow ? 4 : 10);
          player.sheath = false;
        }
      }
      if (action) {
        action.t += delta;
        if (action.kind === 'charge') {
          action.power = clamp(action.t / 1.1, 0, 1);
          if (action.power === 1 && !action.notified) { this.hint('蓄力完成 · 松开 U 释放大回旋', 1.8); action.notified = true; this.sound.play('level'); }
          if (this.random() < 0.4) this.burst(player.x + player.direction * 50, player.y - 60, BLADE_COLORS[player.blade], 1, 50);
        } else if (action.kind === 'helmRise') {
          if (action.t > 1.25) this.startHelm();
        } else if (action.kind === 'helmFall') {
          const expected = Math.floor(clamp((action.t - 0.1) / 0.085, 0, 7));
          while (action.ticks < expected) {
            this.hitBoss(action, action.damage, true);
            this.addSlash(player.x + player.direction * 100, GROUND - 160 - action.ticks * 46, 360, '#ff987c', 'vertical', 0.28);
            action.ticks++;
          }
          if (player.y >= GROUND && action.t > 0.2) {
            player.action = null;
            player.releaseUntil = this.time + 1.3;
            this.hint('落地 · U 接练气解放・无双斩', 1.3);
            this.camera.shake = 12;
          }
        } else if (action.kind === 'release') {
          const expected = Math.floor(clamp((action.t - action.windup) / 0.13, 0, 6));
          while (action.ticks < expected) {
            this.hitBoss(action, action.damage + (action.ticks === 5 ? 135 : 0), true);
            this.addSlash(player.x + player.direction * 160, player.y - 80, 300 + action.ticks * 35, '#ff8a62', action.ticks % 2 ? 'horizontal' : 'arc', 0.35);
            action.ticks++;
          }
        } else if (action.kind === 'dodge') {
          const direction = movement || player.direction;
          player.x += direction * 770 * delta;
        } else if (!['hurt', 'thrustMiss'].includes(action.kind)) {
          if (action.kind === 'foresight') {
            if (action.t < 0.34) player.x -= player.direction * 610 * delta;
            else if (action.t < 0.64) player.x += player.direction * 950 * delta;
          } else if (action.t > action.windup && action.t < action.windup + action.active) {
            player.x += player.direction * (action.lunge || 0) / action.active * delta;
          }
          if (action.t >= action.windup && !action.slashDone) {
            this.addSlash(player.x + player.direction * action.range * 0.38, player.y - 83, action.range, BLADE_COLORS[action.blade], ['thrust', 'focus', 'iai'].includes(action.kind) ? 'horizontal' : 'arc', action.active + 0.14, player.direction);
            action.slashDone = true;
            this.sound.play('slash');
          }
          if (action.t >= action.windup && action.t < action.windup + action.active && !action.hitDone) {
            const hit = this.hitBoss(action, action.damage, ['roundslash', 'retreat'].includes(action.kind));
            if (hit) {
              action.hitDone = true;
              if (action.kind === 'thrust') {
                player.energy = Math.max(0, player.energy - 25);
                player.velocityY = -1030;
                player.invulnerable = 0.2;
                player.action = { kind: 'helmRise', name: '气刃突刺 · 腾空', t: 0, duration: 1.3, windup: 0, active: 0, blade: player.blade, startX: player.x };
                this.hint('腾空 · 按 U 释放登龙', 1.25);
                action = player.action;
              }
            }
          }
        }
        if (player.action === action && action.t >= action.duration) {
          if (action.kind === 'release') {
            player.blade = 0;
            this.announce('练气解放完毕 · 归于白刃');
          }
          if (action.kind === 'thrust' && !action.hitDone) {
            player.action = { kind: 'thrustMiss', name: '突刺落空 · Shift 取消', t: 0, duration: 0.45, windup: 0, active: 0 };
          } else player.action = null;
          if (action.kind === 'foresight' && (!action.countered || !action.hitDone)) { player.energy = 0; this.hint('看破未成立 · 练气清空'); }
        }
      }
      player.velocityY += 1900 * delta;
      player.y += player.velocityY * delta;
      if (player.y >= GROUND) { player.y = GROUND; player.velocityY = 0; }
      player.x = clamp(player.x, 200, WORLD_WIDTH - 200);
      if (player.buffer && !player.action) {
        const buffer = player.buffer;
        player.buffer = null;
        if (buffer.until > this.time) this.request(buffer.kind);
      }
      if (player.buffer && player.action && player.buffer.kind === 'sheath' && player.action.t > player.action.windup + player.action.active) this.request('sheath');
      if (player.action && ['iai', 'foresight', 'dodge', 'thrust', 'release'].includes(player.action.kind) && this.random() < 0.55) {
        player.trail.push({ x: player.x, y: player.y, direction: player.direction, life: 0.18 });
      }
      player.trail = player.trail.filter(trace => (trace.life -= delta) > 0);
    }
    updateHazards(delta) {
      this.projectiles = this.projectiles.filter(projectile => {
        projectile.t += delta;
        const progress = clamp(projectile.t / projectile.duration, 0, 1);
        projectile.x = lerp(projectile.startX, projectile.targetX, progress);
        projectile.y = lerp(projectile.startY, GROUND, progress) - Math.sin(progress * Math.PI) * 120;
        if (progress < 1) return true;
        this.oilPools.push({ x: projectile.targetX, radius: 245, life: projectile.phase === 2 ? 5.3 : 9, age: 0, ignition: projectile.phase === 2 ? 3.4 : Infinity, exploded: false });
        this.burst(projectile.targetX, GROUND, '#282a26', 40, 330);
        if (Math.abs(this.player.x - projectile.targetX) < 245 && GROUND - this.player.y < 170) this.damagePlayer(17, projectile.startX);
        if (this.oilPools.length > 6) this.oilPools.shift();
        return false;
      });
      this.oilPools = this.oilPools.filter(pool => {
        pool.life -= delta;
        pool.age += delta;
        if (!pool.exploded && pool.age >= pool.ignition) {
          pool.exploded = true;
          this.burst(pool.x, GROUND - 35, '#f5984e', 75, 600);
          this.effects.push({ kind: 'explosion', x: pool.x, y: GROUND - 75, radius: 310, life: 0.65, maxLife: 0.65, color: '#f0a34c' });
          if (Math.abs(this.player.x - pool.x) < 310 && GROUND - this.player.y < 300) this.damagePlayer(40, pool.x);
          this.camera.shake = 19;
          this.sound.play('stomp');
        }
        return pool.life > 0;
      });
    }
    burst(x, y, color, count, speed) {
      for (let index = 0; index < count; index++) {
        const angle = this.random() * Math.PI * 2;
        const velocity = (0.3 + this.random() * 0.7) * speed;
        const life = 0.3 + this.random() * 0.5;
        this.effects.push({ kind: 'particle', x, y, velocityX: Math.cos(angle) * velocity, velocityY: Math.sin(angle) * velocity - 110, life, maxLife: life, color, size: 2 + this.random() * 5 });
      }
    }
    addSlash(x, y, radius, color, kind = 'arc', life = 0.3, direction = this.player.direction) {
      this.slashes.push({ x, y, radius, color, kind, life, maxLife: life, direction, angle: this.random() * 0.8 - 0.4 });
    }
    updateEffects(delta) {
      this.effects = this.effects.filter(effect => {
        effect.life -= delta;
        if (effect.kind === 'particle') {
          effect.x += effect.velocityX * delta;
          effect.y += effect.velocityY * delta;
          effect.velocityY += 650 * delta;
        }
        return effect.life > 0;
      });
      this.slashes = this.slashes.filter(slash => (slash.life -= delta) > 0);
      this.numbers = this.numbers.filter(number => { number.life -= delta; number.y -= delta * 70; return number.life > 0; });
      this.camera.shake = Math.max(0, this.camera.shake - delta * 38);
      this.flash = Math.max(0, this.flash - delta);
    }
    step(delta) {
      if (this.mode !== 'playing') return;
      this.time += delta;
      this.updatePlayer(delta);
      if (this.mode !== 'playing') { this.updateEffects(delta); return; }
      this.updateBoss(delta);
      this.updateHazards(delta);
      this.updateEffects(delta);
      const desiredX = this.player.x * 0.48 + this.boss.x * 0.52;
      this.camera.x = lerp(this.camera.x, clamp(desiredX, 1390, WORLD_WIDTH - 1390), 1 - Math.exp(-delta * 3));
      const distance = Math.abs(this.player.x - this.boss.x);
      this.camera.zoom = lerp(this.camera.zoom, clamp(0.64 - distance * 0.000065, 0.48, 0.61), 1 - Math.exp(-delta * 2));
      this.updateHud();
    }
    updateHud() {
      const player = this.player;
      const boss = this.boss;
      byId('bossHealth').style.width = `${boss.hp / boss.maxHp * 100}%`;
      byId('bossPercent').innerHTML = `${Math.ceil(boss.hp / boss.maxHp * 100)}<span>%</span>`;
      byId('phaseLabel').textContent = boss.phase === 1 ? '固态龙骨油' : '龙骨油液化 · 狂暴';
      byId('bossStatus').textContent = boss.action?.name || (this.mode === 'title' ? '巨影正在苏醒' : boss.weakUntil > this.time ? '爪部伤口暴露' : '观察前摇 · 等待破绽');
      byId('playerHealth').style.width = `${player.hp / player.maxHp * 100}%`;
      byId('hpText').textContent = `${player.hp} / ${player.maxHp}`;
      byId('playerStamina').style.width = `${player.stamina}%`;
      byId('playerEnergy').style.width = `${player.energy}%`;
      byId('playerEnergy').style.background = BLADE_COLORS[player.blade];
      byId('energyText').textContent = Math.round(player.energy);
      for (let index = 0; index < 3; index++) byId(`blade${index}`).classList.toggle('lit', index <= player.blade);
      byId('bladeMultiplier').textContent = `×${BLADE_MULTIPLIERS[player.blade].toFixed(2)}`;
      byId('bladeMultiplier').style.color = BLADE_COLORS[player.blade];
      byId('actionName').textContent = player.action?.name || (player.sheath ? (this.time >= player.sheathReady ? '纳刀就绪 · 等待居合' : '特殊纳刀') : player.releaseUntil > this.time ? '登龙落地 · 解放窗口' : player.slow ? '龙骨油 · 移动迟滞' : player.blade === 2 ? '红刃 · 赤刃斩解锁' : '等待拔刀');
      byId('actionName').style.color = player.action?.countered ? '#b9e7c8' : BLADE_COLORS[player.blade];
      byId('chainReadout').textContent = player.action?.kind === 'charge' ? `${Math.floor(player.action.power * 100)}% · 松开 U 出刀` : player.sheath ? 'O / U 出刀 · 捕捉攻击瞬间' : player.releaseUntil > this.time ? 'U 练气解放・无双斩' : player.action?.kind === 'helmRise' ? 'U 空中登龙' : player.finisherUntil > this.time ? 'U 直接大回旋' : 'J / K 可交替连击';
      byId('chargeTrack').classList.toggle('visible', player.action?.kind === 'charge');
      byId('chargeFill').style.width = `${(player.action?.power || 0) * 100}%`;
      byId('objectiveText').textContent = player.blade === 2 ? 'H 突刺 → U 登龙 → U 解放' : boss.weakUntil > this.time ? 'H 命中爪部伤口可以升刃' : '升至红刃，解放太刀。';
      byId('timer').textContent = `${String(Math.floor(this.time / 60)).padStart(2, '0')}:${String(Math.floor(this.time % 60)).padStart(2, '0')}`;
      byId('announce').textContent = this.announcement.text;
      byId('announce').classList.toggle('visible', this.announcement.until > this.time);
      byId('combatPrompt').textContent = this.prompt.text;
      byId('combatPrompt').classList.toggle('visible', this.prompt.until > this.time && this.mode === 'playing');
    }
    tick(now) {
      const delta = Math.min(0.033, Math.max(0, (now - this.lastFrame) / 1000));
      this.lastFrame = now;
      if (this.mode !== 'paused') this.ambientTime += delta;
      if (this.hitStop > 0) { this.hitStop -= delta; this.updateEffects(delta * 0.3); }
      else this.step(delta);
      this.render();
      requestAnimationFrame(this.tick);
    }
    polygon(points, fill, stroke, lineWidth = 2) {
      const context = this.context;
      context.beginPath();
      points.forEach((point, index) => index ? context.lineTo(point[0], point[1]) : context.moveTo(point[0], point[1]));
      context.closePath();
      context.fillStyle = fill;
      context.fill();
      if (stroke) { context.strokeStyle = stroke; context.lineWidth = lineWidth; context.stroke(); }
    }
    renderBackground() {
      const context = this.context;
      const time = this.ambientTime;
      const sky = context.createLinearGradient(0, 0, 0, HEIGHT);
      sky.addColorStop(0, '#18202a'); sky.addColorStop(0.43, '#3c3a42'); sky.addColorStop(0.72, '#a28c77'); sky.addColorStop(1, '#4d4943');
      context.fillStyle = sky; context.fillRect(0, 0, WIDTH, HEIGHT);
      const glow = context.createRadialGradient(1150, 400, 15, 1150, 400, 600);
      glow.addColorStop(0, '#e9bd7d38'); glow.addColorStop(1, '#e9bd7d00');
      context.fillStyle = glow; context.fillRect(0, 0, WIDTH, HEIGHT);
      context.fillStyle = '#d4b89030'; context.beginPath(); context.arc(1090, 240, 75, 0, Math.PI * 2); context.fill();
      for (let layer = 0; layer < 3; layer++) {
        const ground = 540 + layer * 65;
        const parallax = (this.camera.x - 2400) * (0.06 + layer * 0.07);
        for (let index = 0; index < this.scenery.peaks.length; index++) {
          const peak = this.scenery.peaks[index];
          const left = peak.x - parallax;
          const peakHeight = peak.height * (0.7 + layer * 0.25);
          this.polygon([[left - peak.width, ground + 120], [left - peak.width * 0.4, ground - peakHeight * 0.53], [left - peak.width * 0.15, ground - peakHeight * 0.48], [left, ground - peakHeight], [left + peak.width * 0.4, ground - peakHeight * 0.63], [left + peak.width, ground + 100]], ['#36383f', '#33333a', '#282b32'][layer]);
          if (index % 3 === 0) this.polygon([[left, ground - peakHeight], [left - peak.width * 0.15, ground - peakHeight * 0.48], [left - peak.width * 0.4, ground - peakHeight * 0.53], [left - peak.width * 0.7, ground + 30]], ['#45444b', '#444047', '#35343a'][layer]);
        }
      }
      for (let index = 0; index < 8; index++) {
        const left = index * 260 - 100 - (this.camera.x - 2400) * 0.2;
        const top = 610 - (index % 3) * 37;
        this.polygon([[left, 720], [left + 13, top], [left + 48, top - 12], [left + 54, top + 20], [left + 82, top + 22], [left + 86, 720]], '#383834');
        context.fillStyle = '#555045'; context.fillRect(left + 21, top + 10, 3, 80);
      }
      const fog = context.createLinearGradient(0, 500, 0, 750);
      fog.addColorStop(0, '#a4938000'); fog.addColorStop(0.65, '#a4938033'); fog.addColorStop(1, '#48474000');
      context.fillStyle = fog; context.fillRect(0, 480, WIDTH, 300);
      for (let index = 0; index < 5; index++) {
        const cloudX = ((index * 380 + time * 5) % 2100) - 250;
        context.fillStyle = '#292a3440';
        context.beginPath(); context.ellipse(cloudX, 140 + index % 3 * 65, 290, 65, -0.14, 0, Math.PI * 2); context.fill();
      }
    }
    renderGround() {
      const context = this.context;
      context.fillStyle = '#555347'; context.fillRect(-1000, GROUND, WORLD_WIDTH + 2000, 1000);
      this.polygon([[-1000, GROUND + 22], [650, GROUND + 8], [1400, GROUND + 21], [2100, GROUND + 14], [3000, GROUND + 27], [4200, GROUND + 12], [5600, GROUND + 35], [5600, GROUND + 200], [-1000, GROUND + 200]], '#4a4c42');
      for (let index = 0; index < 22; index++) {
        const left = index * 240 - 200;
        context.fillStyle = index % 2 ? '#232b2b' : '#343c36';
        context.beginPath(); context.ellipse(left, GROUND + 35 + index % 4 * 30, 160, 8 + index % 3 * 5, -0.06, 0, Math.PI * 2); context.fill();
        context.strokeStyle = '#8f855c58'; context.lineWidth = 3; context.beginPath(); context.moveTo(left - 80, GROUND + 17 + index % 4 * 30); context.lineTo(left + 80, GROUND + 10 + index % 4 * 30); context.stroke();
      }
      for (const rock of this.scenery.rocks) {
        const depth = rock.depth;
        const base = GROUND + depth * 310;
        const size = rock.size * (0.6 + depth);
        this.polygon([[rock.x - size, base], [rock.x - size * 0.5, base - size * 0.7], [rock.x + size * 0.25, base - size], [rock.x + size, base - size * 0.2], [rock.x + size * 1.2, base + 2]], '#353c36', '#252e29', 2);
        this.polygon([[rock.x - size * 0.5, base - size * 0.7], [rock.x + size * 0.25, base - size], [rock.x + size * 0.05, base - size * 0.4]], '#6d6d58');
      }
    }
    renderFires() {
      const context = this.context;
      const time = this.ambientTime;
      for (const position of this.scenery.fires) {
        context.save(); context.translate(position, GROUND - 10);
        const glow = context.createRadialGradient(0, 0, 0, 0, 0, 260);
        glow.addColorStop(0, '#e9943c33'); glow.addColorStop(1, '#e9943c00');
        context.fillStyle = glow; context.fillRect(-260, -260, 520, 400);
        for (let index = 0; index < 7; index++) {
          const left = index * 17 - 48;
          const height = 35 + Math.sin(time * 5 + index * 3 + position) * 15 + (3 - Math.abs(3 - index)) * 16;
          this.polygon([[left - 18, 0], [left - 8, -height * 0.55], [left + 4 + Math.sin(time * 6 + index) * 8, -height], [left + 10, -height * 0.35], [left + 22, 0]], index % 2 ? '#db7839' : '#f7b351');
          this.polygon([[left - 9, 0], [left + 3, -height * 0.5], [left + 13, 0]], '#ffe5a0');
        }
        context.restore();
      }
    }
    renderTelegraph() {
      const context = this.context;
      const action = this.boss.action;
      if (!action || action.t > action.windup + (action.kind === 'slam' && this.boss.phase === 2 ? 0.7 : 0.06)) return;
      const pulse = 0.32 + Math.sin(action.t * 16) * 0.1;
      context.save();
      const color = action.kind === 'oil' ? '211, 174, 75' : '233, 111, 78';
      context.fillStyle = `rgba(${color},${pulse * 0.4})`;
      context.strokeStyle = `rgba(${color},${pulse + 0.2})`;
      context.lineWidth = 3;
      if (action.kind === 'charge') {
        const front = action.startX + this.boss.direction * 450;
        const destination = front + this.boss.direction * 1150;
        context.fillRect(Math.min(front, destination) - 200, GROUND - 4, Math.abs(destination - front) + 400, 16);
        for (let index = 0; index < 5; index++) {
          const center = front + (destination - front) * index / 5;
          this.polygon([[center, GROUND - 8], [center + this.boss.direction * 50, GROUND], [center, GROUND + 8]], `rgba(${color},.7)`);
        }
      } else {
        const radius = action.radius;
        context.beginPath(); context.ellipse(action.x, GROUND + 4, radius, 20, 0, 0, Math.PI * 2); context.fill(); context.stroke();
        context.setLineDash([10, 12]); context.beginPath(); context.moveTo(action.x - radius, GROUND - 4); context.lineTo(action.x + radius, GROUND - 4); context.stroke();
        context.setLineDash([]);
      }
      const labelX = action.kind === 'charge' ? action.startX + this.boss.direction * 580 : action.x;
      context.font = '500 19px "PingFang SC", sans-serif'; context.textAlign = 'center'; context.fillStyle = '#ffd3ac'; context.shadowColor = '#111'; context.shadowBlur = 5;
      context.fillText(action.name, labelX, GROUND - 175);
      const remaining = action.kind === 'slam' && action.fired === 1 && this.boss.phase === 2 ? 1.82 - action.t : action.windup - action.t;
      context.font = '13px monospace'; context.fillStyle = '#e5baa1';
      context.fillText(remaining > 0 ? `${remaining.toFixed(1)}s` : '！', labelX, GROUND - 145);
      context.restore();
    }
    renderDragon() {
      const context = this.context;
      const boss = this.boss;
      const action = boss.action;
      const time = this.ambientTime;
      let lift = 0;
      let tilt = 0;
      let stretch = 1;
      if (action) {
        const progress = clamp(action.t / action.windup, 0, 1);
        if (action.kind === 'slam') {
          lift = action.t < action.windup ? -Math.sin(progress * Math.PI / 2) * 85 : -Math.max(0, 1 - (action.t - action.windup) * 7) * 55;
          tilt = action.t < action.windup ? -0.025 * progress : Math.max(0, 0.018 - (action.t - action.windup) * 0.07);
        }
        if (action.kind === 'sweep' || action.kind === 'tail') { tilt = Math.sin(action.t / action.duration * Math.PI * 2) * 0.03; stretch = 1 + Math.sin(action.t * 6) * 0.035; }
        if (action.kind === 'oil') tilt = -0.018 * Math.sin(action.t * 3);
        if (action.kind === 'charge') { lift = action.t > action.windup ? Math.sin(action.t * 27) * 8 : -progress * 12; tilt = 0.015; }
      }
      context.save();
      context.fillStyle = '#0c161b72'; context.beginPath(); context.ellipse(boss.x - 40, GROUND + 8, 730, 35, 0, 0, Math.PI * 2); context.fill();
      context.translate(boss.x, GROUND + lift);
      context.scale(boss.direction === -1 ? 1 : -1, 1);
      context.rotate(tilt);
      context.scale(stretch, 1 + Math.sin(time * 1.3) * 0.002);
      context.imageSmoothingEnabled = false;
      if (this.dragonImage.complete && this.dragonImage.naturalWidth) {
        const height = 1840 * this.dragonImage.height / this.dragonImage.width;
        const articulate = action && ['slam', 'sweep', 'charge'].includes(action.kind) && this.dragonBody.complete && this.dragonBody.naturalWidth && this.dragonForeleg.complete && this.dragonForeleg.naturalWidth;
        const bodyImage = articulate ? this.dragonBody : this.dragonImage;
        context.drawImage(bodyImage, -920, -height + 54, 1840, height);
        if (articulate) {
          let angle = 0;
          if (action.kind === 'slam') {
            const currentImpact = action.fired > 0 && this.boss.phase === 2 ? 1.82 : action.windup;
            const before = currentImpact - action.t;
            angle = before > 0 ? Math.min(1, before / 0.35) * Math.min(1, action.t / 0.8) * 0.72 : Math.max(0, 1 + before * 12) * -0.09;
          }
          if (action.kind === 'sweep') angle = Math.sin(action.t / action.duration * Math.PI * 2) * 0.38;
          if (action.kind === 'charge') angle = Math.sin(action.t * 13) * 0.15;
          const pivotX = -920 + 282 / 796 * 1840;
          const pivotY = -height + 54 + 275 / 472 * height;
          context.save(); context.translate(pivotX, pivotY); context.rotate(angle);
          context.drawImage(this.dragonForeleg, -920 - pivotX, -height + 54 - pivotY, 1840, height);
          context.restore();
        }
        if (boss.hurt > 0) {
          context.globalAlpha = boss.hurt * 0.9;
          context.globalCompositeOperation = 'screen';
          context.drawImage(this.dragonImage, -920, -height + 54, 1840, height);
          context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1;
        }
      } else {
        this.polygon([[-850, -330], [-720, -720], [-470, -900], [-60, -1000], [480, -580], [790, -170], [590, 0], [360, -300], [-340, -270], [-500, 0], [-620, -30]], '#303c3d', '#c1b183', 8);
        context.fillStyle = '#eb9d52'; context.fillRect(-750, -570, 50, 15);
      }
      if (boss.phase === 2) {
        context.globalAlpha = 0.5 + Math.sin(time * 3) * 0.2;
        context.shadowColor = '#fa9f3d'; context.shadowBlur = 35;
        for (const point of [[-110, -685], [110, -540], [-430, -390], [230, -290]]) {
          context.fillStyle = '#e4ab5a'; context.fillRect(point[0], point[1], 8, 15);
        }
      }
      context.restore();
      if (boss.weakUntil > this.time) {
        const position = boss.x + boss.direction * 450;
        context.save(); context.translate(position, GROUND - 150); context.rotate(Math.PI / 4);
        context.strokeStyle = '#ffd58c'; context.lineWidth = 4; context.shadowColor = '#ffc46c'; context.shadowBlur = 20;
        const size = 26 + Math.sin(time * 5) * 3;
        context.strokeRect(-size, -size, size * 2, size * 2); context.restore();
        context.fillStyle = '#ffe3a9'; context.textAlign = 'center'; context.font = '16px "PingFang SC", sans-serif'; context.fillText('伤口', position, GROUND - 215);
      }
      if (action && ['slam', 'sweep'].includes(action.kind) && action.t < action.windup) {
        context.save(); context.strokeStyle = '#f1b177'; context.lineWidth = 3; context.globalAlpha = 0.55 + Math.sin(time * 15) * 0.2;
        context.beginPath(); context.arc(action.x, GROUND - 160 - (action.kind === 'slam' ? 180 * action.t / action.windup : 0), 80, 0.2, Math.PI * 1.6); context.stroke(); context.restore();
      }
    }
    renderHunter(x = this.player.x, y = this.player.y, direction = this.player.direction, alpha = 1, ghost = false) {
      const context = this.context;
      const player = this.player;
      const action = player.action;
      const moving = Math.abs(player.x - player.previousX) > 0.5;
      const phase = moving ? player.step : this.ambientTime * 1.5;
      const bounce = moving && player.y === GROUND ? Math.sin(phase * 2) * 3 : Math.sin(phase) * 1;
      let lean = 0;
      let swordAngle = -0.42;
      let armAngle = -0.08;
      let crouch = player.sheath ? 15 : 0;
      if (action) {
        const progress = action.t / (action.duration || 1);
        if (['light', 'heavy', 'spirit', 'roundslash', 'retreat', 'release'].includes(action.kind)) {
          const swing = clamp((action.t - action.windup) / Math.max(0.08, action.active), 0, 1);
          swordAngle = action.t < action.windup ? -2.1 - (action.kind === 'heavy' ? 0.5 : 0) : lerp(-2.2, 1.4, ease(swing));
          if (action.step === 2) swordAngle *= -0.8;
          armAngle = swordAngle * 0.35;
          lean = action.t > action.windup ? 0.16 : -0.13;
          crouch = action.kind === 'heavy' ? 9 : 4;
        }
        if (['iai', 'thrust', 'focus'].includes(action.kind)) { lean = 0.3; swordAngle = -0.06; armAngle = -0.05; crouch = 12; }
        if (action.kind === 'charge') { swordAngle = -2.2; armAngle = -0.8; lean = -0.16; crouch = 15; }
        if (action.kind === 'dodge') { lean = progress * Math.PI * 2; crouch = 24; swordAngle = -0.9; }
        if (action.kind === 'foresight') { lean = action.t < 0.4 ? -0.35 : 0.2; swordAngle = action.t < 0.4 ? -1 : 0.5; crouch = 10; }
        if (action.kind === 'helmRise') { swordAngle = -1.4; armAngle = -0.8; lean = -0.2; }
        if (action.kind === 'helmFall') { swordAngle = 1.5; armAngle = 0.7; lean = 0.23; }
        if (action.kind === 'hurt') { lean = -0.4; swordAngle = 0.9; crouch = 14; }
      }
      context.save();
      context.globalAlpha = alpha * (!ghost && player.invulnerable > 0 && Math.floor(this.ambientTime * 20) % 2 ? 0.5 : 1);
      context.translate(x, y);
      if (!ghost) {
        context.fillStyle = '#0d151d77'; context.beginPath(); context.ellipse(0, 4, 42, 7, 0, 0, Math.PI * 2); context.fill();
        context.strokeStyle = BLADE_COLORS[player.blade]; context.globalAlpha *= 0.22;
        context.beginPath(); context.ellipse(0, 3, 45 + player.blade * 8, 8, 0, 0, Math.PI * 2); context.stroke(); context.globalAlpha = alpha;
      }
      context.scale(direction, 1);
      context.translate(0, -46 + crouch + bounce);
      context.rotate(lean);
      const legSwing = moving ? Math.sin(phase) * 12 : 0;
      const capeWave = Math.sin(this.ambientTime * 6) * 5;
      this.polygon([[-13, -35], [-35, -21], [-64 - capeWave, 6], [-43, 5], [-69, 26], [-24, 15], [2, -5]], ghost ? '#bfdecb' : '#633346', '#1e202c', 3);
      this.polygon([[-14, -31], [-40, -10], [-52, 3], [-28, -4]], '#9d4b53');
      this.polygon([[-8, 7], [-23 - legSwing, 32], [-31 - legSwing, 44], [-14 - legSwing, 46], [2, 22], [9, 10]], '#343543', '#171e28', 3);
      this.polygon([[-18 - legSwing, 25], [-24 - legSwing, 38], [-14 - legSwing, 37], [-5, 22]], '#888a9c');
      this.polygon([[2, 8], [11 + legSwing, 25], [19 + legSwing, 43], [40 + legSwing, 45], [34 + legSwing, 37], [27 + legSwing, 17], [17, 7]], '#3a3c48', '#151d27', 3);
      this.polygon([[14 + legSwing, 23], [20 + legSwing, 36], [30 + legSwing, 36], [26 + legSwing, 20]], '#9da0a3');
      this.polygon([[-15, -31], [9, -36], [20, -21], [13, 7], [-5, 17], [-21, 8], [-13, -10]], '#464755', '#171c28', 3);
      this.polygon([[-12, -26], [7, -30], [14, -17], [-5, -12], [-17, -16]], '#9595a4');
      this.polygon([[-12, -4], [10, -4], [16, 5], [-2, 10], [-18, 5]], '#9f7452', '#252330', 2);
      this.polygon([[-10, 10], [4, 10], [-2, 36], [-14, 27]], '#7b3447');
      this.polygon([[-13, -39], [-17, -56], [-8, -66], [4, -65], [14, -51], [11, -38], [0, -30]], '#6c6e80', '#151c27', 3);
      this.polygon([[-12, -56], [-23, -76], [-8, -66], [0, -73], [13, -62], [13, -46], [4, -51]], '#c0ada1', '#2b2430', 2);
      this.polygon([[3, -53], [16, -48], [12, -43], [2, -43]], '#302a39');
      context.fillStyle = '#f7d388'; context.fillRect(8, -49, 6, 3);
      this.polygon([[-16, -30], [-27, -29], [-31, -15], [-14, -14], [-7, -23]], '#777b8a', '#1c202a', 3);
      context.save(); context.translate(8, -24); context.rotate(armAngle);
      this.polygon([[0, 0], [15, 2], [26, 15], [18, 22], [5, 11]], '#848798', '#1b202b', 3);
      this.polygon([[19, 14], [38, 9], [42, 17], [26, 24], [18, 22]], '#424352', '#202330', 3);
      context.fillStyle = '#b0a29a'; context.fillRect(34, 8, 10, 10);
      context.save(); context.translate(39, 12);
      if (player.sheath) {
        context.rotate(2.9); this.polygon([[-10, -3], [135, -5], [144, 0], [129, 4], [-10, 4]], '#292d37', '#a38c68', 2);
      } else {
        context.rotate(swordAngle);
        context.fillStyle = '#251e28'; context.fillRect(-34, -4, 42, 9);
        for (let index = 0; index < 5; index++) { context.fillStyle = '#a35749'; context.fillRect(-31 + index * 7, -4, 3, 9); }
        context.fillStyle = '#d0a05f'; context.fillRect(2, -13, 5, 26);
        if (player.blade === 2 || action?.kind === 'charge') { context.shadowColor = BLADE_COLORS[player.blade]; context.shadowBlur = 18; }
        this.polygon([[7, -5], [159, -13], [178, -23], [161, -1], [7, 4]], '#e4e8dc', '#5f7077', 2);
        this.polygon([[13, -3], [158, -10], [168, -15], [158, -5], [13, 2]], BLADE_COLORS[player.blade]);
      }
      context.restore(); context.restore();
      context.restore();
      if (!ghost && player.sheath && this.time >= player.sheathReady) {
        context.save(); context.strokeStyle = '#d8e6c4'; context.lineWidth = 2; context.globalAlpha = 0.6 + Math.sin(this.ambientTime * 6) * 0.3;
        context.beginPath(); context.moveTo(x - 15, y - 125); context.lineTo(x, y - 136); context.lineTo(x + 15, y - 125); context.stroke(); context.restore();
      }
    }
    renderHazards() {
      const context = this.context;
      for (const pool of this.oilPools) {
        const hot = pool.ignition - pool.age < 1.25 && !pool.exploded;
        context.fillStyle = hot && Math.sin(this.ambientTime * 18) > 0 ? '#71442c' : '#171e22';
        context.beginPath(); context.ellipse(pool.x, GROUND + 3, pool.radius, 19, 0, 0, Math.PI * 2); context.fill();
        context.strokeStyle = hot ? '#efad62' : '#7d7955'; context.lineWidth = 3;
        context.beginPath(); context.ellipse(pool.x - 10, GROUND, pool.radius * 0.7, 10, 0, 0, Math.PI * 2); context.stroke();
        if (hot) { context.fillStyle = '#ffd7a0'; context.font = '17px "PingFang SC",sans-serif'; context.textAlign = 'center'; context.fillText('油池即将爆炸', pool.x, GROUND - 45); }
      }
      for (const projectile of this.projectiles) {
        context.fillStyle = '#161d22'; context.strokeStyle = '#9b7c49'; context.lineWidth = 4;
        context.beginPath(); context.ellipse(projectile.x, projectile.y, 33, 20, 0.6, 0, Math.PI * 2); context.fill(); context.stroke();
        this.polygon([[projectile.x, projectile.y], [projectile.x - this.boss.direction * 95, projectile.y - 65], [projectile.x - this.boss.direction * 30, projectile.y + 5]], '#1c2228');
      }
    }
    renderEffects() {
      const context = this.context;
      for (const effect of this.effects) {
        context.save(); context.globalAlpha = clamp(effect.life / effect.maxLife, 0, 1);
        if (effect.kind === 'particle') {
          context.fillStyle = effect.color; context.translate(effect.x, effect.y); context.rotate(effect.velocityX * 0.01);
          context.fillRect(-effect.size / 2, -effect.size / 2, effect.size, effect.size * 1.7);
        } else {
          const progress = 1 - effect.life / effect.maxLife;
          context.strokeStyle = effect.color; context.lineWidth = 12 * (1 - progress); context.shadowColor = effect.color; context.shadowBlur = 12;
          context.beginPath(); context.ellipse(effect.x, effect.y, effect.radius * ease(progress), effect.kind === 'explosion' ? effect.radius * ease(progress) * 0.5 : 30, 0, 0, Math.PI * 2); context.stroke();
        }
        context.restore();
      }
      for (const slash of this.slashes) {
        const progress = 1 - slash.life / slash.maxLife;
        context.save(); context.translate(slash.x, slash.y); context.scale(slash.direction, 1); context.rotate(slash.angle);
        context.globalAlpha = (1 - progress) * 0.9; context.strokeStyle = slash.color; context.shadowColor = slash.color; context.shadowBlur = 22; context.lineWidth = 13 * (1 - progress) + 2;
        context.beginPath();
        if (slash.kind === 'horizontal') { context.moveTo(-slash.radius * 0.8, 10); context.lineTo(slash.radius * 1.1, -10); }
        else if (slash.kind === 'vertical') { context.moveTo(-slash.radius * 0.15, -slash.radius * 0.8); context.lineTo(slash.radius * 0.1, slash.radius * 0.45); }
        else context.ellipse(0, 0, slash.radius * 0.83, slash.radius * 0.48, -0.25, -2.4 + progress * 0.8, 1.7 + progress * 0.5);
        context.stroke();
        context.shadowBlur = 0; context.lineWidth = 3; context.strokeStyle = '#fff6da'; context.stroke();
        context.restore();
      }
      for (const number of this.numbers) {
        context.save(); context.globalAlpha = Math.min(1, number.life * 3);
        context.font = `${number.big ? '700 39' : '600 29'}px "Space Grotesk", monospace`;
        context.textAlign = 'center'; context.fillStyle = number.color; context.shadowColor = '#101817'; context.shadowBlur = 5; context.strokeStyle = '#242826'; context.lineWidth = 4;
        context.strokeText(number.text, number.x, number.y); context.fillText(number.text, number.x, number.y); context.restore();
      }
    }
    render() {
      const context = this.context;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, WIDTH, HEIGHT);
      this.renderBackground();
      context.save();
      const shakeX = this.camera.shake ? (this.random() - 0.5) * this.camera.shake : 0;
      const shakeY = this.camera.shake ? (this.random() - 0.5) * this.camera.shake * 0.5 : 0;
      context.translate(WIDTH / 2 + shakeX, HEIGHT * 0.775 + shakeY);
      context.scale(this.camera.zoom, this.camera.zoom);
      context.translate(-this.camera.x, -GROUND);
      this.renderGround();
      this.renderFires();
      this.renderDragon();
      this.renderHazards();
      this.renderTelegraph();
      for (const trace of this.player.trail) this.renderHunter(trace.x, trace.y, trace.direction, trace.life * 1.8, true);
      this.renderHunter();
      this.renderEffects();
      context.restore();
      for (const ember of this.scenery.embers) {
        const left = (ember.x + this.ambientTime * ember.speed * 0.7) % (WIDTH + 40) - 20;
        const top = (ember.y - this.ambientTime * ember.speed + HEIGHT * 1000) % HEIGHT;
        context.globalAlpha = 0.35 + Math.sin(this.ambientTime * 2 + ember.phase) * 0.25;
        context.fillStyle = ember.size > 2 ? '#efb877' : '#b1b8ac'; context.fillRect(left, top, ember.size, ember.size);
      }
      context.globalAlpha = 1;
      const vignette = context.createRadialGradient(WIDTH * 0.54, HEIGHT * 0.5, 200, WIDTH * 0.5, HEIGHT * 0.5, WIDTH * 0.68);
      vignette.addColorStop(0, '#0e131800'); vignette.addColorStop(1, '#0e1318ba');
      context.fillStyle = vignette; context.fillRect(0, 0, WIDTH, HEIGHT);
      if (this.flash > 0) { context.fillStyle = `rgba(236,245,220,${Math.min(0.4, this.flash * 2.2)})`; context.fillRect(0, 0, WIDTH, HEIGHT); }
    }
  }

  window.HuntGame = HuntGame;
  window.hunt = new HuntGame();
})();
