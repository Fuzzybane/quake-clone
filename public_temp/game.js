// --- CONFIGURATION ---
const socket = io();
let scene, camera, renderer, controls;
let objects = []; 
let ammoMeshes = {}; 
let players = {}; 
let myId;
let myHealth = 100;
let myScore = 0;

let audioCtx;
let gameActive = false; 

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

// --- WEAPONS SYSTEM ---
const WEAPONS = [
    { 
        name: "BLASTER", 
        damage: 15, 
        cooldown: 250, 
        color: 0xffff00, 
        speed: 1, 
        spread: 0, 
        infinite: true 
    },
    { 
        name: "SHOTGUN", 
        damage: 8, 
        cooldown: 800, 
        color: 0xffaa00, 
        speed: 2, 
        spread: 0.15, 
        count: 6, 
        maxAmmo: 24, 
        startAmmo: 12 // Give starting ammo
    },
    { 
        name: "RAILGUN", 
        damage: 100, 
        cooldown: 1500, 
        color: 0x00ffff, 
        speed: 0, 
        spread: 0, 
        maxAmmo: 5, 
        startAmmo: 5 // Give starting ammo
    }
];

let currentWeaponIdx = 0;
let lastShotTime = 0;
// Initialize ammo based on config
let ammoStore = [999, WEAPONS[1].startAmmo, WEAPONS[2].startAmmo]; 

// --- GLOBAL LISTENERS ---

socket.on('updatePlayerList', (count) => { 
    const el = document.getElementById('player-count');
    if(el) el.innerText = count; 
});

socket.on('serverMessage', (msg) => {
    let container = document.getElementById('messages-container');
    if(!container) {
        container = document.createElement('div');
        container.id = 'messages-container';
        document.body.appendChild(container);
    }
    const div = document.createElement('div');
    div.className = 'msg-entry';
    div.innerText = msg;
    container.appendChild(div);
    setTimeout(() => div.remove(), 5000);
});

// --- GAME STATE LISTENERS ---

socket.on('scoreUpdate', (data) => {
    if (data.id === socket.id) {
        myScore = data.score;
        document.getElementById('score-display').innerText = myScore;
    }
});

socket.on('gameOver', (winnerName) => {
    gameActive = false;
    document.exitPointerLock();
    
    const overlay = document.getElementById('game-over-overlay');
    const winnerText = document.getElementById('winner-text');
    const timerText = document.getElementById('restart-timer');
    
    overlay.style.display = 'flex';
    winnerText.innerText = `${winnerName} WINS!`;
    
    let countdown = 6;
    timerText.innerText = `Returning to lobby in ${countdown}...`;
    
    const interval = setInterval(() => {
        countdown--;
        if(countdown > 0) {
            timerText.innerText = `Returning to lobby in ${countdown}...`;
        } else {
            clearInterval(interval);
        }
    }, 1000);
});

socket.on('gameReset', (allPlayersData) => {
    document.getElementById('game-over-overlay').style.display = 'none';
    document.getElementById('menu-overlay').style.display = 'flex';
    document.getElementById('hud').style.display = 'none';
    document.getElementById('crosshair').style.display = 'none';
    
    myScore = 0;
    document.getElementById('score-display').innerText = 0;
    
    // Reset Ammo
    ammoStore = [999, WEAPONS[1].startAmmo, WEAPONS[2].startAmmo];
    updateHUD();

    if(allPlayersData[socket.id]) {
        const p = allPlayersData[socket.id];
        controls.getObject().position.set(p.x, p.y, p.z);
        velocity.set(0,0,0);
    }
});

// --- TEXTURE GENERATOR ---
function generateTexture(type) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if(type === 'grid') { 
        ctx.fillStyle = '#111'; ctx.fillRect(0,0,512,512);
        ctx.strokeStyle = '#0f0'; ctx.lineWidth = 4;
        ctx.shadowBlur = 10; ctx.shadowColor = '#0f0';
        ctx.beginPath();
        for(let i=0; i<=512; i+=64) { ctx.moveTo(i,0); ctx.lineTo(i,512); ctx.moveTo(0,i); ctx.lineTo(512,i); }
        ctx.stroke();
    } else if(type === 'wall') { 
        ctx.fillStyle = '#444'; ctx.fillRect(0,0,512,512);
        ctx.fillStyle = '#222'; 
        ctx.fillRect(10, 10, 236, 236); ctx.fillRect(266, 10, 236, 236);
        ctx.fillRect(10, 266, 236, 236); ctx.fillRect(266, 266, 236, 236);
        ctx.strokeStyle = '#666'; ctx.strokeRect(0,0,512,512);
    } else if(type === 'crate') { 
        ctx.fillStyle = '#333'; ctx.fillRect(0,0,512,512);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 10;
        ctx.strokeRect(20,20,472,472);
        ctx.beginPath(); ctx.moveTo(20,20); ctx.lineTo(492,492); ctx.moveTo(492,20); ctx.lineTo(20,492); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    return tex;
}
const MAT_FLOOR = new THREE.MeshStandardMaterial({ map: generateTexture('grid'), roughness: 0.8 });
const MAT_WALL = new THREE.MeshStandardMaterial({ map: generateTexture('wall'), roughness: 0.2, metalness: 0.5 });

// --- AUDIO ---
function initAudio() {
    if(!audioCtx) { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); startAmbience(); }
    if(audioCtx.state === 'suspended') audioCtx.resume();
}
function playSound(type) {
    if(!audioCtx) return;
    const t = audioCtx.currentTime;
    if(type === 'BLASTER') {
        const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(880, t); osc.frequency.exponentialRampToValueAtTime(110, t+0.2);
        gain.gain.setValueAtTime(0.3, t); gain.gain.exponentialRampToValueAtTime(0.01, t+0.2);
        osc.connect(gain); gain.connect(audioCtx.destination); osc.start(); osc.stop(t+0.2);
    } else if(type === 'SHOTGUN') {
        const buf = audioCtx.createBuffer(1, audioCtx.sampleRate*0.5, audioCtx.sampleRate);
        const data = buf.getChannelData(0); for(let i=0; i<data.length; i++) data[i]=Math.random()*2-1;
        const src = audioCtx.createBufferSource(); src.buffer = buf;
        const gain = audioCtx.createGain(); const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.value = 1000;
        gain.gain.setValueAtTime(1.0, t); gain.gain.exponentialRampToValueAtTime(0.01, t+0.3);
        src.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination); src.start();
    } else if(type === 'RAILGUN') {
        const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
        osc.type = 'square'; osc.frequency.setValueAtTime(200, t); 
        osc.frequency.linearRampToValueAtTime(800, t+0.1); osc.frequency.exponentialRampToValueAtTime(50, t+0.5);
        gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.5, t+0.1); gain.gain.exponentialRampToValueAtTime(0.01, t+0.5);
        osc.connect(gain); gain.connect(audioCtx.destination); osc.start(); osc.stop(t+0.6);
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
    
    document.getElementById('menu-overlay').style.display = 'none';
    document.getElementById('hud').style.display = 'flex';
    document.getElementById('crosshair').style.display = 'block';
    
    if(!scene) init(); 
    
    initAudio(); 
    gameActive = true;
    animate();
    
    socket.emit('joinGame', { nickname: nickname, fragLimit: fragLimit });
});

function init() {
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x050505); scene.fog = new THREE.Fog(0x050505, 0, 60);
    camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000); camera.position.y = 2;
    renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true; document.body.appendChild(renderer.domElement);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6); scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(10, 20, 10); dir.castShadow = true; scene.add(dir);

    controls = new THREE.PointerLockControls(camera, document.body);
    document.body.addEventListener('click', () => { 
        if(gameActive && !controls.isLocked && document.getElementById('menu-overlay').style.display === 'none') {
            controls.lock(); if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        }
    });
    scene.add(controls.getObject());

    createFPSWeapons();
    createLevel();
    updateHUD();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', (e) => {
        switch (e.code) { case 'KeyW': moveForward=false; break; case 'KeyA': moveLeft=false; break; case 'KeyS': moveBackward=false; break; case 'KeyD': moveRight=false; break; }
    });
    document.addEventListener('mousedown', onShoot);

    // Socket Events
    socket.on('currentPlayers', (serverPlayers) => { for (let id in serverPlayers) if (id !== socket.id) addOtherPlayer(serverPlayers[id]); });
    socket.on('newPlayer', (p) => addOtherPlayer(p));
    socket.on('playerMoved', (p) => {
        if (players[p.id]) { players[p.id].mesh.position.set(p.x, p.y, p.z); players[p.id].mesh.rotation.y = p.rotation; }
    });
    socket.on('playerDisconnected', (id) => { if (players[id]) { scene.remove(players[id].mesh); delete players[id]; } });
    socket.on('playerShot', (data) => {
        if(players[data.id]) {
            const start = players[data.id].mesh.position.clone(); start.y += 1.5;
            const end = new THREE.Vector3(start.x - Math.sin(players[data.id].mesh.rotation.y)*50, start.y, start.z - Math.cos(players[data.id].mesh.rotation.y)*50);
            let color = 0xffff00; let type = "BLASTER";
            if(data.weapon && data.weapon.type) { type = data.weapon.type; const w = WEAPONS.find(w => w.name === type); if(w) color = w.color; }
            createBulletTrail(start, end, color); playSound(type);
        }
    });
    socket.on('healthUpdate', (data) => {
        if(data.id === socket.id) {
            myHealth = data.health; updateHUD();
            document.body.style.boxShadow = "inset 0 0 50px red"; setTimeout(() => document.body.style.boxShadow = "none", 100);
        }
    });
    socket.on('playerRespawn', (data) => {
        if (data.id === socket.id) { controls.getObject().position.set(data.x, data.y, data.z); velocity.set(0,0,0); myHealth = 100; updateHUD(); }
        else if (players[data.id]) players[data.id].mesh.position.set(data.x, data.y, data.z);
    });
    socket.on('ammoState', (serverAmmo) => { for(let id in serverAmmo) { createAmmoBox(serverAmmo[id]); if(!serverAmmo[id].active) ammoMeshes[id].visible = false; } });
    socket.on('ammoTaken', (id) => { if(ammoMeshes[id]) ammoMeshes[id].visible = false; });
    socket.on('ammoRespawn', (id) => { if(ammoMeshes[id]) ammoMeshes[id].visible = true; });
}

// --- FIXED WEAPON CREATION ---
function createFPSWeapons() {
    weaponGroup = new THREE.Group();
    weaponGroup.position.set(0.4, -0.3, -0.6); 
    camera.add(weaponGroup); 

    // 1. BLASTER
    const blaster = new THREE.Group();
    const bMain = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.4), new THREE.MeshStandardMaterial({ color: 0xffff00 }));
    const bHandle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.1), new THREE.MeshStandardMaterial({ color: 0x444444 }));
    bHandle.position.set(0, -0.15, 0.1);
    blaster.add(bMain); blaster.add(bHandle);
    
    // Barrel Tip (Crucial for shooting)
    const bTip = new THREE.Object3D(); 
    bTip.position.set(0, 0, -0.25); 
    blaster.add(bTip); 
    blaster.barrelTip = bTip;
    
    // 2. SHOTGUN
    const shotgun = new THREE.Group();
    const sStock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.5), new THREE.MeshStandardMaterial({ color: 0x8B4513 }));
    const sBarrelL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    sBarrelL.rotation.x = -Math.PI/2; sBarrelL.position.set(-0.07, 0.05, -0.4);
    const sBarrelR = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    sBarrelR.rotation.x = -Math.PI/2; sBarrelR.position.set(0.07, 0.05, -0.4);
    shotgun.add(sStock); shotgun.add(sBarrelL); shotgun.add(sBarrelR);
    
    const sTip = new THREE.Object3D(); 
    sTip.position.set(0, 0.05, -0.85); 
    shotgun.add(sTip); 
    shotgun.barrelTip = sTip;

    // 3. RAILGUN
    const railgun = new THREE.Group();
    const rBody = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.6), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    const rRailT = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.2), new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff }));
    rRailT.position.set(0, 0.18, -0.4);
    const rRailB = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.2), new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff }));
    rRailB.position.set(0, -0.18, -0.4);
    railgun.add(rBody); railgun.add(rRailT); railgun.add(rRailB);
    
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

function updateWeaponVisibility() { 
    gunModels.forEach((m, i) => m.visible = (i === currentWeaponIdx)); 
}

function createLevel() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), MAT_FLOOR);
    MAT_FLOOR.map.repeat.set(20,20); floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; floor.name = "floor"; scene.add(floor);
    
    const boxGeo = new THREE.BoxGeometry(10, 8, 10);
    function addWall(x, z) {
        const m = new THREE.Mesh(boxGeo, MAT_WALL); m.position.set(x,4,z); m.castShadow = true; m.receiveShadow = true;
        scene.add(m); objects.push(m); m.geometry.computeBoundingBox(); m.BBox = new THREE.Box3().setFromObject(m);
    }
    // Arena Obstacles
    addWall(15,15); addWall(-15,-15); addWall(15,-15); addWall(-15,15); addWall(30,0); addWall(-30,0); addWall(0,30); addWall(0,-30); addWall(10,10); addWall(-10,-10);
    
    // BORDER WALLS
    createBorderWalls();
}

function createBorderWalls() {
    const thickness = 10;
    const height = 20;
    const size = 200;
    const offset = size/2 + thickness/2; 
    
    const wallGeoH = new THREE.BoxGeometry(size + (thickness*2), height, thickness); 
    const wallGeoV = new THREE.BoxGeometry(thickness, height, size); 
    
    const positions = [
        { x: 0, z: -offset, geo: wallGeoH }, 
        { x: 0, z: offset, geo: wallGeoH },  
        { x: -offset, z: 0, geo: wallGeoV }, 
        { x: offset, z: 0, geo: wallGeoV }   
    ];

    positions.forEach(p => {
        const m = new THREE.Mesh(p.geo, MAT_WALL);
        m.position.set(p.x, height/2, p.z);
        scene.add(m);
        objects.push(m);
        m.geometry.computeBoundingBox();
        m.BBox = new THREE.Box3().setFromObject(m);
    });
}

function createAmmoBox(data) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5,1.5,1.5), new THREE.MeshBasicMaterial({color:data.type==='shotgun'?0xffaa00:0x00ffff, wireframe:true}));
    m.position.set(data.x, 1.5, data.z); m.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshBasicMaterial({color:data.type==='shotgun'?0xffaa00:0x00ffff})));
    scene.add(m); ammoMeshes[data.id] = m; m.userData = data;
}

function createHumanoidMesh(isBot) {
    const g = new THREE.Group(); 
    const mat = new THREE.MeshLambertMaterial({color:isBot?0xff3333:0x33ff33});
    
    // HEAD
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.8,0.8), mat); 
    head.position.y=1.4; 
    g.add(head);
    
    // BODY
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2,1.5,0.6), mat); 
    body.position.y=0.25; 
    g.add(body);
    
    // ARMS
    const armGeo = new THREE.BoxGeometry(0.4, 1.5, 0.4);
    const armL = new THREE.Mesh(armGeo, mat); armL.position.set(-0.9, 0.25, 0); g.add(armL);
    const armR = new THREE.Mesh(armGeo, mat); armR.position.set(0.9, 0.25, 0); g.add(armR);
    
    // LEGS
    const legGeo = new THREE.BoxGeometry(0.5, 1.5, 0.5);
    const legL = new THREE.Mesh(legGeo, mat); legL.position.set(-0.35, -1.25, 0); g.add(legL);
    const legR = new THREE.Mesh(legGeo, mat); legR.position.set(0.35, -1.25, 0); g.add(legR);

    // INVISIBLE HITBOX
    const hitbox = new THREE.Mesh(new THREE.BoxGeometry(2,4,2), new THREE.MeshBasicMaterial({visible:false})); 
    hitbox.position.y=1; 
    g.add(hitbox);
    
    g.traverse(o=>{if(o.isMesh)o.castShadow=true;});
    return g;
}

function addOtherPlayer(p) { const m = createHumanoidMesh(p.isBot); m.position.set(p.x,p.y,p.z); scene.add(m); players[p.id]={mesh:m, info:p}; }

function onShoot() {
    if (!controls.isLocked) return;
    const now = performance.now(); const weapon = WEAPONS[currentWeaponIdx];
    
    if (now - lastShotTime < weapon.cooldown) return;
    if (!weapon.infinite && ammoStore[currentWeaponIdx] <= 0) return;
    
    lastShotTime = now; 
    if(!weapon.infinite) ammoStore[currentWeaponIdx]--; 
    updateHUD();
    
    playSound(weapon.name); 
    socket.emit('shoot', { type: weapon.name });
    
    // Recoil
    const gun = gunModels[currentWeaponIdx]; 
    gun.position.z+=0.2; 
    setTimeout(()=>gun.position.z-=0.2, 100);
    
    // Raycast Logic
    const barrelPos = new THREE.Vector3(); 
    // Safety check for barrelTip to prevent crash
    if(gun.barrelTip) {
        gun.barrelTip.getWorldPosition(barrelPos);
    } else {
        barrelPos.copy(controls.getObject().position); // Fallback
    }

    const allMeshes = []; 
    objects.forEach(o=>allMeshes.push(o)); 
    for(let id in players) players[id].mesh.traverse(c=>{if(c.isMesh)allMeshes.push(c)}); 
    allMeshes.push(scene.getObjectByName("floor"));
    
    const pellets = weapon.count || 1;
    for(let i=0; i<pellets; i++) {
        raycaster.setFromCamera(new THREE.Vector2((Math.random()-0.5)*weapon.spread, (Math.random()-0.5)*weapon.spread), camera);
        const intersects = raycaster.intersectObjects(allMeshes);
        let end = new THREE.Vector3(); 
        
        if(intersects.length>0) {
            end.copy(intersects[0].point);
            const hitId = Object.keys(players).find(k=>{ let f=false; players[k].mesh.traverse(c=>{if(c===intersects[0].object)f=true}); return f; });
            if(hitId) socket.emit('playerHit', hitId, weapon.damage);
        } else {
            raycaster.ray.at(100, end);
        }
        createBulletTrail(barrelPos, end, weapon.color);
    }
}
function createBulletTrail(s,e,c) { const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints([s,e]), new THREE.LineBasicMaterial({color:c})); scene.add(l); setTimeout(()=>scene.remove(l), 50); }
function checkCollision(pos) { const b=new THREE.Box3().setFromCenterAndSize(pos, new THREE.Vector3(1,4,1)); for(let o of objects) if(o.BBox && b.intersectsBox(o.BBox)) return true; return false; }
function onKeyDown(e) { if(e.code==='KeyW')moveForward=true; if(e.code==='KeyS')moveBackward=true; if(e.code==='KeyA')moveLeft=true; if(e.code==='KeyD')moveRight=true; if(e.code==='Space'&&canJump)velocity.y+=35; if(e.code==='Digit1'){currentWeaponIdx=0;updateWeaponVisibility();updateHUD();} if(e.code==='Digit2'){currentWeaponIdx=1;updateWeaponVisibility();updateHUD();} if(e.code==='Digit3'){currentWeaponIdx=2;updateWeaponVisibility();updateHUD();} }

