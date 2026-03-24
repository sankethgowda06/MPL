// Global variables
let allPlayers = [];
let allTeams = [];
let currentPlayer = null;
let currentTeam = null;
let currentBidAmount = 0;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadPlayers();
    loadTeams();
});

// Load all available players
async function loadPlayers() {
    try {
        const response = await fetch('/api/players?available=true');
        allPlayers = await response.json();

        const select = document.getElementById('players-select');
        select.innerHTML = '<option value="">-- Select a Player --</option>';

        allPlayers.forEach(player => {
            const option = document.createElement('option');
            option.value = player.id;
            option.textContent = `#${player.serial_number} - ${player.name} (${player.role})`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading players:', error);
        showNotification('Error loading players', 'error');
    }
}

// Load all teams
async function loadTeams() {
    try {
        const response = await fetch('/api/teams');
        allTeams = await response.json();

        renderTeamsGrid();
    } catch (error) {
        console.error('Error loading teams:', error);
        showNotification('Error loading teams', 'error');
    }
}

// Search player
function searchPlayer() {
    const searchInput = document.getElementById('search-input').value.trim().toLowerCase();
    
    if (!searchInput) {
        showNotification('Please enter a player number or name', 'error');
        return;
    }

    const player = allPlayers.find(p => 
        p.serial_number.toString() === searchInput || 
        p.name.toLowerCase().includes(searchInput)
    );

    if (player) {
        document.getElementById('players-select').value = player.id;
        selectPlayer();
    } else {
        showNotification('Player not found', 'error');
    }
}

// Select player from dropdown
function selectPlayer() {
    const select = document.getElementById('players-select');
    const playerId = select.value;

    if (!playerId) {
        document.getElementById('player-details').innerHTML = '<div class="placeholder"><p>Select a player to view details and bid</p></div>';
        document.getElementById('player-photo').innerHTML = '<div class="photo-placeholder">📷</div>';
        currentPlayer = null;
        return;
    }

    currentPlayer = allPlayers.find(p => p.id == playerId);
    displayPlayerDetails();
}

// Display player details
function displayPlayerDetails() {
    if (!currentPlayer) return;

    // Player details
    const detailsHTML = `
        <div class="player-info-content">
            <div class="player-info-row">
                <span class="label">Serial Number:</span>
                <span class="value">#${currentPlayer.serial_number}</span>
            </div>
            <div class="player-info-row">
                <span class="label">Player Name:</span>
                <span class="value">${currentPlayer.name}</span>
            </div>
            <div class="player-info-row">
                <span class="label">Role:</span>
                <span class="value">${currentPlayer.role}</span>
            </div>
            <div class="player-base-points">
                <span class="label">Base Bidding Points</span>
                <span class="value">₹1000</span>
            </div>
        </div>
    `;

    document.getElementById('player-details').innerHTML = detailsHTML;

    // Player photo
    if (currentPlayer.photo_url) {
        document.getElementById('player-photo').innerHTML = `<img src="${currentPlayer.photo_url}" alt="${currentPlayer.name}">`;
    } else {
        document.getElementById('player-photo').innerHTML = '<div class="photo-placeholder">📷</div>';
    }
}

// Render teams grid
function renderTeamsGrid() {
    const teamsGrid = document.getElementById('teams-grid');
    teamsGrid.innerHTML = '';

    allTeams.forEach(team => {
        const budgetUsed = team.total_spent;
        const budgetRemaining = team.budget - budgetUsed;
        const canBid = currentPlayer && budgetRemaining >= 1000;
        const budgetCritical = budgetRemaining < 10000;

        const teamCard = `
            <div class="team-bid-card ${!canBid ? 'disabled' : ''}" ${canBid ? `onclick="openBidModal(${team.id}, '${team.name}', ${budgetRemaining})"` : ''}>
                <div class="team-header">
                    <div class="team-name">${team.name}</div>
                    <div class="team-owner">Owner: ${team.owner || 'N/A'}</div>
                </div>

                <div class="team-stats">
                    <div class="stat-item">
                        <span class="stat-label">Players Added:</span>
                        <span class="stat-value">${team.players_count}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Budget Used:</span>
                        <span class="stat-value">₹${budgetUsed.toLocaleString()}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Remaining Budget:</span>
                        <span class="stat-value ${budgetCritical ? 'critical' : ''}">₹${budgetRemaining.toLocaleString()}</span>
                    </div>
                </div>

                ${canBid ? `
                    <button class="bid-button" onclick="openBidModal(${team.id}, '${team.name}', ${budgetRemaining})">
                        💰 Bid for this Player
                    </button>
                ` : `
                    <button class="bid-button" disabled>
                        ${!currentPlayer ? '⚠ Select Player First' : '❌ Insufficient Budget'}
                    </button>
                `}
            </div>
        `;

        teamsGrid.innerHTML += teamCard;
    });
}

// Open bid modal
function openBidModal(teamId, teamName, budgetRemaining) {
    if (!currentPlayer) {
        showNotification('Please select a player first', 'error');
        return;
    }

    currentTeam = allTeams.find(t => t.id === teamId);

    document.getElementById('bid-player-name').textContent = currentPlayer.name;
    document.getElementById('bid-base-price').textContent = '₹1000';
    document.getElementById('bid-team-name').textContent = teamName;
    document.getElementById('bid-team-budget').textContent = `₹${budgetRemaining.toLocaleString()}`;
    document.getElementById('bid-amount').value = 1000;
    document.getElementById('bid-amount').max = budgetRemaining;
    document.getElementById('bid-error').classList.add('hidden');

    document.getElementById('bid-modal').classList.remove('hidden');
}

// Close bid modal
function closeBidModal() {
    document.getElementById('bid-modal').classList.add('hidden');
    document.getElementById('bid-error').classList.add('hidden');
}

// Confirm bid
async function confirmBid() {
    if (!currentPlayer || !currentTeam) {
        showNotification('Error: Invalid selection', 'error');
        return;
    }

    const bidAmount = parseInt(document.getElementById('bid-amount').value);
    const budgetRemaining = currentTeam.budget - currentTeam.total_spent;
    const errorDiv = document.getElementById('bid-error');

    // Validation
    if (isNaN(bidAmount) || bidAmount < 1000) {
        errorDiv.textContent = 'Bid amount must be at least 1000';
        errorDiv.classList.remove('hidden');
        return;
    }

    if (bidAmount > budgetRemaining) {
        errorDiv.textContent = `Bid amount exceeds remaining budget (₹${budgetRemaining.toLocaleString()})`;
        errorDiv.classList.remove('hidden');
        return;
    }

    try {
        const response = await fetch('/api/auction', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                team_id: currentTeam.id,
                player_id: currentPlayer.id,
                price: bidAmount
            })
        });

        const data = await response.json();

        if (response.ok) {
            closeBidModal();
            showNotification(`✓ ${currentPlayer.name} added to ${currentTeam.name} for ₹${bidAmount.toLocaleString()}`, 'success');
            
            // Refresh data
            setTimeout(() => {
                loadPlayers();
                loadTeams();
                document.getElementById('players-select').value = '';
                document.getElementById('player-details').innerHTML = '<div class="placeholder"><p>Select a player to view details and bid</p></div>';
                document.getElementById('player-photo').innerHTML = '<div class="photo-placeholder">📷</div>';
                currentPlayer = null;
            }, 1000);
        } else {
            errorDiv.textContent = data.error || 'Error processing bid';
            errorDiv.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error confirming bid:', error);
        errorDiv.textContent = 'Error processing bid. Please try again.';
        errorDiv.classList.remove('hidden');
    }
}

// Show notification
function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.remove('hidden');

    setTimeout(() => {
        notification.classList.add('hidden');
    }, 3000);
}

// Listen for Enter key on search
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchPlayer();
            }
        });
    }
});
