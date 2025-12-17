const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- GLOBAL STATE ---
let players = {};
let ammoPickups = {}; 
let healthPickups = {}; 
let flags = {
    red: { x: 0, z: 0, y: 0, homeX: 0, homeZ: 0, carrier: null, dropped: false },
    blue: { x: 0, z: 0, y: 0, homeX: 0, homeZ: 0, carrier: null, dropped: false }
};
let teamScores = { red: 0, blue: 0 };
let currentMap = { walls: [], platforms: [], ramps: [], spawns: [] }; 
const MAP_SEED = Math.random(); 

const MAX_PLAYERS = 16; 
let fragLimit = 10; 
let gameActive = true;
let gameMode = 'DM'; 
let botCount = 0;

const BOT_NAMES = [
    "Razor", "Blade", "Tank", "Viper", "Ghost", "Sarge", "Ranger", "Phobos", "Crash", "Doom", 
    "Slash", "Bones", "Orbb", "Hunter", "Klesk", "Anarki", "Bitterman", "Daemia", "Patriot", "Stripe", 
    "Visor", "Xaero", "Uriel", "Keel", "Sorlag", "Reaper", "Glitch", "Zero", "Vortex", "Titan"
];

function getUniqueBotName() {
    const takenNames = Object.values(players).map(p => p.nickname);
    const available = BOT_NAMES.filter(name => !takenNames.includes(name));
    return available.length > 0 ? available[Math.floor(Math.random() * available.length)] : `Unit-${Math.floor(Math.random() * 999)}`;
}

// --- PROCEDURAL MAP GENERATOR ---
function generateMap() {
    currentMap = { walls: [], platforms: [], ramps: [], spawns: [] };
    ammoPickups = {};
    healthPickups = {};
    
    // Reset Flags
    flags.red.carrier = null; flags.red.dropped = false;
    flags.blue.carrier = null; flags.blue.dropped = false;

    const rand = Math.random();
    let type = 'RING';
    if (rand < 0.33) type = 'CROSS';
    else if (rand < 0.66) type = 'FORTS';

    console.log(`Generating New Map: ${type} (${gameMode})`);

    // --- 1. ARCHETYPE GENERATION ---
    
    if (type === 'RING') {
        currentMap.platforms.push({ x: -50, z: 70, w: 80, d: 20 });
        currentMap.platforms.push({ x: 50, z: 70, w: 80, d: 20 });
        currentMap.platforms.push({ x: 0, z: 70, w: 20, d: 20 }); 
        currentMap.platforms.push({ x: -50, z: -70, w: 80, d: 20 });
        currentMap.platforms.push({ x: 50, z: -70, w: 80, d: 20 });
        currentMap.platforms.push({ x: 0, z: -70, w: 20, d: 20 }); 
        currentMap.platforms.push({ x: 70, z: -50, w: 20, d: 80 }); 
        currentMap.platforms.push({ x: 70, z: 50, w: 20, d: 80 });
        currentMap.platforms.push({ x: 70, z: 0, w: 20, d: 20 }); 
        currentMap.platforms.push({ x: -70, z: -50, w: 20, d: 80 });
        currentMap.platforms.push({ x: -70, z: 50, w: 20, d: 80 });
        currentMap.platforms.push({ x: -70, z: 0, w: 20, d: 20 }); 
        currentMap.ramps.push({ x: 0, z: 45, dir: 'North' });
        currentMap.ramps.push({ x: 0, z: -45, dir: 'South' });
        currentMap.ramps.push({ x: 45, z: 0, dir: 'East' });
        currentMap.ramps.push({ x: -45, z: 0, dir: 'West' });
        setFlagPos('blue', 0, 70, 13.5); setFlagPos('red', 0, -70, 13.5);
        addItem(0, 70, 13.5, 'railgun'); addItem(0, -70, 13.5, 'railgun');

    } else if (type === 'CROSS') {
        currentMap.platforms.push({ x: 0, z: 0, w: 40, d: 140 }); 
        currentMap.platforms.push({ x: 0, z: 0, w: 140, d: 40 }); 
        currentMap.ramps.push({ x: 0, z: 85, dir: 'South' }); 
        currentMap.ramps.push({ x: 0, z: -85, dir: 'North' }); 
        currentMap.ramps.push({ x: 85, z: 0, dir: 'West' });
        currentMap.ramps.push({ x: -85, z: 0, dir: 'East' });
        setFlagPos('blue', 0, 60, 13.5); setFlagPos('red', 0, -60, 13.5);
        addItem(0, 0, 13.5, 'railgun');
        
    } else if (type === 'FORTS') {
        currentMap.platforms.push({ x: 0, z: 60, w: 100, d: 40 }); 
        currentMap.platforms.push({ x: 0, z: -60, w: 100, d: 40 }); 
        currentMap.platforms.push({ x: 0, z: 0, w: 20, d: 80 }); 
        currentMap.ramps.push({ x: 63, z: 60, dir: 'West' }); 
        currentMap.ramps.push({ x: -63, z: 60, dir: 'East' }); 
        currentMap.ramps.push({ x: 63, z: -60, dir: 'West' });
        currentMap.ramps.push({ x: -63, z: -60, dir: 'East' });
        setFlagPos('blue', 0, 75, 13.5); setFlagPos('red', 0, -75, 13.5);
        addItem(0, 60, 13.5, 'railgun'); addItem(0, -60, 13.5, 'railgun');
    }

    // --- 2. OBSTACLES ---
    const obstacleCount = 3 + Math.floor(Math.random() * 3);
    for(let i=0; i<obstacleCount; i++) {
        const rx = 25 + Math.random() * 45; 
        const rz = 25 + Math.random() * 45; 
        if(Math.abs(rx) < 15 || Math.abs(rz) < 15) continue; 
        if(Math.abs(rx - rz) < 10) continue; 
        let blocksRamp = false;
        for (let r of currentMap.ramps) { if (Math.abs(rx - Math.abs(r.x)) < 20 && Math.abs(rz - Math.abs(r.z)) < 20) { blocksRamp = true; break; } }
        if (blocksRamp) continue; 
        const shape = Math.random();
        if (shape < 0.4) { addSymmetricalWall(rx, rz, 10, 10); } 
        else if (shape < 0.7) { if(Math.random()>0.5) addSymmetricalWall(rx, rz, 20, 5); else addSymmetricalWall(rx, rz, 5, 20); } 
        else { addSymmetricalWall(rx, rz - 5, 5, 15); addSymmetricalWall(rx - 5, rz, 15, 5); }
    }

    // --- 3. SPAWNS & ITEMS ---
    currentMap.spawns = [
        { x: 0, z: 0 }, 
        { x: 80, z: 80 }, { x: -80, z: -80 }, { x: 80, z: -80 }, { x: -80, z: 80 }, 
        { x: 0, z: 30 }, { x: 0, z: -30 }, { x: 30, z: 0 }, { x: -30, z: 0 }, 
        { x: 0, z: 70 }, { x: 0, z: -70 } 
    ];

    addItem(30, 30, 1.5, 'shotgun'); addItem(-30, -30, 1.5, 'shotgun'); addItem(30, -30, 1.5, 'shotgun'); addItem(-30, 30, 1.5, 'shotgun');
    addHealth(0, 0, 1.5); addHealth(85, 0, 1.5); addHealth(-85, 0, 1.5); addHealth(0, 85, 1.5); addHealth(0, -85, 1.5);
}

// Helpers
function setFlagPos(color, x, z, y) { flags[color].x = x; flags[color].z = z; flags[color].y = y; flags[color].homeX = x; flags[color].homeZ = z; flags[color].homeY = y; }
function addSymmetricalWall(x, z, w, d) { currentMap.walls.push({ x: x, z: z, w: w, d: d }); currentMap.walls.push({ x: -x, z: -z, w: w, d: d }); currentMap.walls.push({ x: -x, z: z, w: w, d: d }); currentMap.walls.push({ x: x, z: -z, w: w, d: d }); }
function addItem(x, z, y, type) { const id = `item_${Object.keys(ammoPickups).length + Math.random()}`; ammoPickups[id] = { id, x, z, y, type, active: true }; }
function addHealth(x, z, y) { const id = `hp_${Object.keys(healthPickups).length + Math.random()}`; healthPickups[id] = { id, x, z, y, active: true }; }

generateMap(); 

// --- PHYSICS HELPERS ---
function isPosSafe(x, z) {
    if (isNaN(x) || isNaN(z)) return false;
    if (x > 90 || x < -90 || z > 90 || z < -90) return false;
    for (let w of currentMap.walls) { const halfW = (w.w/2) + 4; const halfD = (w.d/2) + 4; if (x > w.x - halfW && x < w.x + halfW && z > w.z - halfD && z < w.z + halfD) return false; }
    return true;
}
function getSafeSpawn() {
    if (!currentMap.spawns || currentMap.spawns.length === 0) return { x: 0, z: 0 };
    let candidates = [];
    currentMap.spawns.forEach(sp => { candidates.push({ x: sp.x, z: sp.z }); candidates.push({ x: sp.x + 8, z: sp.z + 8 }); candidates.push({ x: sp.x - 8, z: sp.z - 8 }); });
    for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
    let bestSpot = null; let maxMinDist = -1;
    for (let cand of candidates) {
        if (!isPosSafe(cand.x, cand.z)) continue;
        let minDist = Infinity; let valid = true;
        for (let id in players) {
            const p = players[id];
            if (!p.isDead) { const d = Math.sqrt(Math.pow(cand.x - p.x, 2) + Math.pow(cand.z - p.z, 2)); if (d < minDist) minDist = d; if (d < 8) { valid = false; break; } }
        }
        if (valid) { if (minDist > 50) return cand; if (minDist > maxMinDist) { maxMinDist = minDist; bestSpot = cand; } }
    }
    if (bestSpot) return bestSpot;
    const fallback = currentMap.spawns[Math.floor(Math.random() * currentMap.spawns.length)];
    return { x: fallback.x + (Math.random()-0.5)*5, z: fallback.z + (Math.random()-0.5)*5 };
}
function checkBotWallCollision(x, z) {
    if (x > 95 || x < -95 || z > 95 || z < -95) return true;
    for (let w of currentMap.walls) { const halfW = (w.w/2) + 6; const halfD = (w.d/2) + 6; if (x > w.x - halfW && x < w.x + halfW && z > w.z - halfD && z < w.z + halfD) return true; }
    return false;
}
function getBotHeight(x, z, currentY) {
    if (isNaN(x) || isNaN(z)) return 2;
    for (let r of currentMap.ramps) {
        let dx = x - r.x; let dz = z - r.z;
        if (r.dir === 'North' && Math.abs(dx) < 4 && dz > -15 && dz < 15) return 2 + ((dz + 15) / 30 * 12);
        if (r.dir === 'South' && Math.abs(dx) < 4 && dz > -15 && dz < 15) return 2 + ((15 - dz) / 30 * 12);
        if (r.dir === 'East' && Math.abs(dz) < 4 && dx > -15 && dx < 15) return 2 + ((dx + 15) / 30 * 12);
        if (r.dir === 'West' && Math.abs(dz) < 4 && dx > -15 && dx < 15) return 2 + ((15 - dx) / 30 * 12);
    }
    for (let p of currentMap.platforms) {
        const halfW = p.w / 2; const halfD = p.d / 2;
        if (x > p.x - halfW && x < p.x + halfW && z > p.z - halfD && z < p.z + halfD) { if (currentY > 6) return 14; else return 2; }
    }
    return 2;
}

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    socket.emit('updatePlayerList', Object.keys(players).length);
    socket.emit('mapConfig', currentMap);
    socket.emit('updateGameMode', gameMode);

    socket.on('joinGame', (data) => {
        const currentCount = Object.keys(players).length;
        const botId = Object.keys(players).find(id => players[id].isBot);
        if (currentCount >= MAX_PLAYERS) {
            if (botId) { delete players[botId]; io.emit('playerDisconnected', botId); } 
            else { socket.emit('serverMessage', 'SERVER FULL! Cannot join.'); return; }
        }

        const spawn = getSafeSpawn();
        const nickname = data.nickname || "Unknown";
        
        if (Object.keys(players).length === 0) {
            if(data.fragLimit) fragLimit = parseInt(data.fragLimit);
            if(data.gameMode) {
                gameMode = data.gameMode;
                generateMap(); 
                io.emit('updateGameMode', gameMode); 
            }
        }

        let team = 'GREEN';
        if (gameMode === 'CTF') {
            const redCount = Object.values(players).filter(p => p.team === 'RED').length;
            const blueCount = Object.values(players).filter(p => p.team === 'BLUE').length;
            team = redCount <= blueCount ? 'RED' : 'BLUE';
        }

        players[socket.id] = { 
            id: socket.id, x: spawn.x, y: 20, z: spawn.z, rotation: 0, 
            nickname: nickname, health: 100, isBot: false, score: 0, isDead: false, team: team
        };

        socket.emit('mapConfig', currentMap);
        socket.emit('ammoState', ammoPickups);
        socket.emit('healthState', healthPickups);
        socket.emit('flagState', flags);
        socket.emit('currentPlayers', players);
        socket.broadcast.emit('newPlayer', players[socket.id]);
        io.emit('updatePlayerList', Object.keys(players).length);
        io.emit('serverMessage', `${nickname} joined team ${team}`);
        socket.emit('playerRespawn', players[socket.id]); 
    });

    socket.on('addBot', () => {
        if (Object.keys(players).length >= MAX_PLAYERS) return;
        const botId = 'bot_' + Math.random().toString(36).substr(2, 9);
        const spawn = getSafeSpawn();
        const botName = getUniqueBotName();
        let team = 'GREEN';
        if (gameMode === 'CTF') {
            const redCount = Object.values(players).filter(p => p.team === 'RED').length;
            const blueCount = Object.values(players).filter(p => p.team === 'BLUE').length;
            team = redCount <= blueCount ? 'RED' : 'BLUE';
        }
        players[botId] = { 
            id: botId, x: spawn.x, y: 20, z: spawn.z, rotation: 0, 
            nickname: botName, health: 100, isBot: true, score: 0, 
            targetX: 0, targetZ: 0, lastShot: 0, weapon: 'BLASTER', isDead: false, 
            lastPos: { x: spawn.x, z: spawn.z }, stuckTimer: 0, team: team
        };
        io.emit('newPlayer', players[botId]);
        io.emit('updatePlayerList', Object.keys(players).length);
        io.emit('serverMessage', `${botName} joined team ${team}`);
    });

    socket.on('removeBot', () => {
        const botId = Object.keys(players).reverse().find(id => players[id].isBot);
        if(botId) {
            delete players[botId];
            io.emit('playerDisconnected', botId);
            io.emit('updatePlayerList', Object.keys(players).length);
        }
    });

    socket.on('chatMessage', (msg) => { if(players[socket.id]) io.emit('chatMessage', { name: players[socket.id].nickname, text: msg }); });

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id] && !players[socket.id].isDead) {
            const p = players[socket.id];
            p.x = movementData.x; p.y = movementData.y; p.z = movementData.z; p.rotation = movementData.rotation;
            socket.broadcast.emit('playerMoved', p);
            checkFlagCollision(p);
        }
    });

    socket.on('shoot', (weaponData) => { if(players[socket.id] && !players[socket.id].isDead) socket.broadcast.emit('playerShot', { id: socket.id, weapon: weaponData }); });

    socket.on('playerHit', (victimId, damage) => {
        if (!gameActive) return;
        handleDamage(victimId, players[socket.id], damage);
    });

    socket.on('pickupAmmo', (ammoId) => {
        if (ammoPickups[ammoId] && ammoPickups[ammoId].active) {
            ammoPickups[ammoId].active = false;
            io.emit('ammoTaken', ammoId);
            setTimeout(() => { if(ammoPickups[ammoId]) { ammoPickups[ammoId].active = true; io.emit('ammoRespawn', ammoId); } }, 10000);
        }
    });
    socket.on('pickupHealth', (hpId) => {
        if (healthPickups[hpId] && healthPickups[hpId].active) {
            const p = players[socket.id];
            if(p && p.health < 100) {
                healthPickups[hpId].active = false;
                p.health = Math.min(100, p.health + 25);
                io.emit('healthTaken', hpId);
                io.emit('healthUpdate', { id: socket.id, health: p.health });
                setTimeout(() => { if(healthPickups[hpId]) { healthPickups[hpId].active = true; io.emit('healthRespawn', hpId); } }, 15000);
            }
        }
    });

    socket.on('disconnect', () => {
        if(players[socket.id]) {
            dropFlag(players[socket.id]);
            io.emit('serverMessage', `${players[socket.id].nickname} has disconnected`);
            delete players[socket.id];
            io.emit('playerDisconnected', socket.id);
            io.emit('updatePlayerList', Object.keys(players).length);
        }
        if (Object.keys(players).length === 0) {
            botCount = 0;
            gameActive = true;
            gameMode = 'DM';
            generateMap();
            teamScores = { red: 0, blue: 0 };
            io.emit('updateGameMode', gameMode); 
        }
    });
});

function checkFlagCollision(p) {
    if (gameMode !== 'CTF') return;
    const enemyColor = p.team === 'RED' ? 'blue' : 'red';
    const flag = flags[enemyColor];
    if (flag.carrier === null) {
        const d = Math.sqrt(Math.pow(p.x - flag.x, 2) + Math.pow(p.z - flag.z, 2));
        if (d < 3 && Math.abs(p.y - flag.y) < 5) {
            flag.carrier = p.id; flag.dropped = false;
            io.emit('flagUpdate', flags);
            io.emit('serverMessage', `${p.nickname} took the ${enemyColor} flag!`);
        }
    }
    const myColor = p.team === 'RED' ? 'red' : 'blue';
    const myFlag = flags[myColor];
    if (myFlag.dropped && myFlag.carrier === null) {
        const d = Math.sqrt(Math.pow(p.x - myFlag.x, 2) + Math.pow(p.z - myFlag.z, 2));
        if (d < 3 && Math.abs(p.y - myFlag.y) < 5) {
            myFlag.dropped = false; myFlag.x = myFlag.homeX; myFlag.z = myFlag.homeZ; myFlag.y = myFlag.homeY;
            io.emit('flagUpdate', flags);
            io.emit('serverMessage', `${p.nickname} returned the ${myColor} flag!`);
        }
    }
    if (flag.carrier === p.id) {
        const homeD = Math.sqrt(Math.pow(p.x - myFlag.homeX, 2) + Math.pow(p.z - myFlag.homeZ, 2));
        if (homeD < 5 && Math.abs(p.y - myFlag.homeY) < 5) {
            teamScores[p.team === 'RED' ? 'red' : 'blue']++;
            io.emit('serverMessage', `${p.nickname} captured the flag!`);
            flag.carrier = null; flag.dropped = false; flag.x = flag.homeX; flag.z = flag.homeZ; flag.y = flag.homeY;
            io.emit('flagUpdate', flags);
            if (teamScores[p.team === 'RED' ? 'red' : 'blue'] >= fragLimit) endGame(`${p.team} TEAM`);
        }
    }
}

