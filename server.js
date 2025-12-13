const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// 1. Force the public folder
app.use(express.static(path.join(__dirname, 'public')));

// 2. Explicitly serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let players = {};
let ammoPickups = {}; 
const MAP_SEED = Math.random(); 

// Game Settings
let fragLimit = 10; 
let gameActive = true;

// --- NEW MAP COORDINATES ---
// The map is 200x200 (-100 to +100)
// We avoid placing spawns on: +/- 40, +/- 60, +/- 80 (where walls will be)

const SPAWN_POINTS = [
    // Center Safe Spots
    { x: 0, z: 0 }, 
    { x: 20, z: 0 }, { x: -20, z: 0 }, { x: 0, z: 20 }, { x: 0, z: -20 },
    // Outer Corners (Safe starts)
    { x: 85, z: 85 }, { x: -85, z: -85 }, { x: 85, z: -85 }, { x: -85, z: 85 },
    // Mid-Field Corridors
    { x: 50, z: 0 }, { x: -50, z: 0 }, { x: 0, z: 50 }, { x: 0, z: -50 }
];

const AMMO_LOCATIONS = [
    // Shotguns (Mid-range access)
    { id: 'ammo_sg_1', x: 25, z: 25, type: 'shotgun' },
    { id: 'ammo_sg_2', x: -25, z: -25, type: 'shotgun' },
    { id: 'ammo_sg_3', x: 25, z: -25, type: 'shotgun' },
    { id: 'ammo_sg_4', x: -25, z: 25, type: 'shotgun' },
    
    // Railguns (Far edges - High risk to get them)
    { id: 'ammo_rg_1', x: 90, z: 0, type: 'railgun' },
    { id: 'ammo_rg_2', x: -90, z: 0, type: 'railgun' },
    { id: 'ammo_rg_3', x: 0, z: 90, type: 'railgun' },
    { id: 'ammo_rg_4', x: 0, z: -90, type: 'railgun' }
];

AMMO_LOCATIONS.forEach(loc => { ammoPickups[loc.id] = { ...loc, active: true }; });

function getSafeSpawn() {
    const pick = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    // Add small random offset to prevent stacking
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
            id: socket.id,
            x: spawn.x, y: 5, z: spawn.z, rotation: 0,
            nickname: nickname,
            health: 100, isBot: false, score: 0
        };

        socket.emit('mapConfig', { seed: MAP_SEED });
        socket.emit('ammoState', ammoPickups);
        socket.emit('currentPlayers', players);
        socket.broadcast.emit('newPlayer', players[socket.id]);
        io.emit('updatePlayerList', Object.keys(players).length);
        io.emit('serverMessage', `${nickname} has entered the arena`);
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
                victim.health = 100;
                victim.x = spawn.x;
                victim.z = spawn.z;
                victim.y = 5; 
                io.emit('playerRespawn', victim);

                if (attacker && attacker.id !== victim.id) {
                    attacker.score++;
                    io.emit('scoreUpdate', { id: attacker.id, score: attacker.score });
                    io.emit('serverMessage', `${attacker.nickname} fragged ${victim.nickname}`);
                    
                    if (attacker.score >= fragLimit) {
                        endGame(attacker.nickname);
                    }
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
            players[id].score = 0;
            players[id].health = 100;
            const spawn = getSafeSpawn();
            players[id].x = spawn.x;
            players[id].z = spawn.z;
            players[id].y = 5;
        }
        io.emit('gameReset', players);
    }, 6000); 
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});