// Global variables
let allPlayers = [];
let allTeams = [];
let currentPlayer = null;
let currentTeam = null;

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

// Search player by number or name
async function searchPlayer() {
    const searchInput = document.getElementById('player-search').value.trim().toLowerCase();

    if (!searchInput) {
        showNotification('Please enter a player number or name', 'error');
        return;
    }

    let player = null;

    // Try to find by serial number first (if input is a number)
    if (!isNaN(searchInput)) {
        player = allPlayers.find(p => p.serial_number === parseInt(searchInput));
    }

    // If not found by number, try by name (partial match)
    if (!player) {
        player = allPlayers.find(p => p.name.toLowerCase().includes(searchInput));
    }

    if (!player) {
        showNotification('Player not found', 'error');
        document.getElementById('player-info').classList.add('hidden');
        document.getElementById('player-placeholder').style.display = 'block';
        document.getElementById('player-photo').innerHTML = '<div class="photo-placeholder">📷</div>';
        currentPlayer = null;
        renderTeamsGrid();
        return;
    }

    currentPlayer = player;
    displayPlayerDetails();
    renderTeamsGrid();
}

// Fetch player by serial number (legacy - kept for backward compatibility)
async function fetchPlayerByNumber() {
    searchPlayer();
}

// Display player details
function displayPlayerDetails() {
    if (!currentPlayer) return;

    document.getElementById('player-name').textContent = currentPlayer.name;
    document.getElementById('player-role').textContent = currentPlayer.role;
    document.getElementById('player-serial').textContent = `#${currentPlayer.serial_number}`;

    // Show player info and hide placeholder
    document.getElementById('player-info').classList.remove('hidden');
    document.getElementById('player-placeholder').style.display = 'none';

    // Show player photo
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
            <div class="team-compact-card ${!canBid ? 'disabled' : ''}" ${canBid ? `onclick="openBidModal(${team.id}, '${team.name}', ${budgetRemaining})"` : ''}>
                <div class="team-name-compact">
                    ${team.name}
                    <span class="team-owner-badge">${team.owner}</span>
                </div>

                <div class="team-stats-compact">
                    <div class="stat-compact">
                        <div class="stat-label-compact">Players:</div>
                        <div class="stat-value-compact">${team.players_count}</div>
                    </div>
                    <div class="stat-compact">
                        <div class="stat-label-compact">Used:</div>
                        <div class="stat-value-compact">₹${(budgetUsed / 1000).toFixed(0)}K</div>
                    </div>
                </div>

                <div class="team-stats-compact" style="margin-top: 6px;">
                    <div class="stat-compact" style="grid-column: 1 / -1;">
                        <div class="stat-label-compact">Budget Left:</div>
                        <div class="stat-value-compact ${budgetCritical ? 'critical' : ''}">₹${(budgetRemaining / 1000).toFixed(0)}K</div>
                    </div>
                </div>

                ${canBid ? `
                    <button class="bid-btn-compact" onclick="openBidModal(${team.id}, '${team.name}', ${budgetRemaining})">
                        💰 Bid ${(budgetRemaining / 1000).toFixed(0)}K max
                    </button>
                ` : `
                    <button class="bid-btn-compact" disabled>
                        ${!currentPlayer ? '⚠ Select Player' : '❌ No Budget'}
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
    document.getElementById('bid-team-name').textContent = teamName;
    document.getElementById('bid-budget').textContent = `₹${budgetRemaining.toLocaleString()}`;
    document.getElementById('bid-amount').value = 1000;
    document.getElementById('bid-amount').max = budgetRemaining;
    document.getElementById('bid-error').classList.add('hidden');

    document.getElementById('bid-modal').classList.remove('hidden');
    document.getElementById('bid-amount').focus();
}

// Close bid modal
function closeBidModal() {
    document.getElementById('bid-modal').classList.add('hidden');
    document.getElementById('bid-error').classList.add('hidden');
}

// Handle Enter key on search
function handleEnter(event) {
    if (event.key === 'Enter') {
        fetchPlayerByNumber();
    }
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
        errorDiv.textContent = `Bid exceeds budget (Max: ₹${budgetRemaining.toLocaleString()})`;
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
            showNotification(`✓ ${currentPlayer.name} sold to ${currentTeam.name} for ₹${bidAmount.toLocaleString()}!`, 'success');

            // Refresh data after 1 second
            setTimeout(() => {
                loadPlayers();
                loadTeams();
                document.getElementById('player-number').value = '';
                document.getElementById('player-info').classList.add('hidden');
                document.getElementById('player-placeholder').style.display = 'block';
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

// Auto-refresh teams every 2 seconds
setInterval(() => {
    loadTeams();
    // Also refresh team selector options
    updateTeamSelector();
}, 2000);

// Switch between views
function switchView(view) {
    // Hide all views
    document.getElementById('bidding-view').classList.remove('active');
    document.getElementById('team-view').classList.remove('active');

    // Remove active class from all tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected view
    if (view === 'bidding') {
        document.getElementById('bidding-view').classList.add('active');
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
    } else if (view === 'team-view') {
        document.getElementById('team-view').classList.add('active');
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
        updateTeamSelector();
        if (allTeams.length > 0) {
            document.getElementById('team-selector').value = allTeams[0].id;
            loadTeamPlayers();
        }
    }
}

// Update team selector dropdown
function updateTeamSelector() {
    const selector = document.getElementById('team-selector');
    const currentValue = selector.value;

    // Store existing options except the placeholder
    const options = [];
    selector.querySelectorAll('option').forEach(opt => {
        if (opt.value) {
            options.push(opt);
        }
    });

    // Clear all options except placeholder
    while (selector.options.length > 1) {
        selector.remove(1);
    }

    // Re-add team options
    allTeams.forEach(team => {
        const option = document.createElement('option');
        option.value = team.id;
        option.textContent = `${team.name} (${team.players_count} players, ₹${((team.budget - team.total_spent) / 1000).toFixed(0)}K left)`;
        selector.appendChild(option);
    });

    // Restore previous selection if still available
    if (currentValue && Array.from(selector.options).some(opt => opt.value == currentValue)) {
        selector.value = currentValue;
    }
}

// Load and display team players
function loadTeamPlayers() {
    const teamId = parseInt(document.getElementById('team-selector').value);

    if (!teamId) {
        document.getElementById('team-players-list').innerHTML = '<div class="team-players-empty">Select a team to view players</div>';
        return;
    }

    const team = allTeams.find(t => t.id === teamId);

    if (!team || !team.players || team.players.length === 0) {
        document.getElementById('team-players-list').innerHTML = '<div class="team-players-empty">No players bidded for this team yet</div>';
        return;
    }

    // Display team players
    const playersList = team.players
        .map((player, index) => `
            <div class="team-player-card">
                <div class="team-player-info">
                    <div class="team-player-name">#${player.serial_number} - ${player.name}</div>
                    <div class="team-player-role">${player.role}</div>
                </div>
                <div class="team-player-price">₹${player.price.toLocaleString()}</div>
                <button class="remove-player-btn" onclick="removePlayerFromTeam(${team.id}, ${player.id}, '${player.name}')">🗑️ Remove</button>
            </div>
        `)
        .join('');

    document.getElementById('team-players-list').innerHTML = playersList;
}

// Remove player from team
async function removePlayerFromTeam(teamId, playerId, playerName) {
    if (!confirm(`Remove ${playerName} from this team? The budget will be refunded.`)) {
        return;
    }

    try {
        const response = await fetch(`/api/auction/${teamId}/${playerId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showNotification(`${playerName} removed successfully. Budget refunded!`, 'success');
            // Reload teams and update display
            loadTeams();
            loadPlayers();
            loadTeamPlayers();
        } else {
            const data = await response.json();
            showNotification(data.error || 'Error removing player', 'error');
        }
    } catch (error) {
        console.error('Error removing player:', error);
        showNotification('Error removing player', 'error');
    }
}
