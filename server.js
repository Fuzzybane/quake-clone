const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let players = {};
let ammoPickups = {}; 
let healthPickups = {}; 
const MAP_SEED = Math.random(); 

const MAX_PLAYERS = 16; 
let fragLimit = 10; 
let gameActive = true;
let botCount = 0;

let currentMap = { walls: [], platforms: [], ramps: [], spawns: [], ammo: [], health: [] };

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

// --- MAP GENERATION ---
function generateMap() {
    currentMap = { walls: [], platforms: [], ramps: [], spawns: [], ammo: [], health: [] };
    ammoPickups = {};
    healthPickups = {};

    // 1. CATWALK RING (Height 12)
    currentMap.platforms.push({ x: -50, z: 70, w: 80, d: 20 });
    currentMap.platforms.push({ x: 50, z: 70, w: 80, d: 20 });
    currentMap.platforms.push({ x: 0, z: 70, w: 20, d: 20 }); // Pad

    currentMap.platforms.push({ x: -50, z: -70, w: 80, d: 20 });
    currentMap.platforms.push({ x: 50, z: -70, w: 80, d: 20 });
    currentMap.platforms.push({ x: 0, z: -70, w: 20, d: 20 }); // Pad

    currentMap.platforms.push({ x: 70, z: -50, w: 20, d: 80 }); 
    currentMap.platforms.push({ x: 70, z: 50, w: 20, d: 80 });
    currentMap.platforms.push({ x: 70, z: 0, w: 20, d: 20 }); // Pad

    currentMap.platforms.push({ x: -70, z: -50, w: 20, d: 80 });
    currentMap.platforms.push({ x: -70, z: 50, w: 20, d: 80 });
    currentMap.platforms.push({ x: -70, z: 0, w: 20, d: 20 }); // Pad

    // 2. RAMPS
    currentMap.ramps.push({ x: 0, z: 45, dir: 'North' });
    currentMap.ramps.push({ x: 0, z: -45, dir: 'South' });
    currentMap.ramps.push({ x: 45, z: 0, dir: 'East' });
    currentMap.ramps.push({ x: -45, z: 0, dir: 'West' });

    // 3. PILLARS
    currentMap.walls.push({ x: 35, z: 35, w: 10, d: 10 });
    currentMap.walls.push({ x: -35, z: 35, w: 10, d: 10 });
    currentMap.walls.push({ x: 35, z: -35, w: 10, d: 10 });
    currentMap.walls.push({ x: -35, z: -35, w: 10, d: 10 });

    // 4. SPAWNS (Ensuring Center is valid)
    currentMap.spawns = [
        { x: 0, z: 0 }, 
        { x: 85, z: 85 }, { x: -85, z: -85 }, { x: 85, z: -85 }, { x: -85, z: 85 }, 
        { x: 0, z: 20 }, { x: 0, z: -20 }, { x: 20, z: 0 }, { x: -20, z: 0 }
    ];

    // 5. ITEMS
    let aid=0, hid=0;
    ammoPickups[`ammo_${aid++}`] = { id: `ammo_${aid}`, x: 70, z: 60, y: 13.5, type: 'railgun', active: true };
    ammoPickups[`ammo_${aid++}`] = { id: `ammo_${aid}`, x: -70, z: -60, y: 13.5, type: 'railgun', active: true };
    ammoPickups[`ammo_${aid++}`] = { id: `ammo_${aid}`, x: 20, z: 20, y: 1.5, type: 'shotgun', active: true };
    ammoPickups[`ammo_${aid++}`] = { id: `ammo_${aid}`, x: -20, z: -20, y: 1.5, type: 'shotgun', active: true };

    healthPickups[`hp_${hid++}`] = { id: `hp_${hid}`, x: 0, z: 0, y: 1.5, active: true };
    healthPickups[`hp_${hid++}`] = { id: `hp_${hid}`, x: 70, z: -70, y: 13.5, active: true }; 
    healthPickups[`hp_${hid++}`] = { id: `hp_${hid}`, x: -70, z: 70, y: 13.5, active: true };
}

generateMap();

// --- PHYSICS HELPERS ---

function isPosSafe(x, z) {
    if (isNaN(x) || isNaN(z)) return false;
    if (x > 90 || x < -90 || z > 90 || z < -90) return false;

    // Walls
    for (let w of currentMap.walls) {
        const halfW = (w.w/2) + 4; 
        const halfD = (w.d/2) + 4;
        if (x > w.x - halfW && x < w.x + halfW && z > w.z - halfD && z < w.z + halfD) return false;
    }
    // Platforms (Don't spawn inside pillars)
    for (let p of currentMap.platforms) {
        const halfW = (p.w/2) + 2;
        const halfD = (p.d/2) + 2;
        if (x > p.x - halfW && x < p.x + halfW && z > p.z - halfD && z < p.z + halfD) return false;
    }
    // Ramps
    for (let r of currentMap.ramps) {
        if(Math.abs(x - r.x) < 8 && Math.abs(z - r.z) < 18) return false;
    }
    return true;
}

function getSafeSpawn() {
    // Safety check if map generated incorrectly
    if (!currentMap.spawns || currentMap.spawns.length === 0) return { x: 0, z: 0 };

    let attempts = 0;
    while(attempts < 50) {
        const pick = currentMap.spawns[Math.floor(Math.random() * currentMap.spawns.length)];
        const tx = pick.x + (Math.random() - 0.5) * 5; 
        const tz = pick.z + (Math.random() - 0.5) * 5;
        if (isPosSafe(tx, tz)) return { x: tx, z: tz };
        attempts++;
    }
    return { x: 0, z: 0 };
}

function checkBotWallCollision(x, z) {
    return !isPosSafe(x, z);
}

function getBotHeight(x, z, currentY) {
    if (isNaN(x) || isNaN(z)) return 2;

    // 1. Ramps
    for (let r of currentMap.ramps) {
        let dx = x - r.x;
        let dz = z - r.z;
        if (r.dir === 'North' && Math.abs(dx) < 4 && dz > -15 && dz < 15) return 2 + ((dz + 15) / 30 * 12);
        if (r.dir === 'South' && Math.abs(dx) < 4 && dz > -15 && dz < 15) return 2 + ((15 - dz) / 30 * 12);
        if (r.dir === 'East' && Math.abs(dz) < 4 && dx > -15 && dx < 15) return 2 + ((dx + 15) / 30 * 12);
        if (r.dir === 'West' && Math.abs(dz) < 4 && dx > -15 && dx < 15) return 2 + ((15 - dx) / 30 * 12);
    }

    // 2. Catwalks
    for (let p of currentMap.platforms) {
        const halfW = p.w / 2;
        const halfD = p.d / 2;
        if (x > p.x - halfW && x < p.x + halfW && z > p.z - halfD && z < p.z + halfD) {
            // FIX: Only snap to 14 if we are ALREADY high (e.g. at top of ramp ~12)
            // If we are walking on ground (Y=2), do NOT snap up.
            if (currentY > 10) return 14; 
            else return 2;
        }
    }
    return 2;
}

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    socket.emit('updatePlayerList', Object.keys(players).length);

    socket.on('joinGame', (data) => {
        const currentCount = Object.keys(players).length;
        const botId = Object.keys(players).find(id => players[id].isBot);

        if (currentCount >= MAX_PLAYERS) {
            if (botId) { delete players[botId]; io.emit('playerDisconnected', botId); } 
            else { socket.emit('serverMessage', 'SERVER FULL! Cannot join.'); return; }
        }

        const spawn = getSafeSpawn();
        const nickname = data.nickname || "Unknown";
        if (Object.keys(players).length === 0) if(data.fragLimit) fragLimit = parseInt(data.fragLimit);

        players[socket.id] = { id: socket.id, x: spawn.x, y: 5, z: spawn.z, rotation: 0, nickname: nickname, health: 100, isBot: false, score: 0 };

        socket.emit('mapConfig', currentMap);
        socket.emit('ammoState', ammoPickups);
        socket.emit('healthState', healthPickups);
        socket.emit('currentPlayers', players);
        socket.broadcast.emit('newPlayer', players[socket.id]);
        io.emit('updatePlayerList', Object.keys(players).length);
        io.emit('serverMessage', `${nickname} has entered the arena`);
    });

    socket.on('addBot', () => {
        if (Object.keys(players).length >= MAX_PLAYERS) return;
        const botId = 'bot_' + Math.random().toString(36).substr(2, 9);
        const spawn = getSafeSpawn();
        const botName = getUniqueBotName();
        players[botId] = { id: botId, x: spawn.x, y: 5, z: spawn.z, rotation: 0, nickname: botName, health: 100, isBot: true, score: 0, targetX: 0, targetZ: 0, lastShot: 0, weapon: 'BLASTER' };
        io.emit('newPlayer', players[botId]);
        io.emit('updatePlayerList', Object.keys(players).length);
        io.emit('serverMessage', `${botName} has joined`);
    });

    socket.on('removeBot', () => {
        const botId = Object.keys(players).reverse().find(id => players[id].isBot);
        if(botId) {
            io.emit('serverMessage', `${players[botId].nickname} removed`);
            delete players[botId];
            io.emit('playerDisconnected', botId);
            io.emit('updatePlayerList', Object.keys(players).length);
        }
    });

    socket.on('chatMessage', (msg) => { if(players[socket.id]) io.emit('chatMessage', { name: players[socket.id].nickname, text: msg }); });

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].z = movementData.z;
            players[socket.id].rotation = movementData.rotation;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('shoot', (weaponData) => { socket.broadcast.emit('playerShot', { id: socket.id, weapon: weaponData }); });

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
            io.emit('serverMessage', `${players[socket.id].nickname} has disconnected`);
            delete players[socket.id];
            io.emit('playerDisconnected', socket.id);
            io.emit('updatePlayerList', Object.keys(players).length);
        }
        if (Object.keys(players).length === 0) {
            botCount = 0;
            gameActive = true;
            generateMap();
        }
    });
});