function dropFlag(p) {
    if (gameMode !== 'CTF') return;
    const enemyColor = p.team === 'RED' ? 'blue' : 'red';
    if (flags[enemyColor].carrier === p.id) {
        flags[enemyColor].carrier = null; flags[enemyColor].dropped = true;
        flags[enemyColor].x = p.x; flags[enemyColor].z = p.z; flags[enemyColor].y = p.y;
        io.emit('flagUpdate', flags);
        io.emit('serverMessage', `${p.nickname} dropped the ${enemyColor} flag!`);
    }
}

function handleDamage(victimId, attacker, damage) {
    const victim = players[victimId];
    if (victim && !victim.isDead) {
        if(gameMode === 'CTF' && attacker && attacker.team === victim.team && attacker.id !== victim.id) return;
        victim.health -= damage;
        io.emit('healthUpdate', { id: victimId, health: victim.health });
        if (victim.health <= 0) {
            victim.isDead = true; 
            dropFlag(victim);
            if (attacker && attacker.id !== victim.id) {
                attacker.score++; 
                io.emit('scoreUpdate', { id: attacker.id, score: attacker.score });
                io.emit('serverMessage', `${attacker.nickname} fragged ${victim.nickname}`);
                if (gameMode === 'DM' && attacker.score >= fragLimit) endGame(attacker.nickname);
            } else { io.emit('serverMessage', `${victim.nickname} died`); }
            io.emit('playerDied', victim.id);
            setTimeout(() => {
                if(!gameActive) return;
                if(players[victim.id]) { 
                    const spawn = getSafeSpawn();
                    victim.health = 100; victim.x = spawn.x; victim.z = spawn.z; victim.y = 20; victim.isDead = false;
                    io.emit('playerRespawn', victim);
                }
            }, 3000);
        }
    }
}

function endGame(winnerName) {
    gameActive = false;
    io.emit('gameOver', winnerName);
    setTimeout(() => {
        gameActive = true;
        teamScores = { red: 0, blue: 0 };
        players = {}; 
        generateMap();
        io.emit('mapConfig', currentMap);
        io.emit('ammoState', ammoPickups);
        io.emit('healthState', healthPickups);
        io.emit('flagState', flags);
        io.emit('gameReset', players); 
    }, 6000); 
}

const BOT_WEAPONS = ['BLASTER', 'SHOTGUN', 'RAILGUN'];
setInterval(() => {
    if (!gameActive) return;
    for (const botId in players) {
        const bot = players[botId];
        if (!bot.isBot || bot.isDead) continue;
        
        if(bot.lastPos) {
            const distMoved = Math.sqrt(Math.pow(bot.x - bot.lastPos.x, 2) + Math.pow(bot.z - bot.lastPos.z, 2));
            if (distMoved < 0.05) bot.stuckTimer = (bot.stuckTimer || 0) + 1; else bot.stuckTimer = 0;
            if (bot.stuckTimer > 30) { bot.y += 3; bot.targetX = (Math.random() * 160) - 80; bot.targetZ = (Math.random() * 160) - 80; bot.stuckTimer = 0; }
        }
        bot.lastPos = { x: bot.x, z: bot.z };
        bot.y = getBotHeight(bot.x, bot.z, bot.y);
        if (bot.y <= 2.1 && Math.random() < 0.005) bot.y += 3;

        let target = null;
        if (gameMode === 'CTF') {
            const enemyColor = bot.team === 'RED' ? 'blue' : 'red';
            const myColor = bot.team === 'RED' ? 'red' : 'blue';
            if (flags[enemyColor].carrier === bot.id) target = { x: flags[myColor].homeX, z: flags[myColor].homeZ };
            else if (flags[myColor].dropped) target = { x: flags[myColor].x, z: flags[myColor].z };
            else target = { x: flags[enemyColor].x, z: flags[enemyColor].z };
            
            const dx = target.x - bot.x; const dz = target.z - bot.z;
            const angle = Math.atan2(dx, dz);
            const nextX = bot.x + Math.sin(angle) * 0.15;
            const nextZ = bot.z + Math.cos(angle) * 0.15;
            if(!checkBotWallCollision(nextX, nextZ)) { bot.x = nextX; bot.z = nextZ; }
            bot.rotation = angle;
        } 
        
        let enemy = null; let minDist = 1000;
        for (const pid in players) {
            const p = players[pid];
            if (pid !== botId && p.health > 0 && !p.isDead) {
                if (gameMode === 'DM' || p.team !== bot.team) {
                    const d = Math.sqrt(Math.pow(p.x - bot.x, 2) + Math.pow(p.z - bot.z, 2));
                    if (d < minDist) { minDist = d; enemy = p; }
                }
            }
        }
        
        if (enemy && minDist < 50) {
            if(gameMode === 'DM') {
                 const dx = enemy.x - bot.x; const dz = enemy.z - bot.z;
                 const angle = Math.atan2(dx, dz);
                 bot.rotation = angle;
                 const nextX = bot.x + Math.sin(angle) * 0.15;
                 const nextZ = bot.z + Math.cos(angle) * 0.15;
                 if(!checkBotWallCollision(nextX, nextZ)) { bot.x = nextX; bot.z = nextZ; }
            }
            const now = Date.now();
            let cooldown = 1000; let damage = 10;
            if(bot.weapon === 'SHOTGUN') { cooldown = 1500; damage = 8; }
            if(bot.weapon === 'RAILGUN') { cooldown = 2000; damage = 40; }
            if (now - (bot.lastShot || 0) > cooldown) {
                bot.lastShot = now;
                io.emit('playerShot', { id: bot.id, weapon: {type: bot.weapon} });
                let hitChance = 0.3;
                if(bot.weapon === 'SHOTGUN') hitChance = 0.5;
                if(bot.weapon === 'RAILGUN') hitChance = 0.2;
                if (Math.random() < hitChance) handleDamage(enemy.id, bot, damage);
            }
        } else if (gameMode === 'DM') {
            const dx = bot.targetX - bot.x; const dz = bot.targetZ - bot.z;
            const dist = Math.sqrt(dx*dx + dz*dz);
            if (dist < 2 || checkBotWallCollision(bot.x + (dx/dist), bot.z + (dz/dist))) {
                bot.targetX = (Math.random() * 160) - 80; bot.targetZ = (Math.random() * 160) - 80;
            } else {
                bot.x += (dx/dist) * 0.1; bot.z += (dz/dist) * 0.1;
                bot.rotation = Math.atan2(dx, dz);
            }
        }
        checkFlagCollision(bot);
        io.emit('playerMoved', bot);
    }
}, 1000 / 30); 

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });