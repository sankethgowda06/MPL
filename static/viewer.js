const teamsGrid = document.getElementById("teams-grid");
const playersGrid = document.getElementById("players-grid");
const modal = document.getElementById("team-modal");
const closeModalBtn = document.getElementById("close-modal");
const modalTeamName = document.getElementById("modal-team-name");
const modalTeamMeta = document.getElementById("modal-team-meta");
const teamPlayers = document.getElementById("team-players");
const teamLogs = document.getElementById("team-logs");
const lastUpdated = document.getElementById("last-updated");
const modalOwner = document.getElementById("modal-owner");
const modalPlayersCount = document.getElementById("modal-players-count");
const modalSpent = document.getElementById("modal-spent");
const modalRemaining = document.getElementById("modal-remaining");
const modalTabSquad = document.getElementById("modal-tab-squad");
const modalTabLog = document.getElementById("modal-tab-log");
const modalSectionSquad = document.getElementById("modal-section-squad");
const modalSectionLog = document.getElementById("modal-section-log");
const modalScroll = document.getElementById("modal-scroll");

const statTeams = document.getElementById("stat-teams");
const statSold = document.getElementById("stat-sold");
const statUnsold = document.getElementById("stat-unsold");
const statPurse = document.getElementById("stat-purse");

const teamSearchInput = document.getElementById("team-search");
const teamSortSelect = document.getElementById("team-sort");
const playerSearchInput = document.getElementById("player-search");
const playerFilterSelect = document.getElementById("player-filter");

let selectedTeamId = null;
let allTeams = [];
let allPlayers = [];

function setModalTab(tabName) {
    const isSquad = tabName !== "log";

    if (modalTabSquad) {
        modalTabSquad.classList.toggle("active", isSquad);
        modalTabSquad.setAttribute("aria-selected", isSquad ? "true" : "false");
    }

    if (modalTabLog) {
        modalTabLog.classList.toggle("active", !isSquad);
        modalTabLog.setAttribute("aria-selected", !isSquad ? "true" : "false");
    }

    modalSectionSquad?.classList.toggle("hidden-section", !isSquad);
    modalSectionLog?.classList.toggle("hidden-section", isSquad);

    if (modalScroll) {
        modalScroll.scrollTop = 0;
    }
}

