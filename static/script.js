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

            const teamCard = `
                <div class="team-card">
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
    const name = document.getElementById('team-name').value.trim();

    if (!name) {
        alert('Please enter a team name');
        return;
    }

    try {
        const response = await fetch('/api/teams', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        if (response.ok) {
            document.getElementById('team-name').value = '';
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
        const response = await fetch('/api/players?available=true');
        const players = await response.json();

        const container = document.getElementById('players-list');
        container.innerHTML = '';

        if (players.length === 0) {
            container.innerHTML = '<p style="grid-column: 1/-1; text-align: center;">No available players. Import from Excel first!</p>';
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

async function importPlayers() {
    const fileInput = document.getElementById('excel-file');
    const file = fileInput.files[0];

    if (!file) {
        showFeedback('Please select an Excel file', 'error', 'players');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/players', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (response.ok) {
            showFeedback(`✓ ${result.message}`, 'success', 'players');
            fileInput.value = '';
            loadPlayers();
            loadDashboard();
        } else {
            showFeedback(result.error || 'Error importing players', 'error', 'players');
        }
    } catch (error) {
        console.error('Error:', error);
        showFeedback('Error importing players', 'error', 'players');
    }
}

function updatePlayerDropdown(players) {
    const select = document.getElementById('auction-player');
    const currentValue = select.value;

    select.innerHTML = '<option value="">-- Select Player --</option>';
    players.forEach(player => {
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

// Load dashboard on page load
window.addEventListener('load', loadDashboard);
