// --- CONFIGURATION ---
const socket = io();
let scene, camera, renderer, controls;
let objects = []; 
let groundObjects = []; 
let ammoMeshes = {}; 
let healthMeshes = {};
let flagMeshes = {}; 
let players = {}; 
let myId;
let myHealth = 100;
let myScore = 0;

let audioCtx;
let gameActive = false; 
let isChatting = false;
let mapLoaded = false; 
let cachedMapData = null;

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
const groundRaycaster = new THREE.Raycaster(); 

const WEAPONS = [
    { name: "BLASTER", damage: 15, cooldown: 250, color: 0xffff00, speed: 1, spread: 0, infinite: true },
    { name: "SHOTGUN", damage: 8, cooldown: 800, color: 0xffaa00, speed: 2, spread: 0.15, count: 6, maxAmmo: 24, startAmmo: 12 },
    { name: "RAILGUN", damage: 100, cooldown: 1500, color: 0x00ffff, speed: 0, spread: 0, maxAmmo: 5, startAmmo: 5 }
];

let currentWeaponIdx = 0;
let lastShotTime = 0;
let ammoStore = [999, WEAPONS[1].startAmmo, WEAPONS[2].startAmmo]; 

// --- TEXTURE & MATERIAL GENERATION ---
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
    } else if(type === 'health') { 
        ctx.fillStyle = '#eee'; ctx.fillRect(0,0,512,512); ctx.fillStyle = '#f00'; 
        ctx.fillRect(180, 50, 152, 412); ctx.fillRect(50, 180, 412, 152); 
        ctx.strokeStyle = '#ccc'; ctx.strokeRect(0,0,512,512);
    }
    const tex = new THREE.CanvasTexture(canvas); tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; return tex;
}
const MAT_FLOOR = new THREE.MeshStandardMaterial({ map: generateTexture('grid'), roughness: 0.8 });
const MAT_WALL = new THREE.MeshStandardMaterial({ map: generateTexture('wall'), roughness: 0.2, metalness: 0.5 });


// --- 1. SETUP SOCKET LISTENERS ---

socket.on('connect', () => { console.log("Connected to server"); });

// LISTENER FOR MODE UPDATE
socket.on('updateGameMode', (mode) => {
    const el = document.getElementById('mode-display');
    if(el) el.innerText = mode === 'CTF' ? 'CAPTURE THE FLAG' : 'DEATHMATCH';
});

socket.on('mapConfig', (mapData) => { 
    console.log("Map received");
    if(scene) {
        createLevel(mapData);
        mapLoaded = true;
    } else {
        cachedMapData = mapData; 
    }
});

socket.on('updatePlayerList', (count) => { 
    const el = document.getElementById('player-count'); 
    if(el) el.innerText = count; 
});

socket.on('serverMessage', (msg) => {
    let container = document.getElementById('messages-container');
    if(!container) return;
    const div = document.createElement('div'); 
    div.className = 'msg-entry'; 
    div.innerText = msg; 
    container.appendChild(div);
    setTimeout(() => div.remove(), 5000);
});

socket.on('chatMessage', (data) => {
    const history = document.getElementById('chat-history'); 
    if(!history) return;
    const div = document.createElement('div'); 
    div.className = 'chat-msg-item'; 
    div.innerText = `${data.name}: ${data.text}`;
    history.appendChild(div); 
    history.scrollTop = history.scrollHeight;
    if(history.children.length > 10) history.removeChild(history.children[0]);
});

socket.on('scoreUpdate', (data) => { if (data.id === socket.id) { myScore = data.score; document.getElementById('score-display').innerText = myScore; } });

socket.on('gameOver', (winnerName) => {
    gameActive = false; 
    document.exitPointerLock();
    const overlay = document.getElementById('game-over-overlay'); 
    overlay.style.display = 'flex';
    document.getElementById('winner-text').innerText = `${winnerName} WINS!`;
    let countdown = 6;
    const interval = setInterval(() => { 
        countdown--; 
        if(countdown > 0) document.getElementById('restart-timer').innerText = `Returning to lobby in ${countdown}...`; 
        else clearInterval(interval); 
    }, 1000);
});

socket.on('gameReset', (allPlayersData) => {
    document.getElementById('game-over-overlay').style.display = 'none'; 
    document.getElementById('menu-overlay').style.display = 'flex';
    document.getElementById('hud').style.display = 'none'; 
    document.getElementById('crosshair').style.display = 'none';
    document.getElementById('chat-input').style.display = 'none'; 
    isChatting = false;
    myScore = 0; 
    document.getElementById('score-display').innerText = 0;
    ammoStore = [999, WEAPONS[1].startAmmo, WEAPONS[2].startAmmo]; 
    updateHUD();
    
    // Reset flags
    if(flagMeshes.red) scene.remove(flagMeshes.red);
    if(flagMeshes.blue) scene.remove(flagMeshes.blue);
    flagMeshes = {};

    if(allPlayersData) {
        for(let id in allPlayersData) {
            if(players[id] && players[id].mesh) {
                const p = allPlayersData[id];
                players[id].mesh.position.set(p.x, p.y, p.z);
                players[id].mesh.visible = true; 
                players[id].animTime = 0; players[id].lastMoveTime = Date.now();
                if(id === socket.id) { controls.getObject().position.set(p.x, p.y, p.z); velocity.set(0,0,0); }
            }
        }
    }
});

// Entity Updates
socket.on('currentPlayers', (serverPlayers) => { for (let id in serverPlayers) if (id !== socket.id) addOtherPlayer(serverPlayers[id]); });
socket.on('newPlayer', (p) => addOtherPlayer(p));
socket.on('playerMoved', (p) => { 
    if (players[p.id]) { 
        players[p.id].mesh.position.set(p.x, p.y, p.z); 
        players[p.id].mesh.rotation.y = p.rotation; 
        players[p.id].lastMoveTime = Date.now();
    } 
});
socket.on('playerDisconnected', (id) => { if (players[id]) { scene.remove(players[id].mesh); delete players[id]; } });
socket.on('playerShot', (data) => {
    if(players[data.id]) {
        const start = players[data.id].mesh.position.clone(); start.y += 1.5;
        const end = new THREE.Vector3(start.x - Math.sin(players[data.id].mesh.rotation.y)*50, start.y, start.z - Math.cos(players[data.id].mesh.rotation.y)*50);
        let color = 0xffff00; let type = "BLASTER"; if(data.weapon && data.weapon.type) { type = data.weapon.type; const w = WEAPONS.find(w => w.name === type); if(w) color = w.color; }
        createBulletTrail(start, end, color); playSound(type);
    }
});
socket.on('healthUpdate', (data) => { 
    if(data.id === socket.id) { 
        const oldHealth = myHealth; myHealth = data.health; updateHUD(); 
        const vig = document.getElementById('damage-vignette');
        if(vig) {
            if (myHealth < oldHealth) vig.style.background = 'radial-gradient(circle, transparent 50%, rgba(255, 0, 0, 0.7) 100%)';
            else if (myHealth > oldHealth) vig.style.background = 'radial-gradient(circle, transparent 50%, rgba(0, 255, 0, 0.7) 100%)';
            vig.style.opacity = '1'; setTimeout(() => vig.style.opacity = '0', 300);
        }
        document.body.style.boxShadow = "inset 0 0 50px red"; setTimeout(() => document.body.style.boxShadow = "none", 300); 
    } 
});

socket.on('playerDied', (id) => {
    if (id === socket.id) { document.getElementById('winner-text').innerText = "RESPAWNING..."; document.getElementById('restart-timer').innerText = ""; document.getElementById('game-over-overlay').style.display = 'flex'; }
    else if (players[id]) { players[id].mesh.visible = false; }
});
socket.on('playerRespawn', (data) => { 
    if (data.id === socket.id) { controls.getObject().position.set(data.x, data.y, data.z); velocity.set(0,0,0); myHealth = 100; updateHUD(); document.getElementById('game-over-overlay').style.display = 'none'; }
    else if (players[data.id]) { players[data.id].mesh.position.set(data.x, data.y, data.z); players[data.id].mesh.visible = true; } 
});
socket.on('ammoState', (serverAmmo) => { for(let id in serverAmmo) { createAmmoBox(serverAmmo[id]); if(!serverAmmo[id].active) ammoMeshes[id].visible = false; } });
socket.on('ammoTaken', (id) => { if(ammoMeshes[id]) ammoMeshes[id].visible = false; });
socket.on('ammoRespawn', (id) => { if(ammoMeshes[id]) ammoMeshes[id].visible = true; });
socket.on('healthState', (serverHp) => { for(let id in serverHp) { createHealthBox(serverHp[id]); if(!serverHp[id].active) healthMeshes[id].visible = false; } });
socket.on('healthTaken', (id) => { if(healthMeshes[id]) healthMeshes[id].visible = false; });
socket.on('healthRespawn', (id) => { if(healthMeshes[id]) healthMeshes[id].visible = true; });

