// Tab Navigation
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const tabName = e.target.dataset.tab;
        switchTab(tabName);
    });
});

function switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });

    // Remove active class from nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected tab
    document.getElementById(tabName).classList.add('active');
    event.target.classList.add('active');

    // Refresh data when switching tabs
    if (tabName === 'dashboard') {
        loadDashboard();
    } else if (tabName === 'teams') {
        loadTeams();
    } else if (tabName === 'auction') {
        loadAuctionData();
    } else if (tabName === 'players') {
        loadPlayers();
    }
}

// ===== DASHBOARD =====
async function loadDashboard() {
    try {
        const response = await fetch('/api/dashboard');
        const data = await response.json();

        document.getElementById('total-players').textContent = data.total_players;
        document.getElementById('available-players').textContent = data.available_players;
        document.getElementById('auctioned-players').textContent = data.auctioned_players;
        document.getElementById('active-teams').textContent = data.teams.length;

        const tbody = document.getElementById('dashboard-teams');
        tbody.innerHTML = '';
        data.teams.forEach(team => {
            const row = `
                <tr>
                    <td><strong>${team.name}</strong></td>
                    <td>${team.players}</td>
                    <td>₹${team.spent.toLocaleString()}</td>
                    <td><span style="color: ${team.available < 10000 ? '#dc2626' : '#16a34a'}">₹${team.available.toLocaleString()}</span></td>
                </tr>
            `;
            tbody.innerHTML += row;
        });
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

// ===== TEAMS =====
async function loadTeams() {
    try {
        const response = await fetch('/api/teams');
        const teams = await response.json();

        const container = document.getElementById('teams-list');
        container.innerHTML = '';

        teams.forEach(team => {
            const budgetUsed = team.total_spent;
            const budgetPercentage = (budgetUsed / team.budget) * 100;
            const logoHtml = team.logo_url
                ? `<img src="${team.logo_url}" alt="${team.name} logo" class="team-logo-img">`
                : `<div class="team-logo-placeholder">🏏</div>`;

            const teamCard = `
                <div class="team-card">
                    <div class="team-logo-row">
                        <div class="team-logo-wrap">${logoHtml}</div>
                        <div>
                            <input type="file" id="team-logo-input-${team.id}" class="hidden-file-input" accept="image/*" onchange="uploadTeamLogo(${team.id}, this)">
                            <button class="btn btn-primary btn-sm" onclick="triggerTeamLogoUpload(${team.id})">Update Logo</button>
                        </div>
                    </div>
                    <h3>${team.name}</h3>
                    <div class="team-stat">
                        <label>Total Budget:</label>
                        <span class="value">₹${team.budget.toLocaleString()}</span>
                    </div>
                    <div class="team-stat">
                        <label>Spent:</label>
                        <span class="value">₹${budgetUsed.toLocaleString()}</span>
                    </div>
                    <div class="team-stat">
                        <label>Available:</label>
                        <span class="value" style="color: ${team.available_budget < 10000 ? '#dc2626' : '#16a34a'}">
                            ₹${team.available_budget.toLocaleString()}
                        </span>
                    </div>
                    <div class="team-stat">
                        <label>Players:</label>
                        <span class="value">${team.players_count}/15</span>
                    </div>
                    <div style="margin-top: 15px; background: #e5e7eb; height: 8px; border-radius: 4px; overflow: hidden;">
                        <div style="height: 100%; width: ${Math.min(budgetPercentage, 100)}%; background: linear-gradient(90deg, #16a34a, #ea580c);"></div>
                    </div>
                    <div class="team-actions">
                        <button class="btn btn-primary" onclick="viewTeamRoster(${team.id})">View Roster</button>
                        <button class="btn btn-danger" onclick="deleteTeam(${team.id})">Delete</button>
                    </div>
                </div>
            `;
            container.innerHTML += teamCard;
        });

        // Update team dropdown in auction tab
        updateTeamDropdown(teams);
    } catch (error) {
        console.error('Error loading teams:', error);
    }
}

async function createTeam() {
    const nameEl = document.getElementById('team-name');
    const ownerEl = document.getElementById('team-owner');
    const name = (nameEl && nameEl.value) ? nameEl.value.trim() : '';
    const owner = (ownerEl && ownerEl.value) ? ownerEl.value.trim() : '';

    if (!name) {
        alert('Please enter a team name');
        return;
    }

    try {
        const response = await fetch('/api/teams', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, owner: owner || 'N/A' })
        });

        if (response.ok) {
            if (nameEl) nameEl.value = '';
            if (ownerEl) ownerEl.value = '';
            showFeedback('Team created successfully!', 'success', 'teams');
            loadTeams();
            loadDashboard();
        } else {
            const error = await response.json();
            showFeedback(error.error || 'Error creating team', 'error', 'teams');
        }
    } catch (error) {
        console.error('Error:', error);
        showFeedback('Error creating team', 'error', 'teams');
    }
}

