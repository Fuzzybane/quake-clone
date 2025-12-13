// --- CONFIGURATION ---
const socket = io();
let scene, camera, renderer, controls;
let objects = []; 
let ammoMeshes = {}; 
let healthMeshes = {}; // NEW: Store health packs
let players = {}; 
let myId;
let myHealth = 100;
let myScore = 0;

let audioCtx;
let gameActive = false; 
let isChatting = false;

// Weapon View Models
let weaponGroup; 
let gunModels = []; 

// Movement
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let canJump = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let prevTime = performance.now();
const raycaster = new THREE.Raycaster();

const WEAPONS = [
    { name: "BLASTER", damage: 15, cooldown: 250, color: 0xffff00, speed: 1, spread: 0, infinite: true },
    { name: "SHOTGUN", damage: 8, cooldown: 800, color: 0xffaa00, speed: 2, spread: 0.15, count: 6, maxAmmo: 24, startAmmo: 12 },
    { name: "RAILGUN", damage: 100, cooldown: 1500, color: 0x00ffff, speed: 0, spread: 0, maxAmmo: 5, startAmmo: 5 }
];

let currentWeaponIdx = 0;
let lastShotTime = 0;
let ammoStore = [999, WEAPONS[1].startAmmo, WEAPONS[2].startAmmo]; 

// --- GLOBAL LISTENERS ---
socket.on('updatePlayerList', (count) => { const el = document.getElementById('player-count'); if(el) el.innerText = count; });
socket.on('serverMessage', (msg) => {
    let container = document.getElementById('messages-container');
    if(!container) { container = document.createElement('div'); container.id = 'messages-container'; document.body.appendChild(container); }
    const div = document.createElement('div'); div.className = 'msg-entry'; div.innerText = msg; container.appendChild(div);
    setTimeout(() => div.remove(), 5000);
});
socket.on('chatMessage', (data) => {
    const history = document.getElementById('chat-history'); if(!history) return;
    const div = document.createElement('div'); div.className = 'chat-msg-item'; div.innerText = `${data.name}: ${data.text}`;
    history.appendChild(div); history.scrollTop = history.scrollHeight;
    if(history.children.length > 10) history.removeChild(history.children[0]);
});

// --- GAME STATE LISTENERS ---
socket.on('scoreUpdate', (data) => { if (data.id === socket.id) { myScore = data.score; document.getElementById('score-display').innerText = myScore; } });
socket.on('gameOver', (winnerName) => {
    gameActive = false; document.exitPointerLock();
    const overlay = document.getElementById('game-over-overlay'); overlay.style.display = 'flex';
    document.getElementById('winner-text').innerText = `${winnerName} WINS!`;
    let countdown = 6;
    const interval = setInterval(() => { countdown--; if(countdown>0) document.getElementById('restart-timer').innerText = `Returning to lobby in ${countdown}...`; else clearInterval(interval); }, 1000);
});
socket.on('gameReset', (allPlayersData) => {
    document.getElementById('game-over-overlay').style.display = 'none'; document.getElementById('menu-overlay').style.display = 'flex';
    document.getElementById('hud').style.display = 'none'; document.getElementById('crosshair').style.display = 'none';
    document.getElementById('chat-input').style.display = 'none'; isChatting = false;
    myScore = 0; document.getElementById('score-display').innerText = 0;
    ammoStore = [999, WEAPONS[1].startAmmo, WEAPONS[2].startAmmo]; updateHUD();
    if(allPlayersData[socket.id]) { const p = allPlayersData[socket.id]; controls.getObject().position.set(p.x, p.y, p.z); velocity.set(0,0,0); }
});

