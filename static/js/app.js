// ── State ──
const state = {
    enemies: [null, null, null, null, null], // each: {profession_id, spec_id, build_id, player_name}
    professions: [],
    eliteSpecs: [],
    builds: [],
    activeSlot: null,
    analysis: null,
};

// ── API Helpers ──
async function api(path, options = {}) {
    const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    return res.json();
}

// ── Init ──
async function init() {
    const [profData, specData] = await Promise.all([
        api('/api/data/professions'),
        api('/api/data/elite-specs'),
    ]);
    state.professions = profData.professions;
    state.eliteSpecs = specData.elite_specs;

    renderSlots();
    setupNav();
    setupControls();
    setupPlayerSearch();
}

// ── Navigation ──
function setupNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => {
                v.classList.remove('active');
                v.classList.add('hidden');
            });
            btn.classList.add('active');
            const view = document.getElementById(`view-${btn.dataset.view}`);
            view.classList.remove('hidden');
            view.classList.add('active');
        });
    });
}

// ── Controls ──
function setupControls() {
    document.getElementById('btn-reset').addEventListener('click', () => {
        state.enemies = [null, null, null, null, null];
        state.analysis = null;
        renderSlots();
        document.getElementById('general-strategy').innerHTML = '';
        document.getElementById('strategy-cards').innerHTML = '';
        document.getElementById('do-not-hit').innerHTML = '';
    });

    document.getElementById('btn-analyze').addEventListener('click', analyze);
}

// ── Slots ──
function renderSlots() {
    const container = document.getElementById('enemy-slots');
    container.innerHTML = '';

    state.enemies.forEach((enemy, i) => {
        const slot = document.createElement('div');
        slot.className = `enemy-slot${enemy ? ' filled' : ''}`;
        slot.dataset.index = i;

        if (!enemy) {
            slot.innerHTML = `
                <span class="slot-number">Enemy ${i + 1}</span>
                <span class="slot-placeholder">+</span>
                <span class="slot-number">Click to select</span>
            `;
            slot.addEventListener('click', () => openProfessionPicker(i));
        } else {
            const prof = state.professions.find(p => p.id === enemy.profession_id);
            const spec = enemy.spec_id ? state.eliteSpecs.find(s => s.id === enemy.spec_id) : null;
            const specsForProf = state.eliteSpecs.filter(s => s.profession_id === enemy.profession_id);
            const buildsForSpec = enemy.spec_id ? state.builds.filter(b => b.spec_id === enemy.spec_id) : [];

            slot.innerHTML = `
                <span class="slot-number">Enemy ${i + 1}</span>
                <span class="profession-name">${prof ? prof.name : enemy.profession_id}</span>
                ${spec ? `<span class="spec-name">${spec.name}</span>` : '<span class="spec-name" style="color:var(--text-dim)">Click spec below</span>'}
                ${buildsForSpec.length > 0 ? `
                    <select class="build-select" data-slot="${i}">
                        <option value="">-- Build --</option>
                        ${buildsForSpec.map(b => `<option value="${b.id}" ${enemy.build_id === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
                    </select>
                ` : ''}
                <input type="text" class="player-input" data-slot="${i}" placeholder="Player name" value="${enemy.player_name || ''}">
                <button class="slot-clear" data-slot="${i}">clear</button>
            `;

            // Click on profession name to change spec
            if (!spec) {
                slot.querySelector('.spec-name').addEventListener('click', (e) => {
                    e.stopPropagation();
                    openSpecPicker(i, enemy.profession_id);
                });
            }

            slot.addEventListener('click', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;
                openProfessionPicker(i);
            });
        }

        container.appendChild(slot);
    });

    // Event delegation for inputs
    container.querySelectorAll('.player-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.slot);
            if (state.enemies[idx]) {
                state.enemies[idx].player_name = e.target.value || null;
            }
        });
        input.addEventListener('click', e => e.stopPropagation());
    });

    container.querySelectorAll('.build-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.slot);
            if (state.enemies[idx]) {
                state.enemies[idx].build_id = e.target.value || null;
            }
        });
        select.addEventListener('click', e => e.stopPropagation());
    });

    container.querySelectorAll('.slot-clear').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(e.target.dataset.slot);
            state.enemies[idx] = null;
            renderSlots();
        });
    });
}

// ── Profession Picker ──
function openProfessionPicker(slotIndex) {
    state.activeSlot = slotIndex;
    const picker = document.getElementById('profession-picker');
    const grid = document.getElementById('profession-grid');

    grid.innerHTML = '';
    state.professions.forEach(prof => {
        const btn = document.createElement('button');
        btn.className = 'picker-btn';
        btn.textContent = prof.name;
        btn.addEventListener('click', () => {
            state.enemies[slotIndex] = {
                profession_id: prof.id,
                spec_id: null,
                build_id: null,
                player_name: state.enemies[slotIndex]?.player_name || null,
            };
            picker.classList.add('hidden');
            openSpecPicker(slotIndex, prof.id);
        });
        grid.appendChild(btn);
    });

    picker.classList.remove('hidden');
    picker.addEventListener('click', (e) => {
        if (e.target === picker) picker.classList.add('hidden');
    }, { once: true });
}

// ── Spec Picker ──
function openSpecPicker(slotIndex, professionId) {
    const picker = document.getElementById('spec-picker');
    const grid = document.getElementById('spec-grid');
    const specs = state.eliteSpecs.filter(s => s.profession_id === professionId);

    grid.innerHTML = '';
    specs.forEach(spec => {
        const btn = document.createElement('button');
        btn.className = 'picker-btn';
        btn.textContent = spec.name;
        btn.addEventListener('click', async () => {
            state.enemies[slotIndex].spec_id = spec.id;
            picker.classList.add('hidden');

            // Load builds for this spec
            const buildData = await api(`/api/data/builds?spec_id=${spec.id}`);
            // Merge into state.builds (dedupe)
            buildData.builds.forEach(b => {
                if (!state.builds.find(existing => existing.id === b.id)) {
                    state.builds.push(b);
                }
            });

            renderSlots();
            debounceAnalyze();
        });
        grid.appendChild(btn);
    });

    picker.classList.remove('hidden');
    picker.addEventListener('click', (e) => {
        if (e.target === picker) {
            picker.classList.add('hidden');
            renderSlots();
        }
    }, { once: true });
}

// ── Analysis ──
let analyzeTimer = null;
function debounceAnalyze() {
    clearTimeout(analyzeTimer);
    analyzeTimer = setTimeout(analyze, 500);
}

async function analyze() {
    const enemies = state.enemies.filter(e => e && e.profession_id);
    if (enemies.length === 0) return;

    const result = await api('/api/analysis/team-comp', {
        method: 'POST',
        body: JSON.stringify({ enemies }),
    });

    state.analysis = result;
    renderAnalysis(result);

    // Switch to analysis view
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => {
        v.classList.remove('active');
        v.classList.add('hidden');
    });
    document.querySelector('[data-view="analysis"]').classList.add('active');
    document.getElementById('view-analysis').classList.remove('hidden');
    document.getElementById('view-analysis').classList.add('active');
}

function renderAnalysis(data) {
    // General strategy
    const gs = document.getElementById('general-strategy');
    gs.innerHTML = `
        <div class="recommendation">${data.general_strategy.recommendation}</div>
        <div class="role-summary">${data.general_strategy.role_summary}</div>
    `;

    // Strategy cards
    const container = document.getElementById('strategy-cards');
    container.innerHTML = '';
    data.strategy_cards.forEach(card => {
        const el = document.createElement('div');
        el.className = 'strategy-card';
        el.innerHTML = `
            <div class="card-header">
                <div>
                    <div class="card-spec">${card.spec_name}</div>
                    <div class="card-profession">${card.profession_name}</div>
                    ${card.build_name ? `<div class="card-build">${card.build_name}</div>` : ''}
                    ${card.player_name ? `<div class="card-player">${card.player_name}</div>` : ''}
                </div>
                <div>
                    <span class="focus-order">#${card.focus_order}</span>
                    <span class="threat-badge threat-${card.threat_level}">${card.threat_level}</span>
                </div>
            </div>
            ${card.stolen_skill ? `
                <div class="stolen-skill">
                    <span class="skill-name">Steal: ${card.stolen_skill.skill_name}</span>
                    <br>${card.stolen_skill.effect}
                </div>
            ` : ''}
            <div class="card-section">
                <div class="label">Kills you with</div>
                <div class="value">${card.kills_you_with}</div>
            </div>
            <div class="card-section">
                <div class="label">Saves them with</div>
                <div class="value">${card.saves_them_with}</div>
            </div>
            <div class="card-section">
                <div class="label">Your window</div>
                <div class="value">${card.your_window}</div>
            </div>
            <ul class="card-gameplan">
                ${card.gameplan.map(g => `<li>${g}</li>`).join('')}
            </ul>
        `;
        container.appendChild(el);
    });

    // Do not hit
    const dnh = document.getElementById('do-not-hit');
    if (data.do_not_hit.length > 0) {
        dnh.innerHTML = `
            <h3>DO NOT HIT</h3>
            <div class="dnh-list">
                ${data.do_not_hit.map(d => `
                    <div class="dnh-item">
                        <div class="dnh-skill">${d.skill_name}</div>
                        <div class="dnh-effect">${d.what_happens} (${d.duration_seconds}s)</div>
                        <div class="dnh-action">${d.what_to_do}</div>
                    </div>
                `).join('')}
            </div>
        `;
    } else {
        dnh.innerHTML = '';
    }
}

// ── Player Search ──
function setupPlayerSearch() {
    const btn = document.getElementById('btn-player-search');
    const input = document.getElementById('player-search-input');

    const doSearch = async () => {
        const name = input.value.trim();
        if (!name) return;
        const result = await api(`/api/players/lookup/${encodeURIComponent(name)}`);
        renderPlayerResults(result.players);
    };

    btn.addEventListener('click', doSearch);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSearch();
    });
}

function renderPlayerResults(players) {
    const container = document.getElementById('player-results');
    if (!players || players.length === 0) {
        container.innerHTML = '<div class="no-data">No players found</div>';
        return;
    }

    container.innerHTML = players.map(p => `
        <div class="player-card">
            <div class="player-name">${p.account_name}${p.nickname ? ` (${p.nickname})` : ''}</div>
            <div class="player-info">
                Threat: ${p.threat_level || 0} |
                Last seen: ${p.last_seen || 'never'} |
                Last played: ${p.last_profession || '?'} / ${p.last_spec || '?'}
                ${p.notes ? `<br>Notes: ${p.notes}` : ''}
            </div>
        </div>
    `).join('');
}

// ── Boot ──
init();
