const room = new WebsimSocket();
const COLLECTION_NAME = 'player_data_v1';
const MAX_SCORES_PER_USER = 10;

export async function submitScore(lastGameData, onSuccess, onError) {
    try {
        let gameDataForDb = { ...lastGameData };
        if (gameDataForDb.replayData) {
            try {
                const replayJson = JSON.stringify(gameDataForDb.replayData);
                const replayBlob = new Blob([replayJson], { type: 'application/json' });
                const replayFile = new File([replayBlob], 'replay.json');
                const replayUrl = await window.websim.upload(replayFile);

                gameDataForDb.replayDataUrl = replayUrl;
                delete gameDataForDb.replayData;

            } catch (uploadError) {
                console.error("Error uploading replay data:", uploadError);
                if (onError) onError(uploadError);
                return; // Stop submission if upload fails
            }
        }
        
        const currentUser = await window.websim.getCurrentUser();
        if (!currentUser || !currentUser.username) {
            throw new Error("Could not get current user.");
        }

        const collection = room.collection(COLLECTION_NAME);

        // Fetch existing player data for the current user
        const playerRecord = await new Promise(resolve => {
            const filter = collection.filter({ username: currentUser.username });
            let unsubscribe;
            const timeout = setTimeout(() => {
                if (unsubscribe) unsubscribe();
                const records = filter.getList();
                resolve(records.length > 0 ? records[0] : null);
            }, 2500);

            unsubscribe = filter.subscribe(records => {
                 if (records.length > 0) {
                    clearTimeout(timeout);
                    if (unsubscribe) unsubscribe();
                    resolve(records[0]);
                 }
            });
        });

        const newScoreEntry = {
            score: gameDataForDb.score,
            level: gameDataForDb.level,
            difficulty: gameDataForDb.difficulty,
            replayDataUrl: gameDataForDb.replayDataUrl,
            timestamp: gameDataForDb.timestamp,
        };

        if (playerRecord) {
            // Update existing record
            let scores = playerRecord.scores || [];
            scores.push(newScoreEntry);
            // Sort by score descending and keep the best ones
            scores.sort((a, b) => b.score - a.score);
            scores = scores.slice(0, MAX_SCORES_PER_USER);
            
            await collection.update(playerRecord.id, { scores: scores });
        } else {
            // Create new record
            await collection.create({
                // username is added automatically by websim
                scores: [newScoreEntry],
            });
        }
        
        if (onSuccess) onSuccess();
    } catch (error) {
        console.error("Error submitting score:", error);
        if (onError) onError(error);
    }
}

export async function fetchLeaderboard() {
    const allPlayerData = await new Promise(resolve => {
        const collection = room.collection(COLLECTION_NAME);
        let unsubscribe;
        
        const timeout = setTimeout(() => {
            if (unsubscribe) unsubscribe();
            resolve(collection.getList());
        }, 2500);

        unsubscribe = collection.subscribe(records => {
            clearTimeout(timeout);
            if (unsubscribe) unsubscribe();
            resolve(records);
        });
    });

    if (!allPlayerData || allPlayerData.length === 0) {
        return [];
    }

    const rankedPlayers = allPlayerData.map(playerData => {
        if (!playerData.scores || playerData.scores.length === 0) {
            return null;
        }

        const bestGame = playerData.scores.reduce((best, current) => {
            return (!best || current.score > best.score) ? current : best;
        }, null);
        
        return {
            username: playerData.username,
            highestScore: bestGame ? bestGame.score : 0,
            gamesPlayed: playerData.scores.length,
            bestGameData: bestGame,
            allScores: playerData.scores.sort((a,b) => b.score - a.score),
        };
    }).filter(p => p && p.bestGameData)
      .sort((a, b) => b.highestScore - a.highestScore);
    
    return rankedPlayers;
}

export function renderLeaderboard(rankedPlayers) {
    return rankedPlayers.map((player, index) => {
        const scoreListHtml = player.allScores.map((game, scoreIndex) => `
            <div class="score-entry">
                <div>
                    <span class="score-entry-score">Score: ${game.score}</span>
                    <small class="score-entry-date">${new Date(game.timestamp).toLocaleDateString()}</small>
                </div>
                <button class="watch-replay-btn" data-index="${index}" data-score-index="${scoreIndex}">Watch</button>
            </div>
        `).join('');

        return `
            <div class="leaderboard-entry-wrapper">
                <div class="leaderboard-entry" data-index="${index}">
                    <div class="rank">${index + 1}</div>
                    <img class="avatar" src="https://images.websim.com/avatar/${player.username}" alt="${player.username}'s avatar">
                    <div class="user-info">
                        <div class="username">${player.username}</div>
                        <div class="games-played">${player.gamesPlayed} ${player.gamesPlayed === 1 ? 'game' : 'games'}</div>
                    </div>
                    <div class="score">${player.highestScore}</div>
                    <button class="watch-replay-btn" data-index="${index}">Watch Best</button>
                </div>
                <div class="score-list-container hidden">
                    ${scoreListHtml}
                </div>
            </div>
        `
    }).join('');
}