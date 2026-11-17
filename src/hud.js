// HUD + minimap + menus (DOM). All game state is read from G each frame.
export class HUD {
  constructor(G) {
    this.G = G;
    this.el = {};
    for (const id of ['health-fill', 'health-num', 'money', 'stars', 'mission-title',
      'mission-obj', 'mission-dist', 'speed', 'speed-box', 'prompt', 'toast', 'vignette',
      'menu', 'paused', 'busted', 'wasted', 'complete', 'menu-sub', 'end-title', 'end-text',
      'btn-start', 'btn-continue', 'btn-resume', 'btn-retry', 'btn-retry2', 'btn-freeroam',
      'btn-restart', 'save-note']) {
      this.el[id] = document.getElementById(id);
    }
    this.map = document.getElementById('minimap');
    this.mapCtx = this.map.getContext('2d');
    this.toastTimer = 0;
    this.lastMoney = -1;
  }

  toast(msg, dur = 3.2) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('show');
    this.toastTimer = dur;
  }

  update(dt) {
    const G = this.G;
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('show');
    }
    // health
    const hp = Math.max(0, Math.round(G.player.health));
    this.el['health-fill'].style.width = hp + '%';
    this.el['health-fill'].style.background = hp > 50 ? '#58c96b' : hp > 25 ? '#e0a83c' : '#d64545';
    this.el['health-num'].textContent = hp;
    // money
    if (G.money !== this.lastMoney) {
      this.el.money.textContent = '$' + G.money.toLocaleString('en-US');
      this.lastMoney = G.money;
    }
    // stars
    let s = '';
    for (let i = 0; i < 5; i++) s += i < G.wanted ? '★' : '☆';
    this.el.stars.textContent = s;
    this.el.stars.style.color = G.wanted >= 3 ? '#ff5a4e' : G.wanted > 0 ? '#ffc94d' : '#5a636e';
    // mission
    const m = G.missions.current();
    if (m) {
      this.el['mission-title'].textContent = 'MISSION ' + (m.idx + 1) + ' — ' + m.name;
      this.el['mission-obj'].textContent = m.objective;
      const d = m.marker ? Math.round(G.missions.markerDist) : 0;
      this.el['mission-dist'].textContent = m.marker ? d + 'm' : '';
    } else if (G.storyDone) {
      this.el['mission-title'].textContent = 'FREE ROAM';
      this.el['mission-obj'].textContent = 'Solmar Bay is yours. Cause trouble or just cruise.';
      this.el['mission-dist'].textContent = '';
    } else {
      this.el['mission-title'].textContent = 'SOLMAR BAY';
      this.el['mission-obj'].textContent = 'Talk to Mara to start the next job.';
      this.el['mission-dist'].textContent = '';
    }
    // speed
    if (G.player.inCar) {
      this.el['speed-box'].style.display = 'block';
      this.el.speed.textContent = Math.round(Math.abs(G.player.car.speed) * 3.2);
    } else {
      this.el['speed-box'].style.display = 'none';
    }
    // prompt
    this.el.prompt.textContent = G.prompt || '';
    // vignette
    const v = G.player.damageFlash > 0 ? Math.min(0.75, G.player.damageFlash) : 0;
    this.el.vignette.style.opacity = v.toFixed(2);
    this.drawMinimap();
  }

  drawMinimap() {
    const G = this.G, ctx = this.mapCtx, S = 190;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(16,20,24,0.85)';
    ctx.fillRect(0, 0, S, S);
    const B = 208;
    const px = (wx) => ((wx + B) / (B * 2)) * S;
    const pz = (wz) => ((wz + B) / (B * 2)) * S;
    // roads
    ctx.strokeStyle = '#3d454f';
    ctx.lineWidth = 4;
    for (const r of G.city.roads) {
      ctx.beginPath(); ctx.moveTo(px(r), 0); ctx.lineTo(px(r), S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, pz(r)); ctx.lineTo(S, pz(r)); ctx.stroke();
    }
    // safehouse
    ctx.fillStyle = '#58c96b';
    ctx.fillRect(px(G.city.safehouse.x) - 4, pz(G.city.safehouse.z) - 4, 8, 8);
    // mission marker
    const m = G.missions.current();
    if (m && m.marker) {
      const pulse = 5 + Math.sin(performance.now() / 180) * 2;
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath();
      ctx.arc(px(m.marker.x), pz(m.marker.z), pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // traffic + police
    for (const c of G.traffic) {
      ctx.fillStyle = c.isPolice ? '#ff5a4e' : '#9aa3ab';
      ctx.fillRect(px(c.pos.x) - 2, pz(c.pos.z) - 2, 4, 4);
    }
    for (const c of G.parked) {
      ctx.fillStyle = '#5a636e';
      ctx.fillRect(px(c.pos.x) - 2, pz(c.pos.z) - 2, 4, 4);
    }
    // player arrow (rotates with heading)
    const p = G.player;
    ctx.save();
    ctx.translate(px(p.pos.x), pz(p.pos.z));
    ctx.rotate(-p.heading);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath();
    ctx.fill();
    ctx.restore();
    // north tick
    ctx.fillStyle = '#8a939c';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('N', S / 2 - 3, 10);
  }

  showMenu(hasSave) {
    this.el.menu.classList.remove('hidden');
    this.el['btn-continue'].style.display = hasSave ? 'block' : 'none';
    this.el['save-note'].textContent = hasSave ? 'Save found — continue where you left off.' : '';
  }
  hideMenu() { this.el.menu.classList.add('hidden'); }
  showPaused() { this.el.paused.classList.remove('hidden'); }
  hidePaused() { this.el.paused.classList.add('hidden'); }
  showBusted() { this.el.busted.classList.remove('hidden'); }
  hideBusted() { this.el.busted.classList.add('hidden'); }
  showWasted() { this.el.wasted.classList.remove('hidden'); }
  hideWasted() { this.el.wasted.classList.add('hidden'); }
  showComplete() {
    this.el['end-title'].textContent = 'SOLMAR BAY IS YOURS';
    this.el['end-text'].textContent = 'All six jobs done. Mara is proud — and the city knows your name now. Keep driving, or start a new story.';
    this.el.complete.classList.remove('hidden');
  }
  hideComplete() { this.el.complete.classList.add('hidden'); }
}