function updateModalTabLabels(playersCount, logsCount) {
    if (modalTabSquad) {
        modalTabSquad.textContent = `Squad (${playersCount})`;
    }

    if (modalTabLog) {
        modalTabLog.textContent = `Activity (${logsCount})`;
    }
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatMoney(value) {
    return `₹${Number(value || 0).toLocaleString()}`;
}

function formatTime(isoValue) {
    if (!isoValue) return "";
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
}

function getFilteredAndSortedTeams() {
    const search = (teamSearchInput?.value || "").trim().toLowerCase();
    const sortKey = teamSortSelect?.value || "name";

    const filtered = allTeams.filter((team) => {
        if (!search) return true;
        const name = (team.name || "").toLowerCase();
        const owner = (team.owner || "").toLowerCase();
        return name.includes(search) || owner.includes(search);
    });

    filtered.sort((a, b) => {
        if (sortKey === "players") {
            return (b.players_count || 0) - (a.players_count || 0);
        }
        if (sortKey === "remaining") {
            return (b.remaining_budget || 0) - (a.remaining_budget || 0);
        }
        return (a.name || "").localeCompare(b.name || "");
    });

    return filtered;
}

function getFilteredPlayers() {
    const search = (playerSearchInput?.value || "").trim().toLowerCase();
    const filter = playerFilterSelect?.value || "all";

    return allPlayers.filter((player) => {
        const isSold = Boolean(player.team_name);
        if (filter === "sold" && !isSold) return false;
        if (filter === "unsold" && isSold) return false;

        if (!search) return true;

        const serial = String(player.serial_number || "");
        const name = (player.name || "").toLowerCase();
        const role = (player.role || "").toLowerCase();
        const teamName = (player.team_name || "").toLowerCase();

        return serial.includes(search) || name.includes(search) || role.includes(search) || teamName.includes(search);
    });
}

function updateOverviewStats() {
    if (!statTeams || !statSold || !statUnsold || !statPurse) {
        return;
    }

    const soldCount = allPlayers.filter((p) => Boolean(p.team_name)).length;
    const unsoldCount = allPlayers.length - soldCount;
    const totalPurseLeft = allTeams.reduce((sum, t) => sum + Number(t.remaining_budget || 0), 0);

    statTeams.textContent = String(allTeams.length);
    statSold.textContent = String(soldCount);
    statUnsold.textContent = String(Math.max(0, unsoldCount));
    statPurse.textContent = formatMoney(totalPurseLeft);
}

function renderTeams() {
    const teams = getFilteredAndSortedTeams();

    if (!teams.length) {
        teamsGrid.innerHTML = `<div class="empty">No matching teams found.</div>`;
        return;
    }

    teamsGrid.innerHTML = teams
        .map(
            (team) => {
                const spent = Number(team.total_spent || 0);
                const remaining = Number(team.remaining_budget || 0);
                const ratio = team.total_spent || remaining ? Math.round((spent / (spent + remaining || 1)) * 100) : 0;

                return `
                <article class="team-card" data-team-id="${team.id}">
                    <div class="team-card-head">
                        <div class="team-logo-wrap">
                            ${team.logo_url ? `<img src="${team.logo_url}" alt="${escapeHtml(team.name)} logo">` : `<div class="team-logo-placeholder">🏏</div>`}
                        </div>
                        <div class="team-head-text">
                            <h3>${escapeHtml(team.name)}</h3>
                            <p class="team-owner">Owner: ${escapeHtml(team.owner || "N/A")}</p>
                        </div>
                    </div>
                    <div class="stats">
                        <div class="stat">
                            <span class="label">Remaining</span>
                            <span class="value">${formatMoney(remaining)}</span>
                        </div>
                        <div class="stat">
                            <span class="label">Players</span>
                            <span class="value">${team.players_count || 0}</span>
                        </div>
                        <div class="stat">
                            <span class="label">Purse Used</span>
                            <span class="value">${ratio}%</span>
                        </div>
                    </div>
                </article>
                `;
            }
        )
        .join("");
}

function renderPlayersList() {
    const players = getFilteredPlayers();

    if (!players.length) {
        playersGrid.innerHTML = `<div class="empty">No players match the current filter.</div>`;
        return;
    }

    playersGrid.innerHTML = players
        .map(
            (player) => `
            <article class="player-list-card">
                <div class="player-photo-wrap">
                    ${player.photo_url ? `<img src="${player.photo_url}" alt="${escapeHtml(player.name)}">` : `<div class="empty">No Photo</div>`}
                </div>
                <div class="player-list-info">
                    <p class="player-name">#${escapeHtml(player.serial_number)} ${escapeHtml(player.name)}</p>
                    <p class="player-role">${escapeHtml(player.role)}</p>
                    ${
                        player.team_name
                            ? `<p class="player-team sold">${escapeHtml(player.team_name)} • ${formatMoney(player.price)}</p>`
                            : `<p class="player-team unsold">Unsold</p>`
                    }
                </div>
            </article>
        `
        )
        .join("");
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
                ${player.photo_url ? `<img src="${player.photo_url}" alt="${escapeHtml(player.name)}">` : `<div class="empty">No Photo</div>`}
            </div>
            <div>
                <p class="player-name">#${escapeHtml(player.serial_number)} ${escapeHtml(player.name)}</p>
                <p class="player-meta">${escapeHtml(player.role)}</p>
            </div>
            <div class="player-price-pill">${formatMoney(player.price)}</div>
        </article>
    `
        )
        .join("");
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
                        <span class="${actionClass} log-badge">${escapeHtml(log.action)}</span>${escapeHtml(serialText)}${escapeHtml(log.player_name)} • ${formatMoney(log.price)}
                    </div>
                    <div class="log-sub">${escapeHtml(log.player_role)} • ${formatTime(log.created_at)}</div>
                </article>
            `;
        })
        .join("");
}

function updateModalSummary(detail) {
    if (!modalOwner || !modalPlayersCount || !modalSpent || !modalRemaining || !modalTeamMeta) {
        return;
    }

    const owner = detail.owner || "N/A";
    const playersCount = Number(detail.players_count || 0);
    const spent = Number(detail.total_spent || 0);
    const remaining = Number(detail.remaining_budget || 0);

    modalOwner.textContent = owner;
    modalPlayersCount.textContent = String(playersCount);
    modalSpent.textContent = formatMoney(spent);
    modalRemaining.textContent = formatMoney(remaining);
    modalTeamMeta.textContent = `${playersCount} player(s) in squad`;
}

async function fetchTeams() {
    const response = await fetch("/api/viewer/teams");
    if (!response.ok) throw new Error("Failed to fetch teams");
    return response.json();
}

async function fetchAllPlayers() {
    const response = await fetch("/api/viewer/players");
    if (!response.ok) throw new Error("Failed to fetch players");
    return response.json();
}

async function fetchTeamDetail(teamId) {
    const response = await fetch(`/api/viewer/teams/${teamId}`);
    if (!response.ok) throw new Error("Failed to fetch team detail");
    return response.json();
}

async function openTeamModal(teamId) {
    selectedTeamId = teamId;

    try {
        const detail = await fetchTeamDetail(teamId);
        modalTeamName.textContent = detail.name;
        updateModalSummary(detail);
        renderPlayers(detail.players || []);
        renderLogs(detail.logs || []);
        updateModalTabLabels((detail.players || []).length, (detail.logs || []).length);
        setModalTab("squad");
        modal.classList.remove("hidden");
        modal.setAttribute("aria-hidden", "false");
        document.body.classList.add("modal-open");
    } catch (error) {
        console.error(error);
    }
}

function closeModal() {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    selectedTeamId = null;
}

function wireInteractions() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const tabName = btn.dataset.tab;
            document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            document.querySelectorAll(".tab-content").forEach((section) => section.classList.remove("active"));
            document.getElementById(`section-${tabName}`).classList.add("active");
        });
    });

    teamsGrid?.addEventListener("click", (event) => {
        const card = event.target.closest(".team-card");
        if (!card) return;
        const teamId = Number(card.dataset.teamId);
        if (!Number.isNaN(teamId)) {
            openTeamModal(teamId);
        }
    });

    teamSearchInput?.addEventListener("input", renderTeams);
    teamSortSelect?.addEventListener("change", renderTeams);
    playerSearchInput?.addEventListener("input", renderPlayersList);
    playerFilterSelect?.addEventListener("change", renderPlayersList);

    closeModalBtn?.addEventListener("click", closeModal);
    modal?.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
    });

    modalTabSquad?.addEventListener("click", () => setModalTab("squad"));
    modalTabLog?.addEventListener("click", () => setModalTab("log"));

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && modal && !modal.classList.contains("hidden")) {
            closeModal();
        }
    });
}

async function refresh() {
    try {
        const [teams, players] = await Promise.all([fetchTeams(), fetchAllPlayers()]);
        allTeams = Array.isArray(teams) ? teams : [];
        allPlayers = Array.isArray(players) ? players : [];

        updateOverviewStats();
        renderTeams();
        renderPlayersList();

        lastUpdated.textContent = `Updated: ${new Date().toLocaleTimeString()}`;

        if (selectedTeamId) {
            const detail = await fetchTeamDetail(selectedTeamId);
            modalTeamName.textContent = detail.name;
            updateModalSummary(detail);
            renderPlayers(detail.players || []);
            renderLogs(detail.logs || []);
            updateModalTabLabels((detail.players || []).length, (detail.logs || []).length);
        }
    } catch (error) {
        lastUpdated.textContent = "Update failed";
        console.error(error);
    }
}

wireInteractions();
refresh();
setInterval(refresh, 3000);