function handleDamage(victimId, attacker, damage) {
    const victim = players[victimId];
    if (victim) {
        victim.health -= damage;
        io.emit('healthUpdate', { id: victimId, health: victim.health });
        if (victim.health <= 0) {
            const spawn = getSafeSpawn();
            victim.health = 100; victim.x = spawn.x; victim.z = spawn.z; victim.y = 5; 
            io.emit('playerRespawn', victim);
            if (attacker && attacker.id !== victim.id) {
                attacker.score++;
                io.emit('scoreUpdate', { id: attacker.id, score: attacker.score });
                io.emit('serverMessage', `${attacker.nickname} fragged ${victim.nickname}`);
                if (attacker.score >= fragLimit) endGame(attacker.nickname);
            } else { io.emit('serverMessage', `${victim.nickname} died`); }
        }
    }
}

function endGame(winnerName) {
    gameActive = false;
    io.emit('gameOver', winnerName);
    setTimeout(() => {
        gameActive = true;
        players = {}; 
        generateMap();
        for (let id in players) {
            players[id].score = 0; players[id].health = 100;
            const spawn = getSafeSpawn();
            players[id].x = spawn.x; players[id].z = spawn.z; players[id].y = 5;
        }
        io.emit('mapConfig', currentMap);
        io.emit('gameReset', players);
    }, 6000); 
}

const BOT_WEAPONS = ['BLASTER', 'SHOTGUN', 'RAILGUN'];
setInterval(() => {
    if (!gameActive) return;
    for (const botId in players) {
        if (players[botId].isBot) {
            const bot = players[botId];
            
            // AI Logic
            let target = null; let minDist = 1000;
            for (const pid in players) {
                if (pid !== botId && players[pid].health > 0) {
                    const p = players[pid];
                    const d = Math.sqrt(Math.pow(p.x - bot.x, 2) + Math.pow(p.z - bot.z, 2));
                    if (d < minDist) { minDist = d; target = p; }
                }
            }
            if(Math.random() < 0.01) bot.weapon = BOT_WEAPONS[Math.floor(Math.random() * BOT_WEAPONS.length)];
            
            if (target && minDist < 60) {
                const dx = target.x - bot.x; const dz = target.z - bot.z;
                const angle = Math.atan2(dx, dz);
                const nextX = bot.x + Math.sin(angle) * 0.15;
                const nextZ = bot.z + Math.cos(angle) * 0.15;
                if(!checkBotWallCollision(nextX, nextZ)) { bot.x = nextX; bot.z = nextZ; }
                bot.rotation = angle;
            } else {
                const dx = bot.targetX - bot.x; const dz = bot.targetZ - bot.z;
                const dist = Math.sqrt(dx*dx + dz*dz);
                if (dist < 2 || checkBotWallCollision(bot.x + (dx/dist), bot.z + (dz/dist))) {
                    bot.targetX = (Math.random() * 160) - 80; bot.targetZ = (Math.random() * 160) - 80;
                } else {
                    bot.x += (dx/dist) * 0.1; bot.z += (dz/dist) * 0.1;
                    bot.rotation = Math.atan2(dx, dz);
                }
            }
            
            bot.y = getBotHeight(bot.x, bot.z, bot.y);
            // Anti-NaN Check
            if (isNaN(bot.y)) bot.y = 2;
            if (isNaN(bot.x)) bot.x = 0;
            if (isNaN(bot.z)) bot.z = 0;

            if (bot.y <= 2.1 && Math.random() < 0.005) bot.y += 3;

            if (target && minDist < 50) {
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
                    if (Math.random() < hitChance) handleDamage(target.id, bot, damage);
                }
            }
            io.emit('playerMoved', bot);
        }
    }
}, 1000 / 30); 

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });