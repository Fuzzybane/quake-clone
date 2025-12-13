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

// --- CONFIGURATION ---
const MAX_PLAYERS = 16; // Hard Cap
let fragLimit = 10; 
let gameActive = true;
let botCount = 0;

// --- MAP COLLISION DATA ---
const MAP_OBSTACLES = [
    { x: 15, z: 15 }, { x: -15, z: -15 }, { x: 15, z: -15 }, { x: -15, z: 15 },
    { x: 40, z: 40 }, { x: 40, z: -40 }, { x: -40, z: 40 }, { x: -40, z: -40 },
    { x: 80, z: 80 }, { x: -80, z: -80 }, { x: 80, z: -80 }, { x: -80, z: 80 }
];

const SPAWN_POINTS = [
    { x: 0, z: 0 }, { x: 20, z: 0 }, { x: -20, z: 0 }, { x: 0, z: 20 }, { x: 0, z: -20 },
    { x: 85, z: 85 }, { x: -85, z: -85 }, { x: 85, z: -85 }, { x: -85, z: 85 },
    { x: 50, z: 0 }, { x: -50, z: 0 }, { x: 0, z: 50 }, { x: 0, z: -50 }
];

const AMMO_LOCATIONS = [
    { id: 'ammo_sg_1', x: 25, z: 25, y: 1.5, type: 'shotgun' },
    { id: 'ammo_sg_2', x: -25, z: -25, y: 1.5, type: 'shotgun' },
    { id: 'ammo_sg_3', x: 25, z: -25, type: 'shotgun' },
    { id: 'ammo_sg_4', x: -25, z: 25, y: 1.5, type: 'shotgun' },
    { id: 'ammo_rg_1', x: 90, z: 0, y: 1.5, type: 'railgun' },
    { id: 'ammo_rg_2', x: -90, z: 0, y: 1.5, type: 'railgun' },
    { id: 'ammo_rg_3', x: 0, z: 90, type: 'railgun' },
    { id: 'ammo_rg_4', x: 0, z: -90, type: 'railgun' }
];

const HEALTH_LOCATIONS = [
    { id: 'hp_1', x: 0, z: 0, y: 1.5 },
    { id: 'hp_2', x: 55, z: 0, y: 13.5 },
    { id: 'hp_3', x: -55, z: 0, y: 13.5 },
    { id: 'hp_4', x: 90, z: 90, y: 1.5 },
    { id: 'hp_5', x: -90, z: -90, y: 1.5 }
];

AMMO_LOCATIONS.forEach(loc => { ammoPickups[loc.id] = { ...loc, active: true }; });
HEALTH_LOCATIONS.forEach(loc => { healthPickups[loc.id] = { ...loc, active: true }; });

function getSafeSpawn() {
    const pick = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    return { x: pick.x + (Math.random()-0.5), z: pick.z + (Math.random()-0.5) };
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    socket.emit('updatePlayerList', Object.keys(players).length);

    socket.on('joinGame', (data) => {
        const currentCount = Object.keys(players).length;
        const botId = Object.keys(players).find(id => players[id].isBot);

        // --- 1. CHECK SERVER CAP ---
        if (currentCount >= MAX_PLAYERS) {
            if (botId) {
                // Server full, but we have a bot. Kick bot to make room.
                delete players[botId];
                io.emit('playerDisconnected', botId);
            } else {
                // Server full of humans. Reject connection.
                socket.emit('serverMessage', 'SERVER FULL! Cannot join.');
                return; // Stop execution
            }
        }

        const spawn = getSafeSpawn();
        const nickname = data.nickname || "Unknown";
        
        if (Object.keys(players).length === 0) {
            if(data.fragLimit) fragLimit = parseInt(data.fragLimit);
        }

        players[socket.id] = {
            id: socket.id, x: spawn.x, y: 5, z: spawn.z, rotation: 0,
            nickname: nickname, health: 100, isBot: false, score: 0
        };

        socket.emit('mapConfig', { seed: MAP_SEED });
        socket.emit('ammoState', ammoPickups);
        socket.emit('healthState', healthPickups);
        socket.emit('currentPlayers', players);
        socket.broadcast.emit('newPlayer', players[socket.id]);
        io.emit('updatePlayerList', Object.keys(players).length);
        io.emit('serverMessage', `${nickname} has entered the arena`);
    });

    socket.on('addBot', () => {
        // Check Cap before adding bot
        if (Object.keys(players).length >= MAX_PLAYERS) {
            socket.emit('serverMessage', 'Server Full: Cannot add Bot');
            return;
        }

        const botId = 'bot_' + Math.random().toString(36).substr(2, 9);
        const spawn = getSafeSpawn();
        
        players[botId] = {
            id: botId, x: spawn.x, y: 5, z: spawn.z, rotation: 0,
            nickname: `Bot_${++botCount}`, health: 100, isBot: true, score: 0,
            targetX: 0, targetZ: 0, lastShot: 0, weapon: 'BLASTER'
        };

        io.emit('newPlayer', players[botId]);
        io.emit('updatePlayerList', Object.keys(players).length);
        io.emit('serverMessage', `${players[botId].nickname} has been added`);
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
            } else {
                io.emit('serverMessage', `${victim.nickname} died`);
            }
        }
    }
}