async function deleteTeam(teamId) {
    if (!confirm('Are you sure you want to delete this team?')) return;

    try {
        const response = await fetch(`/api/teams/${teamId}`, { method: 'DELETE' });

        if (response.ok) {
            loadTeams();
            loadDashboard();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function viewTeamRoster(teamId) {
    try {
        const response = await fetch(`/api/teams/${teamId}`);
        const team = await response.json();

        let html = `<h3>${team.name} - Roster</h3>`;
        html += `<p>Budget: ₹${team.budget.toLocaleString()} | Spent: ₹${team.total_spent.toLocaleString()} | Available: ₹${team.available_budget.toLocaleString()}</p>`;

        if (team.players.length === 0) {
            html += '<p>No players in this team yet.</p>';
        } else {
            html += '<table class="table"><thead><tr><th>Player Name</th><th>Role</th><th>Price</th><th>Action</th></tr></thead><tbody>';
            team.players.forEach(auctioned => {
                html += `
                    <tr>
                        <td>${auctioned.player.name}</td>
                        <td>${auctioned.player.role}</td>
                        <td>₹${auctioned.price.toLocaleString()}</td>
                        <td><button class="btn btn-danger" onclick="removePlayerFromTeam(${auctioned.id})">Remove</button></td>
                    </tr>
                `;
            });
            html += '</tbody></table>';
        }

        alert(html);
    } catch (error) {
        console.error('Error:', error);
    }
}

function updateTeamDropdown(teams) {
    const select = document.getElementById('auction-team');
    const currentValue = select.value;

    select.innerHTML = '<option value="">-- Select Team --</option>';
    teams.forEach(team => {
        select.innerHTML += `<option value="${team.id}">${team.name} (Available: ₹${team.available_budget.toLocaleString()})</option>`;
    });

    if (currentValue) select.value = currentValue;
}

// ===== PLAYERS =====
async function loadPlayers() {
    try {
        const response = await fetch('/api/players');
        const players = await response.json();
        players.sort((a, b) => a.serial_number - b.serial_number);

        const container = document.getElementById('players-list');
        container.innerHTML = '';

        if (players.length === 0) {
            container.innerHTML = '<p style="grid-column: 1/-1; text-align: center;">No players found. Add a player above or run <code>sync_players_from_ppt.py</code> / <code>add_players_to_db.py</code>.</p>';
            return;
        }

        players.forEach(player => {
            const photoHtml = player.photo_url ? 
                `<img src="${player.photo_url}" alt="${player.name}" class="player-photo" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22150%22%3E%3Crect fill=%22%23ccc%22 width=%22120%22 height=%22150%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2224%22 fill=%22%23999%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22%3E🏏%3C/text%3E%3C/svg%3E'">` : 
                '<div class="player-avatar">🏏</div>';
            
            const playerCard = `
                <div class="player-card">
                    <div class="player-image-container">
                        ${photoHtml}
                    </div>
                    <div class="player-info">
                        <div class="player-serial">#${player.serial_number}</div>
                        <div class="player-name">${player.name}</div>
                        <div class="player-role">${player.role}</div>
                        <div class="player-actions">
                            <input type="file" id="player-photo-input-${player.id}" class="hidden-file-input" accept="image/*" onchange="uploadPlayerPhoto(${player.id}, this)">
                            <button class="btn btn-primary btn-sm" onclick="triggerPlayerPhotoUpload(${player.id})">Update Photo</button>
                            <button class="btn btn-danger btn-sm" onclick="deletePlayer(${player.id})">Delete</button>
                        </div>
                    </div>
                </div>
            `;
            container.innerHTML += playerCard;
        });

        // Update player dropdown in auction tab
        updatePlayerDropdown(players);
    } catch (error) {
        console.error('Error loading players:', error);
    }
}

async function addPlayerManual() {
    const serialEl = document.getElementById('player-serial');
    const nameEl = document.getElementById('player-add-name');
    const roleEl = document.getElementById('player-add-role');

    const serial = serialEl && serialEl.value !== '' ? parseInt(serialEl.value, 10) : NaN;
    const name = nameEl ? nameEl.value.trim() : '';
    const role = roleEl ? roleEl.value.trim() : '';

    if (!Number.isInteger(serial) || serial < 1) {
        showFeedback('Enter a valid serial number (whole number ≥ 1).', 'error', 'players');
        return;
    }
    if (!name) {
        showFeedback('Enter the player name.', 'error', 'players');
        return;
    }

    try {
        const response = await fetch('/api/players', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                serial_number: serial,
                name,
                role: role || 'Unknown'
            })
        });

        const result = await parseJsonResponse(response);

        if (response.ok) {
            showFeedback(`✓ ${result.message}`, 'success', 'players');
            if (nameEl) nameEl.value = '';
            if (roleEl) roleEl.value = '';
            if (serialEl) serialEl.value = '';
            loadPlayers();
            loadDashboard();
        } else {
            showFeedback(result.error || 'Could not add player', 'error', 'players');
        }
    } catch (error) {
        console.error('Error:', error);
        showFeedback(error.message || 'Error adding player', 'error', 'players');
    }
}

