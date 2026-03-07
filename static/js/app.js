// ── State ──
const state = {
    enemies: [null, null, null, null, null],
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
    setupControls();
    setupPaste();
    setupKeyboard();
}

// ── Controls ──
function setupControls() {
    document.getElementById('btn-reset').addEventListener('click', resetAll);
    document.getElementById('btn-paste').addEventListener('click', () => {
        showPasteStatus('Press Ctrl+V / Cmd+V to paste a scoreboard screenshot', 'loading');
    });
}

function resetAll() {
    state.enemies = [null, null, null, null, null];
    state.analysis = null;
    state.activeSlot = null;
    renderSlots();
    closePicker();
    document.getElementById('strategy-banner').classList.add('hidden');
    document.getElementById('strategy-cards').innerHTML = '';
    document.getElementById('do-not-hit').classList.add('hidden');
    document.getElementById('paste-status').classList.add('hidden');
}

// ── Keyboard ──
function setupKeyboard() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closePicker();
    });
}

// ── Paste Handler ──
function setupPaste() {
    document.addEventListener('paste', async (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        let imageFile = null;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                imageFile = item.getAsFile();
                break;
            }
        }

        if (!imageFile) return;
        e.preventDefault();

        showPasteStatus('Parsing scoreboard screenshot...', 'loading');

        try {
            const b64 = await fileToBase64(imageFile);
            const result = await api('/api/analysis/parse-scoreboard', {
                method: 'POST',
                body: JSON.stringify({
                    image: b64,
                    media_type: imageFile.type,
                }),
            });

            if (result.error) {
                showPasteStatus(`Parse error: ${result.error}`, 'error');
                return;
            }

            if (!result.enemies || result.enemies.length === 0) {
                showPasteStatus('No enemies detected in screenshot', 'error');
                return;
            }

            // Fill slots with parsed enemies
            for (let i = 0; i < 5; i++) {
                if (i < result.enemies.length) {
                    const enemy = result.enemies[i];
                    state.enemies[i] = {
                        profession_id: enemy.profession_id,
                        spec_id: null,
                        build_id: null,
                        player_name: enemy.character_name || null,
                    };
                } else {
                    state.enemies[i] = null;
                }
            }

            renderSlots();
            showPasteStatus(
                `Detected ${result.enemies.length} enemies. Click each slot to select elite spec.`,
                'success'
            );
        } catch (err) {
            showPasteStatus(`Failed to parse: ${err.message}`, 'error');
        }
    });
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            // Strip data URL prefix
            const result = reader.result.split(',')[1];
            resolve(result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function showPasteStatus(message, type) {
    const el = document.getElementById('paste-status');
    el.textContent = message;
    el.className = `paste-status ${type}`;
}

// ── Slots ──
function renderSlots() {
    const container = document.getElementById('enemy-slots');
    container.innerHTML = '';

    state.enemies.forEach((enemy, i) => {
        const slot = document.createElement('div');
        const threatClass = getSlotThreatClass(i);
        slot.className = `comp-slot${enemy ? ' filled' : ''}${threatClass}${state.activeSlot === i ? ' active' : ''}`;
        slot.dataset.index = i;

        if (!enemy) {
            slot.innerHTML = `
                <span class="slot-number">Enemy ${i + 1}</span>
                <span class="slot-placeholder">+</span>
            `;
            slot.addEventListener('click', () => openPicker(i));
        } else {
            const prof = state.professions.find(p => p.id === enemy.profession_id);
            const spec = enemy.spec_id ? state.eliteSpecs.find(s => s.id === enemy.spec_id) : null;

            slot.innerHTML = `
                <button class="slot-clear" title="Clear">&times;</button>
                <span class="slot-spec">${spec ? spec.name : '(select spec)'}</span>
                <span class="slot-profession">${prof ? prof.name : enemy.profession_id}</span>
                ${enemy.player_name ? `<span class="slot-player" title="${enemy.player_name}">${enemy.player_name}</span>` : ''}
                <div class="autocomplete-wrapper">
                    <input type="text" class="slot-player-input" data-slot="${i}"
                           placeholder="player name" value="${enemy.player_name || ''}"
                           autocomplete="off">
                </div>
            `;

            // Click to open picker (but not on input/button)
            slot.addEventListener('click', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
                openPicker(i, enemy.profession_id);
            });
        }

        container.appendChild(slot);
    });

    // Setup player inputs
    container.querySelectorAll('.slot-player-input').forEach(input => {
        input.addEventListener('click', e => e.stopPropagation());
        input.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.slot);
            if (state.enemies[idx]) {
                state.enemies[idx].player_name = e.target.value || null;
            }
            handlePlayerAutocomplete(e.target, idx);
        });
        input.addEventListener('blur', () => {
            // Delay to allow click on autocomplete item
            setTimeout(() => {
                const list = input.parentElement.querySelector('.autocomplete-list');
                if (list) list.remove();
            }, 200);
        });
    });

    // Clear buttons
    container.querySelectorAll('.slot-clear').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const slot = e.target.closest('.comp-slot');
            const idx = parseInt(slot.dataset.index);
            state.enemies[idx] = null;
            if (state.activeSlot === idx) closePicker();
            renderSlots();
            debounceAnalyze();
        });
    });
}

function getSlotThreatClass(index) {
    if (!state.analysis) return '';
    const card = state.analysis.strategy_cards.find(c => {
        const enemy = state.enemies[index];
        if (!enemy) return false;
        return c.spec_id === enemy.spec_id && c.profession_id === enemy.profession_id;
    });
    if (!card) return '';
    return ` threat-${card.threat_level}`;
}

// ── Player Autocomplete ──
async function handlePlayerAutocomplete(input, slotIndex) {
    const query = input.value.trim();
    const wrapper = input.parentElement;

    // Remove existing list
    const existing = wrapper.querySelector('.autocomplete-list');
    if (existing) existing.remove();

    if (query.length < 2) return;

    try {
        const result = await api(`/api/players/lookup/${encodeURIComponent(query)}`);
        if (!result.players || result.players.length === 0) return;

        const list = document.createElement('div');
        list.className = 'autocomplete-list';

        result.players.slice(0, 5).forEach(player => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';
            item.innerHTML = `
                <span>${player.account_name}</span>
                ${player.threat_level ? `<span class="autocomplete-threat">T${player.threat_level}</span>` : ''}
            `;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = player.account_name;
                state.enemies[slotIndex].player_name = player.account_name;
                list.remove();
            });
            list.appendChild(item);
        });

        wrapper.appendChild(list);
    } catch {
        // Silently fail autocomplete
    }
}

// ── Inline Picker ──
function openPicker(slotIndex, filterProfessionId) {
    state.activeSlot = slotIndex;
    const picker = document.getElementById('inline-picker');
    const optionsContainer = document.getElementById('picker-options');
    const searchInput = document.getElementById('picker-search');

    picker.classList.remove('hidden');
    searchInput.value = '';
    searchInput.focus();

    renderPickerOptions(filterProfessionId, '');

    // Search handler
    searchInput.oninput = () => {
        renderPickerOptions(filterProfessionId, searchInput.value.trim().toLowerCase());
    };

    // Close button
    document.getElementById('picker-close').onclick = closePicker;

    // Re-render slots to show active state
    renderSlots();
}

function renderPickerOptions(filterProfessionId, searchQuery) {
    const container = document.getElementById('picker-options');
    container.innerHTML = '';

    // Group specs by profession
    const grouped = {};
    state.professions.forEach(prof => {
        grouped[prof.id] = { name: prof.name, specs: [] };
    });

    state.eliteSpecs.forEach(spec => {
        if (grouped[spec.profession_id]) {
            grouped[spec.profession_id].specs.push(spec);
        }
    });

    // If filtered to a profession, show that first
    const profOrder = filterProfessionId
        ? [filterProfessionId, ...Object.keys(grouped).filter(k => k !== filterProfessionId)]
        : Object.keys(grouped);

    profOrder.forEach(profId => {
        const group = grouped[profId];
        if (!group || group.specs.length === 0) return;

        const matchingSpecs = group.specs.filter(spec => {
            if (!searchQuery) return true;
            return spec.name.toLowerCase().includes(searchQuery) ||
                   group.name.toLowerCase().includes(searchQuery);
        });

        if (matchingSpecs.length === 0) return;

        // Don't show non-filtered professions if a profession filter is set and no search
        if (filterProfessionId && profId !== filterProfessionId && !searchQuery) return;

        const label = document.createElement('div');
        label.className = 'picker-group-label';
        label.textContent = group.name;
        container.appendChild(label);

        matchingSpecs.forEach(spec => {
            const btn = document.createElement('button');
            btn.className = 'picker-option';

            // Highlight if this matches a search perfectly
            if (searchQuery && spec.name.toLowerCase().startsWith(searchQuery)) {
                btn.classList.add('highlighted');
            }

            btn.textContent = spec.name;
            btn.addEventListener('click', () => selectSpec(spec));
            container.appendChild(btn);
        });
    });
}

async function selectSpec(spec) {
    const idx = state.activeSlot;
    if (idx === null) return;

    if (!state.enemies[idx]) {
        state.enemies[idx] = {
            profession_id: spec.profession_id,
            spec_id: spec.id,
            build_id: null,
            player_name: null,
        };
    } else {
        state.enemies[idx].profession_id = spec.profession_id;
        state.enemies[idx].spec_id = spec.id;
    }

    // Load builds
    try {
        const buildData = await api(`/api/data/builds?spec_id=${spec.id}`);
        buildData.builds.forEach(b => {
            if (!state.builds.find(existing => existing.id === b.id)) {
                state.builds.push(b);
            }
        });
    } catch { /* ignore */ }

    closePicker();
    renderSlots();
    debounceAnalyze();
}

function closePicker() {
    document.getElementById('inline-picker').classList.add('hidden');
    state.activeSlot = null;
    renderSlots();
}

// ── Analysis ──
let analyzeTimer = null;
function debounceAnalyze() {
    clearTimeout(analyzeTimer);
    analyzeTimer = setTimeout(analyze, 500);
}

async function analyze() {
    const enemies = state.enemies.filter(e => e && e.spec_id);
    if (enemies.length === 0) {
        state.analysis = null;
        document.getElementById('strategy-banner').classList.add('hidden');
        document.getElementById('strategy-cards').innerHTML = '';
        document.getElementById('do-not-hit').classList.add('hidden');
        return;
    }

    try {
        const result = await api('/api/analysis/team-comp', {
            method: 'POST',
            body: JSON.stringify({ enemies }),
        });

        state.analysis = result;
        renderAnalysis(result);
        // Re-render slots to update threat colors
        renderSlots();
    } catch (err) {
        console.error('Analysis failed:', err);
    }
}

function renderAnalysis(data) {
    // Strategy banner
    const banner = document.getElementById('strategy-banner');
    banner.classList.remove('hidden');
    document.getElementById('banner-recommendation').textContent = data.general_strategy.recommendation;
    document.getElementById('banner-roles').textContent = data.general_strategy.role_summary;

    // Strategy cards
    const container = document.getElementById('strategy-cards');
    container.innerHTML = '';

    data.strategy_cards.forEach(card => {
        const el = document.createElement('div');
        el.className = `strategy-card threat-${card.threat_level}`;
        el.innerHTML = `
            <div class="card-top">
                <div>
                    <div class="card-spec">${card.spec_name}</div>
                    <div class="card-profession">${card.profession_name}</div>
                    ${card.player_name ? `<div class="card-player">${card.player_name}</div>` : ''}
                </div>
                <div class="card-badges">
                    <span class="focus-order">#${card.focus_order}</span>
                    <span class="threat-badge threat-${card.threat_level}">${card.threat_level}</span>
                </div>
            </div>
            <div class="card-section">
                <div class="label">Kills you with</div>
                <div class="value">${card.kills_you_with}</div>
            </div>
            <div class="card-section">
                <div class="label">Your window</div>
                <div class="value">${card.your_window}</div>
            </div>
            <div class="card-section secondary">
                <div class="label">Saves them with</div>
                <div class="value">${card.saves_them_with}</div>
            </div>
            ${card.stolen_skill ? `
                <div class="stolen-skill">
                    <span class="skill-name">Steal: ${card.stolen_skill.skill_name}</span>
                    — ${card.stolen_skill.effect}
                </div>
            ` : ''}
            <ul class="card-gameplan">
                ${card.gameplan.map(g => `<li>${g}</li>`).join('')}
            </ul>
        `;
        container.appendChild(el);
    });

    // Do not hit
    const dnh = document.getElementById('do-not-hit');
    if (data.do_not_hit.length > 0) {
        dnh.classList.remove('hidden');
        dnh.innerHTML = `
            <div class="dnh-header">Do Not Hit</div>
            <div class="dnh-pills">
                ${data.do_not_hit.map(d => `
                    <span class="dnh-pill">
                        ${d.skill_name}<span class="dnh-duration">(${d.duration_seconds}s)</span>
                        <span class="dnh-tooltip">
                            <div class="dnh-tooltip-effect">${d.what_happens}</div>
                            <div class="dnh-tooltip-action">${d.what_to_do}</div>
                        </span>
                    </span>
                `).join('')}
            </div>
        `;
    } else {
        dnh.classList.add('hidden');
    }
}

// ── Boot ──
init();