// FLAGS
socket.on('flagState', (flags) => { updateFlag('red', flags.red); updateFlag('blue', flags.blue); });
socket.on('flagUpdate', (flags) => { updateFlag('red', flags.red); updateFlag('blue', flags.blue); });
function updateFlag(color, data) {
    if(!scene) return;
    if(!flagMeshes[color]) {
        const geo = new THREE.CylinderGeometry(0.5, 0.5, 4, 8);
        const mat = new THREE.MeshBasicMaterial({ color: color === 'red' ? 0xff0000 : 0x0000ff });
        const mesh = new THREE.Mesh(geo, mat); scene.add(mesh); flagMeshes[color] = mesh;
    }
    const mesh = flagMeshes[color];
    if (data.carrier) mesh.visible = false; 
    else { mesh.visible = true; mesh.position.set(data.x, data.y + 2, data.z); }
}


// --- 2. AUDIO FUNCTIONS ---
function initAudio() { 
    if(!audioCtx) { 
        audioCtx = new (window.AudioContext || window.webkitAudioContext)(); 
        startAmbience(); 
    } 
    if(audioCtx.state === 'suspended') audioCtx.resume(); 
}

function playSound(type) {
    if(!audioCtx) return; 
    const t = audioCtx.currentTime;
    
    if(type === 'BLASTER') {
        const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(110, t+0.2);
        g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.01, t+0.2); 
        o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(t+0.2);
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


// --- 3. UI BUTTON LISTENERS ---
const joinBtn = document.getElementById('join-btn');
const addBotBtn = document.getElementById('add-bot-btn');
const removeBotBtn = document.getElementById('remove-bot-btn');

if(joinBtn) {
    joinBtn.addEventListener('click', () => {
        const nickname = document.getElementById('nickname').value || "Player";
        const fragLimit = document.getElementById('frag-limit').value || 10;
        const mode = document.getElementById('game-mode').value;
        
        document.getElementById('menu-overlay').style.display = 'none'; 
        document.getElementById('hud').style.display = 'flex'; 
        document.getElementById('crosshair').style.display = 'block';
        
        if(!scene) init(); 
        
        initAudio(); 
        gameActive = true; 
        
        if(cachedMapData && !mapLoaded) {
            createLevel(cachedMapData);
            mapLoaded = true;
        }

        animate(); 
        socket.emit('joinGame', { nickname: nickname, fragLimit: fragLimit, gameMode: mode });
    });
}
if(addBotBtn) addBotBtn.addEventListener('click', () => { socket.emit('addBot'); });
if(removeBotBtn) removeBotBtn.addEventListener('click', () => { socket.emit('removeBot'); });


// --- 4. CORE GAME FUNCTIONS ---

function init() {
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x050505); scene.fog = new THREE.Fog(0x050505, 0, 100);
    camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000); camera.position.y = 5;
    renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true; document.body.appendChild(renderer.domElement);
    
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8); scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0); dir.position.set(20, 60, 20); dir.castShadow = true; 
    dir.shadow.camera.left = -100; dir.shadow.camera.right = 100; dir.shadow.camera.top = 100; dir.shadow.camera.bottom = -100;
    scene.add(dir);

    // Initial Safe Floor (Prevents void falling before map load)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), MAT_FLOOR);
    MAT_FLOOR.map.repeat.set(22,22); floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; floor.name = "floor"; 
    scene.add(floor);
    groundObjects.push(floor);

    controls = new THREE.PointerLockControls(camera, document.body);
    document.body.addEventListener('click', () => { 
        if(gameActive && !isChatting && !controls.isLocked && document.getElementById('menu-overlay').style.display === 'none') {
            controls.lock(); if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        }
    });
    scene.add(controls.getObject());

    createFPSWeapons();
    updateHUD();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', (e) => { 
        if(isChatting) return;
        switch (e.code) { case 'KeyW': moveForward=false; break; case 'KeyA': moveLeft=false; break; case 'KeyS': moveBackward=false; break; case 'KeyD': moveRight=false; break; } 
    });
    document.addEventListener('mousedown', onShoot);
}

// --- DETAILED WEAPON MODELS ---
function createFPSWeapons() {
    weaponGroup = new THREE.Group();
    weaponGroup.position.set(0.4, -0.3, -0.6);
    camera.add(weaponGroup);

    // 1. BLASTER (Pistol)
    const blaster = new THREE.Group();
    const bMain = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.4), new THREE.MeshStandardMaterial({ color: 0xffff00 }));
    const bHandle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.1), new THREE.MeshStandardMaterial({ color: 0x444444 }));
    bHandle.position.set(0, -0.15, 0.1);
    blaster.add(bMain);
    blaster.add(bHandle);
    const bTip = new THREE.Object3D();
    bTip.position.set(0, 0, -0.25);
    blaster.add(bTip);
    blaster.barrelTip = bTip;

    // 2. SHOTGUN (Double Barrel)
    const shotgun = new THREE.Group();
    const sStock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.5), new THREE.MeshStandardMaterial({ color: 0x8B4513 }));
    const sBarrelL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    sBarrelL.rotation.x = -Math.PI / 2;
    sBarrelL.position.set(-0.07, 0.05, -0.4);
    const sBarrelR = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    sBarrelR.rotation.x = -Math.PI / 2;
    sBarrelR.position.set(0.07, 0.05, -0.4);
    shotgun.add(sStock);
    shotgun.add(sBarrelL);
    shotgun.add(sBarrelR);
    const sTip = new THREE.Object3D();
    sTip.position.set(0, 0.05, -0.85);
    shotgun.add(sTip);
    shotgun.barrelTip = sTip;

    // 3. RAILGUN (Sci-Fi)
    const railgun = new THREE.Group();
    const rBody = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.6), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    const rRailT = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.2), new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff }));
    rRailT.position.set(0, 0.18, -0.4);
    const rRailB = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.2), new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff }));
    rRailB.position.set(0, -0.18, -0.4);
    railgun.add(rBody);
    railgun.add(rRailT);
    railgun.add(rRailB);
    const rTip = new THREE.Object3D();
    rTip.position.set(0, 0, -1.0);
    railgun.add(rTip);
    railgun.barrelTip = rTip;

    weaponGroup.add(blaster);
    weaponGroup.add(shotgun);
    weaponGroup.add(railgun);

    gunModels = [blaster, shotgun, railgun];
    updateWeaponVisibility();
}

function updateWeaponVisibility() { gunModels.forEach((m, i) => m.visible = (i === currentWeaponIdx)); }

// --- LEVEL CREATION ---
function createLevel(mapData) {
    if(!mapData) return;
    
    // Clear old objects
    objects.forEach(o => scene.remove(o)); objects = [];
    groundObjects.forEach(o => scene.remove(o)); groundObjects = [];
    
    // Recreate Floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), MAT_FLOOR);
    MAT_FLOOR.map.repeat.set(22,22); floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; floor.name = "floor"; scene.add(floor);
    groundObjects.push(floor); 

    if(mapData.walls) {
        mapData.walls.forEach(w => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w.w, 8, w.d), MAT_WALL);
            m.position.set(w.x, 4, w.z); m.castShadow = true; m.receiveShadow = true;
            scene.add(m); objects.push(m); m.geometry.computeBoundingBox(); m.BBox = new THREE.Box3().setFromObject(m);
        });
    }

    if(mapData.platforms) {
        mapData.platforms.forEach(p => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, 1, p.d), MAT_FLOOR);
            m.position.set(p.x, 12, p.z); m.castShadow = true; m.receiveShadow = true;
            scene.add(m); groundObjects.push(m); m.geometry.computeBoundingBox(); m.BBox = new THREE.Box3().setFromObject(m);
        });
    }

    if(mapData.ramps) {
        mapData.ramps.forEach(r => {
            const len = 30; const targetHeight = 12.5; const angle = Math.asin(targetHeight / len);
            const geo = new THREE.BoxGeometry(8, 1, len); const m = new THREE.Mesh(geo, MAT_FLOOR);
            const midY = targetHeight / 2; const horizLen = Math.cos(angle) * len; 
            let px = r.x, pz = r.z; 
            if (r.dir === 'North') { pz = r.z + (horizLen / 2); m.rotation.x = -angle; } 
            else if (r.dir === 'South') { pz = r.z - (horizLen / 2); m.rotation.x = angle; } 
            else if (r.dir === 'East') { px = r.x + (horizLen / 2); m.geometry = new THREE.BoxGeometry(len, 1, 8); m.rotation.z = angle; } 
            else if (r.dir === 'West') { px = r.x - (horizLen / 2); m.geometry = new THREE.BoxGeometry(len, 1, 8); m.rotation.z = -angle; }
            m.position.set(px, midY, pz); scene.add(m); groundObjects.push(m);
        });
    }
    createBorderWalls();
}

function createBorderWalls() {
    const thickness = 10; const height = 40; const size = 200; const offset = size/2 + thickness/2; 
    const wallGeoH = new THREE.BoxGeometry(size + (thickness*2), height, thickness); 
    const wallGeoV = new THREE.BoxGeometry(thickness, height, size); 
    const positions = [ { x: 0, z: -offset, geo: wallGeoH }, { x: 0, z: offset, geo: wallGeoH }, { x: -offset, z: 0, geo: wallGeoV }, { x: offset, z: 0, geo: wallGeoV } ];
    positions.forEach(p => { const m = new THREE.Mesh(p.geo, MAT_WALL); m.position.set(p.x, height/2, p.z); scene.add(m); objects.push(m); m.geometry.computeBoundingBox(); m.BBox = new THREE.Box3().setFromObject(m); });
}

function createAmmoBox(data) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5,1.5,1.5), new THREE.MeshBasicMaterial({color:data.type==='shotgun'?0xffaa00:0x00ffff, wireframe:true}));
    m.position.set(data.x, data.y || 1.5, data.z); 
    m.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshBasicMaterial({color:data.type==='shotgun'?0xffaa00:0x00ffff})));
    scene.add(m); ammoMeshes[data.id] = m; m.userData = data;
}

function createHealthBox(data) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5,1.5,1.5), new THREE.MeshBasicMaterial({map: generateTexture('health')}));
    m.position.set(data.x, data.y || 1.5, data.z); 
    scene.add(m); healthMeshes[data.id] = m; m.userData = data;
}

function createHumanoidMesh(team) {
    let col = 0x00ff00; if(team === 'RED') col = 0xff0000; if(team === 'BLUE') col = 0x0000ff;
    const g = new THREE.Group(); const mat = new THREE.MeshLambertMaterial({color:col});
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.8,0.8), mat); head.position.y = 1.4; g.add(head);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2,1.5,0.6), mat); body.position.y = 0.25; g.add(body);
    const armG = new THREE.BoxGeometry(0.4, 1.5, 0.4); armG.translate(0, -0.6, 0); const lArm = new THREE.Mesh(armG, mat); lArm.position.set(-0.9, 0.9, 0); lArm.name='armL'; g.add(lArm); const rArm = new THREE.Mesh(armG, mat); rArm.position.set(0.9, 0.9, 0); rArm.name='armR'; g.add(rArm);
    const legG = new THREE.BoxGeometry(0.5, 1.5, 0.5); legG.translate(0, -0.6, 0); const lLeg = new THREE.Mesh(legG, mat); lLeg.position.set(-0.35, -0.5, 0); lLeg.name='legL'; g.add(lLeg); const rLeg = new THREE.Mesh(legG, mat); rLeg.position.set(0.35, -0.5, 0); rLeg.name='legR'; g.add(rLeg);
    const hb = new THREE.Mesh(new THREE.BoxGeometry(2,4,2), new THREE.MeshBasicMaterial({visible:false})); hb.position.y=1; g.add(hb);
    g.traverse(o=>{if(o.isMesh)o.castShadow=true;});
    return g;
}
function addOtherPlayer(p) { 
    if(!scene) return; 
    const m = createHumanoidMesh(p.team); 
    m.position.set(p.x,p.y,p.z); 
    scene.add(m); 
    players[p.id] = {
        mesh: m, 
        info: p, 
        animTime: 0, 
        lastMoveTime: Date.now(),
        lastPos: new THREE.Vector3(p.x, p.y, p.z) 
    }; 
}

function onShoot() {
    if (!controls.isLocked) return;
    const now = performance.now(); const weapon = WEAPONS[currentWeaponIdx];
    if (now - lastShotTime < weapon.cooldown) return;
    if (!weapon.infinite && ammoStore[currentWeaponIdx] <= 0) return;
    lastShotTime = now; if(!weapon.infinite) ammoStore[currentWeaponIdx]--; updateHUD();
    playSound(weapon.name); socket.emit('shoot', { type: weapon.name });
    const gun = gunModels[currentWeaponIdx]; gun.position.z+=0.2; setTimeout(()=>gun.position.z-=0.2, 100);
    const barrelPos = new THREE.Vector3(); if(gun.barrelTip) gun.barrelTip.getWorldPosition(barrelPos); else barrelPos.copy(controls.getObject().position);
    const allMeshes = []; objects.forEach(o=>allMeshes.push(o)); groundObjects.forEach(o=>allMeshes.push(o)); for(let id in players) players[id].mesh.traverse(c=>{if(c.isMesh)allMeshes.push(c)}); 
    const pellets = weapon.count || 1;
    for(let i=0; i<pellets; i++) {
        raycaster.setFromCamera(new THREE.Vector2((Math.random()-0.5)*weapon.spread, (Math.random()-0.5)*weapon.spread), camera);
        const intersects = raycaster.intersectObjects(allMeshes);
        let end = new THREE.Vector3(); raycaster.ray.at(100, end);
        if(intersects.length>0) { end.copy(intersects[0].point); const hitId = Object.keys(players).find(k=>{ let f=false; players[k].mesh.traverse(c=>{if(c===intersects[0].object)f=true}); return f; }); if(hitId) socket.emit('playerHit', hitId, weapon.damage); }
        createBulletTrail(barrelPos, end, weapon.color);
    }
}
function createBulletTrail(s,e,c) { const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints([s,e]), new THREE.LineBasicMaterial({color:c})); scene.add(l); setTimeout(()=>scene.remove(l), 50); }
function checkCollision(pos) { const b=new THREE.Box3().setFromCenterAndSize(pos, new THREE.Vector3(1,4,1)); for(let o of objects) if(o.BBox && b.intersectsBox(o.BBox)) return true; return false; }
function updateHUD() { document.getElementById('health-display').innerText = Math.max(0, myHealth); const w = WEAPONS[currentWeaponIdx]; const ac = w.infinite ? "INF" : ammoStore[currentWeaponIdx]; document.getElementById('ammo-display').innerText = `${w.name} [${ac}]`; document.getElementById('ammo-container').style.color = '#' + w.color.toString(16); }

function onKeyDown(e) { 
    if(e.code === 'Enter') {
        const input = document.getElementById('chat-input');
        if(!isChatting) { isChatting = true; document.exitPointerLock(); input.style.display = 'block'; input.focus(); moveForward=false; moveBackward=false; moveLeft=false; moveRight=false; } 
        else { const msg = input.value.trim(); if(msg.length > 0) socket.emit('chatMessage', msg); input.value = ''; input.style.display = 'none'; isChatting = false; if(gameActive) controls.lock(); }
        return; 
    }
    if(isChatting) return;
    if(e.code==='KeyW')moveForward=true; if(e.code==='KeyS')moveBackward=true; if(e.code==='KeyA')moveLeft=true; if(e.code==='KeyD')moveRight=true; if(e.code==='Space'&&canJump)velocity.y+=35; 
    if(e.code==='Digit1'){currentWeaponIdx=0;updateWeaponVisibility();updateHUD();} if(e.code==='Digit2'){currentWeaponIdx=1;updateWeaponVisibility();updateHUD();} if(e.code==='Digit3'){currentWeaponIdx=2;updateWeaponVisibility();updateHUD();} 
}