// --- TEXTURE GENERATOR ---
function generateTexture(type) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512; const ctx = canvas.getContext('2d');
    if(type === 'grid') { 
        ctx.fillStyle = '#111'; ctx.fillRect(0,0,512,512);
        ctx.strokeStyle = '#0f0'; ctx.lineWidth = 4; ctx.shadowBlur = 10; ctx.shadowColor = '#0f0'; ctx.beginPath();
        for(let i=0; i<=512; i+=64) { ctx.moveTo(i,0); ctx.lineTo(i,512); ctx.moveTo(0,i); ctx.lineTo(512,i); } ctx.stroke();
    } else if(type === 'wall') { 
        ctx.fillStyle = '#444'; ctx.fillRect(0,0,512,512); ctx.fillStyle = '#222'; 
        ctx.fillRect(10, 10, 236, 236); ctx.fillRect(266, 10, 236, 236); ctx.fillRect(10, 266, 236, 236); ctx.fillRect(266, 266, 236, 236);
        ctx.strokeStyle = '#666'; ctx.strokeRect(0,0,512,512);
    } else if(type === 'crate') { 
        ctx.fillStyle = '#333'; ctx.fillRect(0,0,512,512); ctx.strokeStyle = '#fff'; ctx.lineWidth = 10;
        ctx.strokeRect(20,20,472,472); ctx.beginPath(); ctx.moveTo(20,20); ctx.lineTo(492,492); ctx.moveTo(492,20); ctx.lineTo(20,492); ctx.stroke();
    } else if(type === 'health') { // NEW: Health Pack Texture
        ctx.fillStyle = '#eee'; ctx.fillRect(0,0,512,512); // White Box
        ctx.fillStyle = '#f00'; // Red Cross
        ctx.fillRect(180, 50, 152, 412); // Vertical
        ctx.fillRect(50, 180, 412, 152); // Horizontal
        ctx.strokeStyle = '#ccc'; ctx.strokeRect(0,0,512,512);
    }
    const tex = new THREE.CanvasTexture(canvas); tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; return tex;
}
const MAT_FLOOR = new THREE.MeshStandardMaterial({ map: generateTexture('grid'), roughness: 0.8 });
const MAT_WALL = new THREE.MeshStandardMaterial({ map: generateTexture('wall'), roughness: 0.2, metalness: 0.5 });

// --- AUDIO ---
function initAudio() { if(!audioCtx) { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); startAmbience(); } if(audioCtx.state === 'suspended') audioCtx.resume(); }
function playSound(type) {
    if(!audioCtx) return; const t = audioCtx.currentTime;
    if(type === 'BLASTER') {
        const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(110, t+0.2);
        g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.01, t+0.2); o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(t+0.2);
    } else if(type === 'SHOTGUN') {
        const b = audioCtx.createBuffer(1, audioCtx.sampleRate*0.5, audioCtx.sampleRate);
        const d = b.getChannelData(0); for(let i=0; i<d.length; i++) d[i]=Math.random()*2-1;
        const s = audioCtx.createBufferSource(); s.buffer = b; const g = audioCtx.createGain(); const f = audioCtx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 1000; g.gain.setValueAtTime(1.0, t); g.gain.exponentialRampToValueAtTime(0.01, t+0.3);
        s.connect(f); f.connect(g); g.connect(audioCtx.destination); s.start();
    } else if(type === 'RAILGUN') {
        const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
        o.type = 'square'; o.frequency.setValueAtTime(200, t); o.frequency.linearRampToValueAtTime(800, t+0.1); o.frequency.exponentialRampToValueAtTime(50, t+0.5);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t+0.1); g.gain.exponentialRampToValueAtTime(0.01, t+0.5);
        o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(t+0.6);
    }
}
function startAmbience() {
    const o1=audioCtx.createOscillator(); const o2=audioCtx.createOscillator(); const g=audioCtx.createGain();
    o1.type='triangle'; o1.frequency.value=50; o2.type='sine'; o2.frequency.value=55; g.gain.value=0.15;
    o1.connect(g); o2.connect(g); g.connect(audioCtx.destination); o1.start(); o2.start();
}

// --- INIT & LOOP ---
document.getElementById('join-btn').addEventListener('click', () => {
    const nickname = document.getElementById('nickname').value || "Player";
    const fragLimit = document.getElementById('frag-limit').value || 10;
    document.getElementById('menu-overlay').style.display = 'none'; document.getElementById('hud').style.display = 'flex'; document.getElementById('crosshair').style.display = 'block';
    if(!scene) init(); 
    initAudio(); gameActive = true; animate();
    socket.emit('joinGame', { nickname: nickname, fragLimit: fragLimit });
});

function init() {
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x050505); scene.fog = new THREE.Fog(0x050505, 0, 80);
    camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000); camera.position.y = 2;
    renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true; document.body.appendChild(renderer.domElement);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6); scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(20, 40, 20); dir.castShadow = true; 
    dir.shadow.camera.left = -100; dir.shadow.camera.right = 100; dir.shadow.camera.top = 100; dir.shadow.camera.bottom = -100;
    scene.add(dir);

    controls = new THREE.PointerLockControls(camera, document.body);
    document.body.addEventListener('click', () => { 
        if(gameActive && !isChatting && !controls.isLocked && document.getElementById('menu-overlay').style.display === 'none') {
            controls.lock(); if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        }
    });
    scene.add(controls.getObject());

    createFPSWeapons();
    createLevel();
    updateHUD();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', (e) => { 
        if(isChatting) return;
        switch (e.code) { case 'KeyW': moveForward=false; break; case 'KeyA': moveLeft=false; break; case 'KeyS': moveBackward=false; break; case 'KeyD': moveRight=false; break; } 
    });
    document.addEventListener('mousedown', onShoot);

    // Socket Events
    socket.on('currentPlayers', (serverPlayers) => { for (let id in serverPlayers) if (id !== socket.id) addOtherPlayer(serverPlayers[id]); });
    socket.on('newPlayer', (p) => addOtherPlayer(p));
    socket.on('playerMoved', (p) => { if (players[p.id]) { players[p.id].mesh.position.set(p.x, p.y, p.z); players[p.id].mesh.rotation.y = p.rotation; } });
    socket.on('playerDisconnected', (id) => { if (players[id]) { scene.remove(players[id].mesh); delete players[id]; } });
    socket.on('playerShot', (data) => {
        if(players[data.id]) {
            const start = players[data.id].mesh.position.clone(); start.y += 1.5;
            const end = new THREE.Vector3(start.x - Math.sin(players[data.id].mesh.rotation.y)*50, start.y, start.z - Math.cos(players[data.id].mesh.rotation.y)*50);
            let color = 0xffff00; let type = "BLASTER"; if(data.weapon && data.weapon.type) { type = data.weapon.type; const w = WEAPONS.find(w => w.name === type); if(w) color = w.color; }
            createBulletTrail(start, end, color); playSound(type);
        }
    });
    socket.on('healthUpdate', (data) => { if(data.id === socket.id) { myHealth = data.health; updateHUD(); document.body.style.boxShadow = "inset 0 0 50px red"; setTimeout(() => document.body.style.boxShadow = "none", 100); } });
    socket.on('playerRespawn', (data) => { if (data.id === socket.id) { controls.getObject().position.set(data.x, data.y, data.z); velocity.set(0,0,0); myHealth = 100; updateHUD(); } else if (players[data.id]) players[data.id].mesh.position.set(data.x, data.y, data.z); });
    
    socket.on('ammoState', (serverAmmo) => { for(let id in serverAmmo) { createAmmoBox(serverAmmo[id]); if(!serverAmmo[id].active) ammoMeshes[id].visible = false; } });
    socket.on('ammoTaken', (id) => { if(ammoMeshes[id]) ammoMeshes[id].visible = false; });
    socket.on('ammoRespawn', (id) => { if(ammoMeshes[id]) ammoMeshes[id].visible = true; });

    // NEW: Health Events
    socket.on('healthState', (serverHp) => { for(let id in serverHp) { createHealthBox(serverHp[id]); if(!serverHp[id].active) healthMeshes[id].visible = false; } });
    socket.on('healthTaken', (id) => { if(healthMeshes[id]) healthMeshes[id].visible = false; });
    socket.on('healthRespawn', (id) => { if(healthMeshes[id]) healthMeshes[id].visible = true; });
}