function updateHUD() {
    document.getElementById('health-display').innerText = Math.max(0, myHealth);
    const weapon = WEAPONS[currentWeaponIdx];
    // Explicitly check infinite property
    const ammoCount = weapon.infinite ? "INF" : ammoStore[currentWeaponIdx];
    document.getElementById('ammo-display').innerText = `${weapon.name} [${ammoCount}]`;
    document.getElementById('ammo-container').style.color = '#' + weapon.color.toString(16);
}

function animate() {
    requestAnimationFrame(animate); const time = performance.now(); const delta = (time-prevTime)/1000; prevTime=time;
    // Rotate Ammo
    for(let k in ammoMeshes) {
        if(ammoMeshes[k].visible) {
            ammoMeshes[k].rotation.y+=0.02; 
            if(controls.getObject().position.distanceTo(ammoMeshes[k].position)<2.5) {
                const t=ammoMeshes[k].userData.type; let p=false;
                if(t==='shotgun'&&ammoStore[1]<WEAPONS[1].maxAmmo){ammoStore[1]=Math.min(ammoStore[1]+6,WEAPONS[1].maxAmmo);p=true;}
                if(t==='railgun'&&ammoStore[2]<WEAPONS[2].maxAmmo){ammoStore[2]=Math.min(ammoStore[2]+2,WEAPONS[2].maxAmmo);p=true;}
                if(p){socket.emit('pickupAmmo',k);ammoMeshes[k].visible=false;updateHUD();}
            }
        }
    }
    if (controls.isLocked) {
        velocity.x -= velocity.x * 10.0 * delta; velocity.z -= velocity.z * 10.0 * delta; velocity.y -= 9.8 * 100.0 * delta; 
        direction.z = Number(moveForward) - Number(moveBackward); direction.x = Number(moveRight) - Number(moveLeft); direction.normalize(); 
        if (moveForward || moveBackward) velocity.z -= direction.z * 400.0 * delta; if (moveLeft || moveRight) velocity.x -= direction.x * 400.0 * delta;
        const oldPos = controls.getObject().position.clone();
        controls.moveRight(-velocity.x * delta); controls.moveForward(-velocity.z * delta);
        if (checkCollision(controls.getObject().position)) { controls.getObject().position.copy(oldPos); velocity.x=0; velocity.z=0; }
        controls.getObject().position.y += (velocity.y * delta);
        if (controls.getObject().position.y < 2) { velocity.y = 0; controls.getObject().position.y = 2; canJump = true; }
        socket.emit('playerMovement', { x: controls.getObject().position.x, y: controls.getObject().position.y, z: controls.getObject().position.z, rotation: camera.rotation.y });
        // Sway
        if(moveForward||moveBackward||moveLeft||moveRight){ weaponGroup.position.x = 0.4 + Math.sin(time*0.01)*0.02; weaponGroup.position.y = -0.3 + Math.abs(Math.sin(time*0.015))*0.02; } 
        else { weaponGroup.position.set(0.4,-0.3,-0.6); }
    }
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});