function animate() {
    requestAnimationFrame(animate); const time = performance.now(); const delta = Math.min((time-prevTime)/1000, 0.1); prevTime=time;
    for(let id in players) {
        const p = players[id];
        if (p.lastPos && p.mesh) {
            const dist = p.mesh.position.distanceTo(p.lastPos);
            const speed = dist / delta;
            if(speed > 0.5) {
                p.animTime += delta * 10;
                const legL = p.mesh.getObjectByName('legL'); if(legL) legL.rotation.x = Math.sin(p.animTime)*0.8;
                const legR = p.mesh.getObjectByName('legR'); if(legR) legR.rotation.x = Math.cos(p.animTime)*0.8;
                const armL = p.mesh.getObjectByName('armL'); if(armL) armL.rotation.x = Math.cos(p.animTime)*0.8;
                const armR = p.mesh.getObjectByName('armR'); if(armR) armR.rotation.x = Math.sin(p.animTime)*0.8;
            } else {
                p.animTime = 0;
                const legL = p.mesh.getObjectByName('legL'); if(legL) legL.rotation.x = 0;
                const legR = p.mesh.getObjectByName('legR'); if(legR) legR.rotation.x = 0;
                const armL = p.mesh.getObjectByName('armL'); if(armL) armL.rotation.x = 0;
                const armR = p.mesh.getObjectByName('armR'); if(armR) armR.rotation.x = 0;
            }
            p.lastPos.copy(p.mesh.position);
        }
    }
    const pPos = controls.getObject().position;
    for(let k in ammoMeshes) { if(ammoMeshes[k].visible) { ammoMeshes[k].rotation.y+=0.02; if(pPos.distanceTo(ammoMeshes[k].position)<2.5) { const t=ammoMeshes[k].userData.type; let p=false; if(t==='shotgun'&&ammoStore[1]<WEAPONS[1].maxAmmo){ammoStore[1]=Math.min(ammoStore[1]+6,WEAPONS[1].maxAmmo);p=true;} if(t==='railgun'&&ammoStore[2]<WEAPONS[2].maxAmmo){ammoStore[2]=Math.min(ammoStore[2]+2,WEAPONS[2].maxAmmo);p=true;} if(p){socket.emit('pickupAmmo',k);ammoMeshes[k].visible=false;updateHUD();} } } }
    for(let k in healthMeshes) { if(healthMeshes[k].visible) { healthMeshes[k].rotation.y+=0.02; if(pPos.distanceTo(healthMeshes[k].position)<2.5 && myHealth < 100) { socket.emit('pickupHealth',k); healthMeshes[k].visible=false; } } }
    for(let k in flagMeshes) { if(flagMeshes[k].visible) { flagMeshes[k].rotation.y += 0.05; } }

    if (controls.isLocked) {
        if(velocity.y < -100) velocity.y = -100;
        if(isNaN(velocity.y)) velocity.y = 0; 
        velocity.x -= velocity.x * 10.0 * delta; velocity.z -= velocity.z * 10.0 * delta; 
        direction.z = Number(moveForward) - Number(moveBackward); direction.x = Number(moveRight) - Number(moveLeft); direction.normalize(); 
        if (moveForward || moveBackward) velocity.z -= direction.z * 400.0 * delta; if (moveLeft || moveRight) velocity.x -= direction.x * 400.0 * delta;
        const oldPos = controls.getObject().position.clone();
        controls.moveRight(-velocity.x * delta); controls.moveForward(-velocity.z * delta);
        if (checkCollision(controls.getObject().position)) { controls.getObject().position.copy(oldPos); velocity.x=0; velocity.z=0; }
        
        if (mapLoaded) {
            controls.getObject().position.y += (velocity.y * delta);
            groundRaycaster.set(controls.getObject().position, new THREE.Vector3(0, -1, 0));
            const hits = groundRaycaster.intersectObjects(groundObjects);
            if(hits.length > 0 && hits[0].distance < 2.2 && velocity.y <= 0) { velocity.y = 0; controls.getObject().position.y = hits[0].point.y + 2.0; canJump = true; } 
            else { velocity.y -= 9.8 * 100.0 * delta; }
            if (controls.getObject().position.y < -10) { velocity.y = 0; controls.getObject().position.set(0, 20, 0); }
        }

        socket.emit('playerMovement', { x: controls.getObject().position.x, y: controls.getObject().position.y, z: controls.getObject().position.z, rotation: camera.rotation.y });
        if(moveForward||moveBackward||moveLeft||moveRight){ weaponGroup.position.x = 0.4 + Math.sin(time*0.01)*0.02; weaponGroup.position.y = -0.3 + Math.abs(Math.sin(time*0.015))*0.02; } else { weaponGroup.position.set(0.4,-0.3,-0.6); }
    }
    renderer.render(scene, camera);
}
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });