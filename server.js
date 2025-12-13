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

// Game Settings
let fragLimit = 10; 
let gameActive = true;

// Map Coordinates
const SPAWN_POINTS = [
    { x: 0, z: 0 }, { x: 20, z: 0 }, { x: -20, z: 0 }, { x: 0, z: 20 }, { x: 0, z: -20 },
    { x: 85, z: 85 }, { x: -85, z: -85 }, { x: 85, z: -85 }, { x: -85, z: 85 },
    { x: 50, z: 0 }, { x: -50, z: 0 }, { x: 0, z: 50 }, { x: 0, z: -50 }
];

const AMMO_LOCATIONS = [
    // Ground Floor Shotguns
    { id: 'ammo_sg_1', x: 25, z: 25, y: 1.5, type: 'shotgun' },
    { id: 'ammo_sg_2', x: -25, z: -25, y: 1.5, type: 'shotgun' },
    
    // High Ground Railguns (The 2nd Floor Ring)
    { id: 'ammo_rg_1', x: 0, z: 55, y: 13.5, type: 'railgun' }, // North Catwalk
    { id: 'ammo_rg_2', x: 0, z: -55, y: 13.5, type: 'railgun' }, // South Catwalk
    
    // Far Edge Railguns
    { id: 'ammo_rg_3', x: 90, z: 0, y: 1.5, type: 'railgun' },
    { id: 'ammo_rg_4', x: -90, z: 0, y: 1.5, type: 'railgun' }
];

const HEALTH_LOCATIONS = [
    { id: 'hp_1', x: 0, z: 0, y: 1.5 },      // Dead Center
    // High Ground Health
    { id: 'hp_2', x: 55, z: 0, y: 13.5 },    // East Catwalk
    { id: 'hp_3', x: -55, z: 0, y: 13.5 },   // West Catwalk
    // Outer Corners
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
        const spawn = getSafeSpawn();
        const nickname = data.nickname || "Unknown";
        if(data.fragLimit) fragLimit = parseInt(data.fragLimit);

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

    socket.on('chatMessage', (msg) => {
        if(players[socket.id]) {
            io.emit('chatMessage', { name: players[socket.id].nickname, text: msg });
        }
    });

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].z = movementData.z;
            players[socket.id].rotation = movementData.rotation;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('shoot', (weaponData) => {
        socket.broadcast.emit('playerShot', { id: socket.id, weapon: weaponData });
    });

    socket.on('playerHit', (victimId, damage) => {
        if (!gameActive) return;
        const victim = players[victimId];
        const attacker = players[socket.id]; 

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
    });

    socket.on('pickupAmmo', (ammoId) => {
        if (ammoPickups[ammoId] && ammoPickups[ammoId].active) {
            ammoPickups[ammoId].active = false;
            io.emit('ammoTaken', ammoId);
            setTimeout(() => {
                if(ammoPickups[ammoId]) {
                    ammoPickups[ammoId].active = true;
                    io.emit('ammoRespawn', ammoId);
                }
            }, 10000);
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
                setTimeout(() => {
                    if(healthPickups[hpId]) {
                        healthPickups[hpId].active = true;
                        io.emit('healthRespawn', hpId);
                    }
                }, 15000);
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

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });