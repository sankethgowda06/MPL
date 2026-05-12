const teamsGrid = document.getElementById("teams-grid");
const modal = document.getElementById("team-modal");
const closeModalBtn = document.getElementById("close-modal");
const modalTeamName = document.getElementById("modal-team-name");
const modalTeamMeta = document.getElementById("modal-team-meta");
const teamPlayers = document.getElementById("team-players");
const teamLogs = document.getElementById("team-logs");
const lastUpdated = document.getElementById("last-updated");

let selectedTeamId = null;

async function fetchTeams() {
    const response = await fetch("/api/viewer/teams");
    if (!response.ok) throw new Error("Failed to fetch teams");
    return response.json();
}

async function fetchTeamDetail(teamId) {
    const response = await fetch(`/api/viewer/teams/${teamId}`);
    if (!response.ok) throw new Error("Failed to fetch team detail");
    return response.json();
}

function formatMoney(value) {
    return `₹${Number(value || 0).toLocaleString()}`;
}

function renderTeams(teams) {
    if (!teams.length) {
        teamsGrid.innerHTML = `<div class="empty">No teams available yet.</div>`;
        return;
    }

    teamsGrid.innerHTML = teams
        .map(
            (team) => `
        <article class="team-card" data-team-id="${team.id}">
            <div class="team-card-head">
                <div class="team-logo-wrap">
                    ${
                        team.logo_url
                            ? `<img src="${team.logo_url}" alt="${team.name} logo">`
                            : `<div class="team-logo-placeholder">🏏</div>`
                    }
                </div>
                <div class="team-head-text">
                    <h3>${team.name}</h3>
                    <p class="team-owner">Owner: ${team.owner || "N/A"}</p>
                </div>
            </div>
            <div class="stats">
                <div class="stat">
                    <span class="label">Remaining</span>
                    <span class="value">${formatMoney(team.remaining_budget)}</span>
                </div>
                <div class="stat">
                    <span class="label">Players</span>
                    <span class="value">${team.players_count}</span>
                </div>
            </div>
        </article>
    `
        )
        .join("");

    document.querySelectorAll(".team-card").forEach((card) => {
        card.addEventListener("click", () => openTeamModal(Number(card.dataset.teamId)));
    });
}

function renderPlayers(players) {
    if (!players.length) {
        teamPlayers.innerHTML = `<div class="empty">No players bidded for this team yet.</div>`;
        return;
    }

    teamPlayers.innerHTML = players
        .map(
            (player) => `
        <article class="player-card">
            <div class="player-photo-wrap">
                ${
                    player.photo_url
                        ? `<img src="${player.photo_url}" alt="${player.name}">`
                        : `<div class="empty">No Photo</div>`
                }
            </div>
            <p class="player-name">#${player.serial_number} ${player.name}</p>
            <p class="player-meta">${player.role} • ${formatMoney(player.price)}</p>
        </article>
    `
        )
        .join("");
}

function formatTime(isoValue) {
    if (!isoValue) return "";
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
}

function renderLogs(logs) {
    if (!logs || !logs.length) {
        teamLogs.innerHTML = `<div class="empty">No team log entries yet.</div>`;
        return;
    }

    teamLogs.innerHTML = logs
        .map((log) => {
            const actionClass = log.action === "BIDDED" ? "log-action-bidded" : "log-action-removed";
            const serialText = log.player_serial ? `#${log.player_serial} ` : "";
            return `
                <article class="log-item">
                    <div class="log-main">
                        <span class="${actionClass}">${log.action}</span> • ${serialText}${log.player_name} • ${formatMoney(log.price)}
                    </div>
                    <div class="log-sub">${log.player_role} • ${formatTime(log.created_at)}</div>
                </article>
            `;
        })
        .join("");
}

async function openTeamModal(teamId) {
    selectedTeamId = teamId;
    const detail = await fetchTeamDetail(teamId);

    modalTeamName.textContent = detail.name;
    modalTeamMeta.textContent = `Remaining: ${formatMoney(detail.remaining_budget)} | Players: ${detail.players_count}`;
    renderPlayers(detail.players);
    renderLogs(detail.logs || []);
    modal.classList.remove("hidden");
}

function closeModal() {
    modal.classList.add("hidden");
    selectedTeamId = null;
}

async function refresh() {
    try {
        const teams = await fetchTeams();
        renderTeams(teams);
        lastUpdated.textContent = `Updated: ${new Date().toLocaleTimeString()}`;

        if (selectedTeamId) {
            const detail = await fetchTeamDetail(selectedTeamId);
            modalTeamName.textContent = detail.name;
            modalTeamMeta.textContent = `Remaining: ${formatMoney(detail.remaining_budget)} | Players: ${detail.players_count}`;
            renderPlayers(detail.players);
            renderLogs(detail.logs || []);
        }
    } catch (error) {
        lastUpdated.textContent = "Update failed";
        console.error(error);
    }
}

closeModalBtn.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
});

refresh();
setInterval(refresh, 3000);
