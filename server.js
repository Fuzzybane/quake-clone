const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let ammoPickups = {}; 
const MAP_SEED = Math.random(); 

// Game Settings
let fragLimit = 10; 
let gameActive = true;

const SPAWN_POINTS = [
    { x: 0, z: 0 }, { x: 20, z: 20 }, { x: -20, z: -20 },
    { x: 20, z: -20 }, { x: -20, z: 20 }, { x: 10, z: 0 },
    { x: -10, z: 0 }, { x: 0, z: 15 }
];

const AMMO_LOCATIONS = [
    { id: 'ammo_1', x: 0, z: 0, type: 'shotgun' },
    { id: 'ammo_2', x: 25, z: 25, type: 'railgun' },
    { id: 'ammo_3', x: -25, z: -25, type: 'railgun' },
    { id: 'ammo_4', x: 10, z: -10, type: 'shotgun' }
];

AMMO_LOCATIONS.forEach(loc => { ammoPickups[loc.id] = { ...loc, active: true }; });

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
        
        // Host sets the rule (First player or anyone joining updates it)
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
        const attacker = players[socket.id]; // socket.id is the shooter

        if (victim) {
            victim.health -= damage;
            io.emit('healthUpdate', { id: victimId, health: victim.health });
            
            if (victim.health <= 0) {
                // Respawn Victim
                const spawn = getSafeSpawn();
                victim.health = 100;
                victim.x = spawn.x;
                victim.z = spawn.z;
                victim.y = 5; 
                io.emit('playerRespawn', victim);

                // Credit Killer
                if (attacker && attacker.id !== victim.id) {
                    attacker.score++;
                    io.emit('scoreUpdate', { id: attacker.id, score: attacker.score });
                    io.emit('serverMessage', `${attacker.nickname} fragged ${victim.nickname}`);
                    
                    // CHECK WIN CONDITION
                    if (attacker.score >= fragLimit) {
                        endGame(attacker.nickname);
                    }
                } else {
                    // Suicide (fell off world or self damage if we added it)
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

    // Reset loop
    setTimeout(() => {
        gameActive = true;
        // Reset scores and positions
        for (let id in players) {
            players[id].score = 0;
            players[id].health = 100;
            const spawn = getSafeSpawn();
            players[id].x = spawn.x;
            players[id].z = spawn.z;
            players[id].y = 5;
        }
        io.emit('gameReset', players);
    }, 6000); // 6 seconds
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});