function createFPSWeapons() {
    weaponGroup = new THREE.Group(); weaponGroup.position.set(0.4, -0.3, -0.6); camera.add(weaponGroup); 
    const blaster = new THREE.Group(); blaster.add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.4), new THREE.MeshStandardMaterial({ color: 0xffff00 })));
    const bTip = new THREE.Object3D(); bTip.position.set(0, 0, -0.25); blaster.add(bTip); blaster.barrelTip = bTip;
    const shotgun = new THREE.Group(); shotgun.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.5), new THREE.MeshStandardMaterial({ color: 0x8B4513 })));
    const sTip = new THREE.Object3D(); sTip.position.set(0, 0.05, -0.85); shotgun.add(sTip); shotgun.barrelTip = sTip;
    const railgun = new THREE.Group(); railgun.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.6), new THREE.MeshStandardMaterial({ color: 0x222222 })));
    const rTip = new THREE.Object3D(); rTip.position.set(0, 0, -1.0); railgun.add(rTip); railgun.barrelTip = rTip;
    weaponGroup.add(blaster); weaponGroup.add(shotgun); weaponGroup.add(railgun);
    gunModels = [blaster, shotgun, railgun]; updateWeaponVisibility();
}
function updateWeaponVisibility() { gunModels.forEach((m, i) => m.visible = (i === currentWeaponIdx)); }

function createLevel() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), MAT_FLOOR);
    MAT_FLOOR.map.repeat.set(20,20); floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; floor.name = "floor"; scene.add(floor);
    const boxGeo = new THREE.BoxGeometry(10, 8, 10);
    function addWall(x, z, sx=1, sz=1) {
        const wGeo = (sx===1 && sz===1) ? boxGeo : new THREE.BoxGeometry(10*sx, 8, 10*sz);
        const m = new THREE.Mesh(wGeo, MAT_WALL); m.position.set(x,4,z); m.castShadow = true; m.receiveShadow = true;
        scene.add(m); objects.push(m); m.geometry.computeBoundingBox(); m.BBox = new THREE.Box3().setFromObject(m);
    }
    // New Map Layout
    addWall(15, 15); addWall(-15, -15); addWall(15, -15); addWall(-15, 15);
    addWall(40, 40); addWall(40, -40); addWall(-40, 40); addWall(-40, -40);
    addWall(60, 0, 1, 4); addWall(-60, 0, 1, 4); addWall(0, 60, 4, 1); addWall(0, -60, 4, 1);
    addWall(80, 80); addWall(-80, -80); addWall(80, -80); addWall(-80, 80);
    createBorderWalls();
}

function createBorderWalls() {
    const thickness = 10; const height = 20; const size = 200; const offset = size/2 + thickness/2; 
    const wallGeoH = new THREE.BoxGeometry(size + (thickness*2), height, thickness); 
    const wallGeoV = new THREE.BoxGeometry(thickness, height, size); 
    const positions = [ { x: 0, z: -offset, geo: wallGeoH }, { x: 0, z: offset, geo: wallGeoH }, { x: -offset, z: 0, geo: wallGeoV }, { x: offset, z: 0, geo: wallGeoV } ];
    positions.forEach(p => { const m = new THREE.Mesh(p.geo, MAT_WALL); m.position.set(p.x, height/2, p.z); scene.add(m); objects.push(m); m.geometry.computeBoundingBox(); m.BBox = new THREE.Box3().setFromObject(m); });
}

function createAmmoBox(data) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5,1.5,1.5), new THREE.MeshBasicMaterial({color:data.type==='shotgun'?0xffaa00:0x00ffff, wireframe:true}));
    m.position.set(data.x, 1.5, data.z); m.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshBasicMaterial({color:data.type==='shotgun'?0xffaa00:0x00ffff})));
    scene.add(m); ammoMeshes[data.id] = m; m.userData = data;
}

// NEW: Health Pack Creation
function createHealthBox(data) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5,1.5,1.5), new THREE.MeshBasicMaterial({map: generateTexture('health')}));
    m.position.set(data.x, 1.5, data.z); 
    scene.add(m); healthMeshes[data.id] = m; m.userData = data;