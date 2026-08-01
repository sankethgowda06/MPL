// Global variables
let allPlayers = [];
let allTeams = [];
let currentPlayer = null;
let currentTeam = null;
let isPresentationMode = true;
let lastSoldInfo = null;
let lastBidReportUrl = null;
let isSubmittingBid = false;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    applyPresentationMode(false);
    loadPlayers();
    loadTeams();
    const searchInput = document.getElementById('player-search');
    if (searchInput) {
        searchInput.focus();
    }
});

function applyPresentationMode(enabled) {
    isPresentationMode = enabled;
    document.body.classList.toggle('presentation-mode', enabled);
    const btn = document.getElementById('presentation-toggle');
    if (btn) {
        btn.textContent = enabled ? 'Stage Mode: ON' : 'Stage Mode: OFF';
    }
}

function togglePresentationMode() {
    applyPresentationMode(!isPresentationMode);
}

function updateStageStrip() {
    const currentPlayerEl = document.getElementById('stage-current-player');
    const currentTeamEl = document.getElementById('stage-current-team');
    const lastSoldEl = document.getElementById('stage-last-sold');

    if (currentPlayerEl) {
        currentPlayerEl.textContent = currentPlayer
            ? `Now showing: #${currentPlayer.serial_number} ${currentPlayer.name} (${currentPlayer.role})`
            : 'No player selected';
    }

    if (currentTeamEl) {
        currentTeamEl.textContent = currentTeam
            ? `Bidding Team: ${currentTeam.name}`
            : 'Waiting for bid';
    }

    if (lastSoldEl) {
        lastSoldEl.textContent = lastSoldInfo
            ? `Last sold: ${lastSoldInfo.player} -> ${lastSoldInfo.team} (₹${Number(lastSoldInfo.price).toLocaleString()})`
            : 'Last sold: -';
    }
}

function runSoldAnimation(playerName, teamName, price, teamId) {
    const photoBox = document.getElementById('player-photo');
    const overlay = document.getElementById('sold-overlay');
    const soldTeamName = document.getElementById('sold-team-name');
    const soldPrice = document.getElementById('sold-price');

    if (soldTeamName) soldTeamName.textContent = `${playerName} to ${teamName}`;
    if (soldPrice) soldPrice.textContent = `₹${Number(price).toLocaleString()}`;

    if (photoBox) {
        photoBox.classList.remove('bid-flash');
        // reflow to restart animation
        void photoBox.offsetWidth;
        photoBox.classList.add('bid-flash');
    }

    const winnerCard = document.querySelector(`.team-compact-card[data-team-id="${teamId}"]`);
    if (winnerCard) {
        winnerCard.classList.remove('bid-winner');
        void winnerCard.offsetWidth;
        winnerCard.classList.add('bid-winner');
    }

    if (overlay) {
        overlay.classList.remove('hidden');
        setTimeout(() => {
            overlay.classList.add('hidden');
        }, 1800);
    }

    setTimeout(() => {
        if (winnerCard) winnerCard.classList.remove('bid-winner');
        if (photoBox) photoBox.classList.remove('bid-flash');
    }, 2000);
}

function renderPlayerPhoto(player) {
    const photoBox = document.getElementById('player-photo');
    if (!photoBox) return;

    const photoMarkup = player && player.photo_url
        ? `<img src="${player.photo_url}" alt="${player.name}">`
        : '<div class="photo-placeholder">📷</div>';

    photoBox.innerHTML = `
        ${photoMarkup}
        <div id="sold-overlay" class="sold-overlay hidden">
            <div class="sold-stamp">SOLD</div>
            <div id="sold-team-name" class="sold-team-name"></div>
            <div id="sold-price" class="sold-price"></div>
        </div>
    `;
}

function getSaleInfoForPlayer(playerId) {
    for (const team of allTeams) {
        if (!team.players || !Array.isArray(team.players)) {
            continue;
        }

        const soldEntry = team.players.find(p => Number(p.id) === Number(playerId));
        if (soldEntry) {
            return {
                teamName: team.name,
                price: soldEntry.price
            };
        }
    }

    return null;
}

function showSoldOverlayOnPhoto(playerName, saleInfo) {
    const overlay = document.getElementById('sold-overlay');
    const soldTeamName = document.getElementById('sold-team-name');
    const soldPrice = document.getElementById('sold-price');

    if (!overlay || !soldTeamName || !soldPrice) {
        return;
    }

    if (saleInfo && saleInfo.teamName) {
        soldTeamName.textContent = `${playerName} to ${saleInfo.teamName}`;
        soldPrice.textContent = saleInfo.price ? `₹${Number(saleInfo.price).toLocaleString()}` : 'Already Sold';
    } else {
        soldTeamName.textContent = playerName;
        soldPrice.textContent = 'Already Sold';
    }

    overlay.classList.remove('hidden');
}

// Full player list so search by jersey # works even for already-auctioned players
async function loadPlayers() {
    try {
        const response = await fetch('/api/players');
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
    const asNum = parseInt(searchInput, 10);

    // Try jersey / list serial first when input looks numeric (avoid strict === type mismatches)
    if (!Number.isNaN(asNum) && Number.isFinite(asNum)) {
        player = allPlayers.find(p => Number(p.serial_number) === asNum);
    }

    if (!player) {
        player = allPlayers.find(p => (p.name && p.name.toLowerCase().includes(searchInput)));
    }

    if (!player) {
        showNotification('No player with that number or name. Check the serial on the Dashboard Players tab.', 'error');
        const bannerMiss = document.getElementById('player-sold-notice');
        if (bannerMiss) bannerMiss.classList.add('hidden');
        document.getElementById('player-info').classList.add('hidden');
        document.getElementById('player-placeholder').style.display = 'block';
        renderPlayerPhoto(null);
        currentPlayer = null;
        renderTeamsGrid();
        updateStageStrip();
        return;
    }

    currentPlayer = player;
    displayPlayerDetails();
    renderTeamsGrid();
    updateStageStrip();
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

    const soldBanner = document.getElementById('player-sold-notice');
    if (soldBanner) {
        if (currentPlayer.is_available === false) {
            soldBanner.textContent = 'This player is already on a team. Use Team View to remove them from that team, or Clear all bids to reset the whole auction.';
            soldBanner.classList.remove('hidden');
        } else {
            soldBanner.classList.add('hidden');
        }
    }

    // Show player info and hide placeholder
    document.getElementById('player-info').classList.remove('hidden');
    document.getElementById('player-placeholder').style.display = 'none';

    // Show player photo
    renderPlayerPhoto(currentPlayer);

    // If this player is already sold, keep SOLD overlay visible on photo.
    if (currentPlayer.is_available === false) {
        const saleInfo = getSaleInfoForPlayer(currentPlayer.id);
        showSoldOverlayOnPhoto(currentPlayer.name, saleInfo);
    }
}

// Render teams grid
function renderTeamsGrid() {
    const teamsGrid = document.getElementById('teams-grid');
    teamsGrid.innerHTML = '';

    allTeams.forEach(team => {
        const teamNameSafe = (team.name || '').replace(/'/g, "\\'");
        const budgetUsed = team.total_spent;
        const budgetRemaining = team.budget - budgetUsed;
        const canBid = currentPlayer && currentPlayer.is_available !== false && budgetRemaining >= 1000;
        const budgetCritical = budgetRemaining < 10000;

        const teamCard = `
            <div class="team-compact-card ${!canBid ? 'disabled' : ''}" data-team-id="${team.id}" ${canBid ? `onclick="openBidModal(${team.id}, '${teamNameSafe}', ${budgetRemaining})"` : ''}>
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
                    <button class="bid-btn-compact" onclick="openBidModal(${team.id}, '${teamNameSafe}', ${budgetRemaining})">
                        💰 Bid ${(budgetRemaining / 1000).toFixed(0)}K max
                    </button>
                ` : `
                    <button class="bid-btn-compact" disabled>
                        ${!currentPlayer ? '⚠ Select Player' : (currentPlayer.is_available === false ? '⚠ Already on a team' : '❌ No Budget')}
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
    updateStageStrip();

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
    if (isSubmittingBid) {
        return;
    }

    document.getElementById('bid-modal').classList.add('hidden');
    document.getElementById('bid-error').classList.add('hidden');
}

function setBidSubmittingState(submitting) {
    isSubmittingBid = submitting;

    const confirmButton = document.getElementById('confirm-bid-btn');
    const cancelButton = document.getElementById('cancel-bid-btn');
    const bidAmountInput = document.getElementById('bid-amount');

    if (confirmButton) {
        confirmButton.disabled = submitting;
        confirmButton.textContent = submitting ? 'Processing...' : '✓ Confirm Bid';
    }

    if (cancelButton) {
        cancelButton.disabled = submitting;
    }

    if (bidAmountInput) {
        bidAmountInput.disabled = submitting;
    }
}

// Handle Enter key on search
function handleEnter(event) {
    if (event.key === 'Enter') {
        fetchPlayerByNumber();
    }
}

function triggerPdfDownload(url) {
    if (!url) {
        return;
    }

    const link = document.createElement('a');
    link.href = url;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function updateReportButtons() {
    const lastBidBtn = document.getElementById('download-last-bid-btn');
    if (lastBidBtn) {
        lastBidBtn.disabled = !lastBidReportUrl;
    }
}

function downloadLastBidReport() {
    if (!lastBidReportUrl) {
        showNotification('No completed bid report available yet', 'error');
        return;
    }

    triggerPdfDownload(lastBidReportUrl);
}

function downloadTeamReport() {
    triggerPdfDownload('/api/export/team-report-pdf');
}

// Confirm bid
async function confirmBid() {
    if (isSubmittingBid) {
        return;
    }

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

    setBidSubmittingState(true);
    errorDiv.classList.add('hidden');

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
            document.getElementById('bid-modal').classList.add('hidden');
            lastBidReportUrl = data.bid_report_pdf_url || null;
            updateReportButtons();

            currentPlayer.is_available = false;
            currentTeam.total_spent = (currentTeam.total_spent || 0) + bidAmount;
            currentTeam.players_count = (currentTeam.players_count || 0) + 1;

            lastSoldInfo = {
                player: currentPlayer.name,
                team: currentTeam.name,
                price: bidAmount,
            };

            renderTeamsGrid();
            displayPlayerDetails();
            runSoldAnimation(currentPlayer.name, currentTeam.name, bidAmount, currentTeam.id);
            updateStageStrip();
            showNotification(`✓ ${currentPlayer.name} sold to ${currentTeam.name} for ₹${bidAmount.toLocaleString()}! Report ready in Last Bid PDF.`, 'success');

            // Refresh data after 1 second
            setTimeout(() => {
                loadPlayers();
                loadTeams();
                const searchEl = document.getElementById('player-search');
                if (searchEl) searchEl.value = '';
                document.getElementById('player-info').classList.add('hidden');
                document.getElementById('player-placeholder').style.display = 'block';
                renderPlayerPhoto(null);
                currentPlayer = null;
                currentTeam = null;
                updateStageStrip();
            }, 1000);
        } else {
            errorDiv.textContent = data.error || 'Error processing bid';
            errorDiv.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error confirming bid:', error);
        errorDiv.textContent = 'Error processing bid. Please try again.';
        errorDiv.classList.remove('hidden');
    } finally {
        setBidSubmittingState(false);
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
    loadPlayers();
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

async function syncAuctionAvailability() {
    try {
        const response = await fetch('/api/auction/sync-availability', { method: 'POST' });
        const data = await response.json();

        if (response.ok) {
            showNotification(data.message || 'Synced', 'success');
            await loadPlayers();
            renderTeamsGrid();
            if (currentPlayer) {
                const refreshed = allPlayers.find(p => p.id === currentPlayer.id);
                if (refreshed) {
                    currentPlayer = refreshed;
                    displayPlayerDetails();
                }
            }
        } else {
            showNotification(data.error || 'Could not sync', 'error');
        }
    } catch (error) {
        console.error('Sync availability error:', error);
        showNotification('Error syncing player pool', 'error');
    }
}

async function resetAuction() {
    if (!confirm('Clear ALL bids and viewer history? Every player returns to the auction pool. Teams stay — only rosters are emptied.')) {
        return;
    }

    try {
        const response = await fetch('/api/auction/reset', { method: 'POST' });
        const data = await response.json();

        if (response.ok) {
            showNotification(data.message || 'Auction reset', 'success');
            currentPlayer = null;
            const searchEl = document.getElementById('player-search');
            if (searchEl) searchEl.value = '';
            document.getElementById('player-info').classList.add('hidden');
            const banner = document.getElementById('player-sold-notice');
            if (banner) {
                banner.classList.add('hidden');
                banner.textContent = '';
            }
            document.getElementById('player-placeholder').style.display = 'block';
            renderPlayerPhoto(null);
            await loadPlayers();
            await loadTeams();
            renderTeamsGrid();
            loadTeamPlayers();
            currentTeam = null;
            updateStageStrip();
        } else {
            showNotification(data.error || 'Could not reset auction', 'error');
        }
    } catch (error) {
        console.error('Reset auction error:', error);
        showNotification('Error resetting auction', 'error');
    }
}