async function deletePlayer(playerId) {
    if (!confirm('Are you sure you want to delete this player?')) return;

    try {
        const response = await fetch(`/api/players/${playerId}`, { method: 'DELETE' });
        if (response.ok) {
            loadPlayers();
            loadDashboard();
        } else {
            const result = await parseJsonResponse(response);
            showFeedback(result.error || 'Error deleting player', 'error', 'players');
        }
    } catch (error) {
        console.error('Error:', error);
        showFeedback('Error deleting player', 'error', 'players');
    }
}

function updatePlayerDropdown(players) {
    const select = document.getElementById('auction-player');
    const currentValue = select.value;
    const sortedPlayers = [...players].sort((a, b) => a.serial_number - b.serial_number);

    select.innerHTML = '<option value="">-- Select Player --</option>';
    sortedPlayers.forEach(player => {
        select.innerHTML += `<option value="${player.id}">${player.name} (${player.role})</option>`;
    });

    if (currentValue) select.value = currentValue;
}

// ===== AUCTION =====
async function loadAuctionData() {
    await loadTeams();
    await loadPlayers();
}

async function auctionPlayer() {
    const teamId = document.getElementById('auction-team').value;
    const playerId = document.getElementById('auction-player').value;
    const price = parseInt(document.getElementById('auction-price').value);

    if (!teamId || !playerId) {
        showFeedback('Please select team and player', 'error', 'auction');
        return;
    }

    if (price < 1000) {
        showFeedback('Minimum bid price is 1000', 'error', 'auction');
        return;
    }

    try {
        const response = await fetch('/api/auction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ team_id: teamId, player_id: playerId, price })
        });

        const result = await response.json();

        if (response.ok) {
            showFeedback(result.message, 'success', 'auction');

            // Reset form
            document.getElementById('auction-player').value = '';
            document.getElementById('auction-price').value = '1000';

            loadAuctionData();
        } else {
            showFeedback(result.error || 'Error in auction', 'error', 'auction');
        }
    } catch (error) {
        console.error('Error:', error);
        showFeedback('Error processing auction', 'error', 'auction');
    }
}

async function removePlayerFromTeam(auctionId) {
    if (!confirm('Remove this player from team?')) return;

    try {
        const response = await fetch(`/api/auction/${auctionId}`, { method: 'DELETE' });

        if (response.ok) {
            loadAuctionData();
            loadDashboard();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// ===== EXPORT =====
function exportData() {
    window.location.href = '/api/export';
}

// ===== UTILITIES =====
function showFeedback(message, type, container) {
    const feedback = document.querySelector(`#${container} .feedback`) || document.querySelector('.feedback');
    if (feedback) {
        feedback.textContent = message;
        feedback.className = `feedback ${type}`;
    }
}

async function parseJsonResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return response.json();
    }

    const text = await response.text();
    const shortText = text ? text.slice(0, 120) : 'No response body';
    throw new Error(`Server returned non-JSON response (${response.status}): ${shortText}`);
}

function triggerTeamLogoUpload(teamId) {
    const input = document.getElementById(`team-logo-input-${teamId}`);
    if (input) input.click();
}

async function uploadTeamLogo(teamId, inputEl) {
    const file = inputEl.files && inputEl.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch(`/api/teams/${teamId}/logo`, {
            method: 'POST',
            body: formData
        });
        const result = await parseJsonResponse(response);
        if (!response.ok) throw new Error(result.error || 'Failed to upload logo');

        showFeedback('Team logo updated successfully', 'success', 'teams');
        loadTeams();
    } catch (error) {
        console.error('Error uploading team logo:', error);
        showFeedback(error.message || 'Error uploading team logo', 'error', 'teams');
    } finally {
        inputEl.value = '';
    }
}

function triggerPlayerPhotoUpload(playerId) {
    const input = document.getElementById(`player-photo-input-${playerId}`);
    if (input) input.click();
}

async function uploadPlayerPhoto(playerId, inputEl) {
    const file = inputEl.files && inputEl.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch(`/api/players/${playerId}/photo`, {
            method: 'POST',
            body: formData
        });
        const result = await parseJsonResponse(response);
        if (!response.ok) throw new Error(result.error || 'Failed to upload photo');

        showFeedback('Player photo updated successfully', 'success', 'players');
        loadPlayers();
    } catch (error) {
        console.error('Error uploading player photo:', error);
        showFeedback(error.message || 'Error uploading player photo', 'error', 'players');
    } finally {
        inputEl.value = '';
    }
}

// Load dashboard on page load
window.addEventListener('load', loadDashboard);