function endGame(winnerName) {
    gameActive = false;
    io.emit('gameOver', winnerName);
    setTimeout(() => {
        gameActive = true;
        for (let id in players) {
            players[id].score = 0; players[id].health = 100;
            const spawn = getSafeSpawn();
            players[id].x = spawn.x; players[id].z = spawn.z; players[id].y = 5;
        }
        io.emit('gameReset', players);
    }, 6000); 
}

function checkBotWallCollision(x, z) {
    if (x > 95 || x < -95 || z > 95 || z < -95) return true;
    for(let obs of MAP_OBSTACLES) {
        if (Math.abs(x - obs.x) < 7 && Math.abs(z - obs.z) < 7) return true;
    }
    return false;
}

const BOT_WEAPONS = ['BLASTER', 'SHOTGUN', 'RAILGUN'];

setInterval(() => {
    if (!gameActive) return;

    for (const botId in players) {
        if (players[botId].isBot) {
            const bot = players[botId];
            
            let target = null;
            let minDist = 1000;

            for (const pid in players) {
                if (pid !== botId && players[pid].health > 0) {
                    const p = players[pid];
                    const d = Math.sqrt(Math.pow(p.x - bot.x, 2) + Math.pow(p.z - bot.z, 2));
                    if (d < minDist) {
                        minDist = d;
                        target = p;
                    }
                }
            }

            if(Math.random() < 0.01) {
                bot.weapon = BOT_WEAPONS[Math.floor(Math.random() * BOT_WEAPONS.length)];
            }

            if (target && minDist < 60) {
                const dx = target.x - bot.x;
                const dz = target.z - bot.z;
                const angle = Math.atan2(dx, dz);
                const nextX = bot.x + Math.sin(angle) * 0.15;
                const nextZ = bot.z + Math.cos(angle) * 0.15;

                if(!checkBotWallCollision(nextX, nextZ)) {
                    bot.x = nextX; bot.z = nextZ;
                }
                bot.rotation = angle;
            } else {
                const dx = bot.targetX - bot.x;
                const dz = bot.targetZ - bot.z;
                const dist = Math.sqrt(dx*dx + dz*dz);
                if (dist < 2 || checkBotWallCollision(bot.x + (dx/dist), bot.z + (dz/dist))) {
                    bot.targetX = (Math.random() * 160) - 80;
                    bot.targetZ = (Math.random() * 160) - 80;
                } else {
                    bot.x += (dx/dist) * 0.1; bot.z += (dz/dist) * 0.1;
                    bot.rotation = Math.atan2(dx, dz);
                }
            }

            if(Math.random() < 0.005 && bot.y < 3) bot.y += 3;
            if(bot.y > 2) bot.y -= 0.1;

            if (target && minDist < 50) {
                const now = Date.now();
                let cooldown = 1000;
                let damage = 10;
                if(bot.weapon === 'SHOTGUN') { cooldown = 1500; damage = 8; }
                if(bot.weapon === 'RAILGUN') { cooldown = 2000; damage = 40; }

                if (now - (bot.lastShot || 0) > cooldown) {
                    bot.lastShot = now;
                    io.emit('playerShot', { id: bot.id, weapon: {type: bot.weapon} });
                    
                    let hitChance = 0.3;
                    if(bot.weapon === 'SHOTGUN') hitChance = 0.5;
                    if(bot.weapon === 'RAILGUN') hitChance = 0.2;

                    if (Math.random() < hitChance) {
                        handleDamage(target.id, bot, damage);
                    }
                }
            }
            io.emit('playerMoved', bot);
        }
    }
}, 1000 / 30); 

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });