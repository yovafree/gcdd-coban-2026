// ================== Estado global ==================
let raffles = [];
let currentRaffle = null;
let isSpinning = false;
let currentRotation = 0; // radianes acumulados de rotación del canvas

const THEMES = {
  classic: ['#7c5cff', '#ffb347', '#ff5c7a', '#4ade80', '#38bdf8', '#f472b6', '#facc15', '#a78bfa'],
  sunset: ['#ff5e62', '#ff9966', '#ffcc70', '#ff8a5b', '#e94057', '#f27121'],
  ocean: ['#0077b6', '#00b4d8', '#90e0ef', '#0096c7', '#48cae4', '#023e8a'],
  mono: ['#2b2f4a', '#3a3f66', '#4a4f7a', '#5a5f8e', '#6a6fa2', '#7a7fb6'],
};

const canvas = document.getElementById('wheelCanvas');
const ctx = canvas.getContext('2d');

// ================== Utilidades ==================
async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(err.error || 'Error en la solicitud');
  }
  return res.status === 204 ? null : res.json();
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// ================== Carga de rifas ==================
async function loadRaffles() {
  raffles = await api('/raffles');
  renderRaffleList();
}

function renderRaffleList() {
  const list = document.getElementById('raffleList');
  list.innerHTML = '';
  raffles.forEach((r) => {
    const li = document.createElement('li');
    li.className = 'raffle-item' + (currentRaffle && currentRaffle.id === r.id ? ' active' : '');
    li.innerHTML = `
      <div>
        ${r.name}
        <small>${r.participantsCount} participantes · ${r.winnersCount} ganadores</small>
      </div>
      <button class="delete-btn" title="Eliminar rifa">✕</button>
    `;
    li.addEventListener('click', () => selectRaffle(r.id));
    li.querySelector('.delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`¿Eliminar la rifa "${r.name}"?`)) return;
      await api(`/raffles/${r.id}`, { method: 'DELETE' });
      if (currentRaffle && currentRaffle.id === r.id) {
        currentRaffle = null;
        clearWheelUI();
      }
      await loadRaffles();
    });
    list.appendChild(li);
  });
}

async function selectRaffle(id) {
  currentRaffle = await api(`/raffles/${id}`);
  currentRotation = 0;
  renderRaffleList();
  renderCurrentRaffle();
}

function clearWheelUI() {
  document.getElementById('currentRaffleName').textContent = 'Selecciona o crea una rifa';
  document.getElementById('btnSpin').disabled = true;
  document.getElementById('participantList').innerHTML = '';
  document.getElementById('winnersList').innerHTML = '';
  updateWinnersActions();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function renderCurrentRaffle() {
  if (!currentRaffle) return clearWheelUI();

  document.getElementById('currentRaffleName').textContent = currentRaffle.name;
  document.getElementById('btnSpin').disabled = currentRaffle.participants.length < 2;

  // Configuración
  const c = currentRaffle.config;
  document.getElementById('cfgSpinDuration').value = Math.round(c.spinDurationMs / 1000);
  document.getElementById('cfgAllowRepeat').checked = c.allowRepeatWinners;
  document.getElementById('cfgRemoveWinner').checked = c.removeWinnerAfterDraw;
  document.getElementById('cfgTheme').value = c.theme;

  renderParticipantList();
  renderWinnersList();
  drawWheel();
}

// ================== Participantes ==================
function renderParticipantList() {
  const list = document.getElementById('participantList');
  list.innerHTML = '';
  currentRaffle.participants.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${p.name} ${p.tickets > 1 ? `(x${p.tickets})` : ''}</span>`;
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.addEventListener('click', async () => {
      await api(`/raffles/${currentRaffle.id}/participants/${p.id}`, { method: 'DELETE' });
      await refreshCurrentRaffle();
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

async function refreshCurrentRaffle() {
  if (!currentRaffle) return;
  currentRaffle = await api(`/raffles/${currentRaffle.id}`);
  await loadRaffles();
  renderCurrentRaffle();
}

document.getElementById('btnAddParticipant').addEventListener('click', async () => {
  const name = document.getElementById('participantName').value.trim();
  const tickets = document.getElementById('participantTickets').value || 1;
  if (!currentRaffle) return alert('Primero selecciona o crea una rifa');
  if (!name) return alert('Escribe un nombre');

  await api(`/raffles/${currentRaffle.id}/participants`, {
    method: 'POST',
    body: JSON.stringify({ name, tickets }),
  });
  document.getElementById('participantName').value = '';
  document.getElementById('participantTickets').value = 1;
  await refreshCurrentRaffle();
});

document.getElementById('btnBulkAdd').addEventListener('click', async () => {
  const text = document.getElementById('bulkText').value.trim();
  if (!currentRaffle) return alert('Primero selecciona o crea una rifa');
  if (!text) return;

  await api(`/raffles/${currentRaffle.id}/participants/bulk`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
  document.getElementById('bulkText').value = '';
  await refreshCurrentRaffle();
});

document.getElementById('btnClearParticipants').addEventListener('click', async () => {
  if (!currentRaffle) return;
  if (!confirm('¿Vaciar todos los participantes de esta rifa?')) return;
  await api(`/raffles/${currentRaffle.id}/participants`, { method: 'DELETE' });
  await refreshCurrentRaffle();
});

// ================== Crear rifa ==================
document.getElementById('btnCreateRaffle').addEventListener('click', async () => {
  const input = document.getElementById('newRaffleName');
  const name = input.value.trim();
  if (!name) return alert('Escribe un nombre para la rifa');

  const raffle = await api('/raffles', { method: 'POST', body: JSON.stringify({ name }) });
  input.value = '';
  await loadRaffles();
  await selectRaffle(raffle.id);
});

// ================== Configuración ==================
document.getElementById('configForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentRaffle) return alert('Primero selecciona o crea una rifa');

  const config = {
    spinDurationMs: Number(document.getElementById('cfgSpinDuration').value) * 1000,
    allowRepeatWinners: document.getElementById('cfgAllowRepeat').checked,
    removeWinnerAfterDraw: document.getElementById('cfgRemoveWinner').checked,
    theme: document.getElementById('cfgTheme').value,
  };

  currentRaffle = await api(`/raffles/${currentRaffle.id}`, {
    method: 'PUT',
    body: JSON.stringify({ config }),
  });
  drawWheel();
  alert('Configuración guardada ✅');
});

// ================== Historial de ganadores ==================
function getCurrentWinners() {
  return Array.isArray(currentRaffle && currentRaffle.winners) ? currentRaffle.winners : [];
}

function updateWinnersActions() {
  const hasWinners = getCurrentWinners().length > 0;
  document.getElementById('btnExportWinners').disabled = !hasWinners;
  document.getElementById('btnResetWinners').disabled = !hasWinners;
}

function renderWinnersList() {
  const list = document.getElementById('winnersList');
  list.innerHTML = '';
  getCurrentWinners().forEach((w) => {
    const li = document.createElement('li');
    const date = new Date(w.drawnAt).toLocaleTimeString();
    li.textContent = `${w.name} — ${date}`;
    list.appendChild(li);
  });
  updateWinnersActions();
}

function escapeCsvValue(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildWinnersCsv() {
  const winners = getCurrentWinners();
  const rows = [
    ['Rifa', 'Ganador', 'ID participante', 'Fecha ISO'],
    ...winners.map((winner) => [
      currentRaffle.name,
      winner.name,
      winner.participantId,
      winner.drawnAt,
    ]),
  ];

  return '\uFEFF' + rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
}

function getWinnersExportFileName() {
  const raffleName = currentRaffle && currentRaffle.name != null ? String(currentRaffle.name) : '';
  const safeName = raffleName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${safeName || 'rifa'}-ganadores.csv`;
}

document.getElementById('btnExportWinners').addEventListener('click', () => {
  if (!currentRaffle) return alert('Primero selecciona o crea una rifa');
  if (getCurrentWinners().length === 0) return alert('No hay ganadores para exportar');

  const blob = new Blob([buildWinnersCsv()], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = getWinnersExportFileName();
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
});

document.getElementById('btnResetWinners').addEventListener('click', async () => {
  if (!currentRaffle) return;
  if (!confirm('¿Borrar el historial de ganadores?')) return;
  await api(`/raffles/${currentRaffle.id}/reset-winners`, { method: 'POST' });
  await refreshCurrentRaffle();
});

// ================== Dibujo de la ruleta ==================
function drawWheel(rotation = currentRotation) {
  const participants = currentRaffle ? currentRaffle.participants : [];
  const size = canvas.width;
  const center = size / 2;
  const radius = center - 6;

  ctx.clearRect(0, 0, size, size);

  if (participants.length === 0) {
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#2a2f57';
    ctx.fill();
    ctx.fillStyle = '#9aa0b4';
    ctx.font = '16px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText('Agrega participantes', center, center);
    return;
  }

  const totalTickets = participants.reduce((sum, p) => sum + (p.tickets || 1), 0);
  const theme = THEMES[(currentRaffle.config && currentRaffle.config.theme) || 'classic'];

  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(rotation);

  let startAngle = 0;
  participants.forEach((p, i) => {
    const sliceAngle = ((p.tickets || 1) / totalTickets) * Math.PI * 2;
    const endAngle = startAngle + sliceAngle;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = theme[i % theme.length];
    ctx.fill();

    // Texto
    ctx.save();
    ctx.rotate(startAngle + sliceAngle / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#0f1220';
    ctx.font = 'bold 14px Segoe UI';
    ctx.fillText(truncate(p.name, 16), radius - 10, 5);
    ctx.restore();

    startAngle = endAngle;
  });

  ctx.restore();

  // Centro decorativo
  ctx.beginPath();
  ctx.arc(center, center, 22, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1e33';
  ctx.fill();
  ctx.strokeStyle = '#ffb347';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// ================== Giro de la ruleta ==================
document.getElementById('btnSpin').addEventListener('click', spinWheel);

async function spinWheel() {
  if (!currentRaffle || isSpinning) return;
  if (currentRaffle.participants.length === 0) return alert('No hay participantes');

  isSpinning = true;
  document.getElementById('btnSpin').disabled = true;
  document.getElementById('winnerBanner').classList.add('hidden');

  let result;
  try {
    result = await api(`/raffles/${currentRaffle.id}/draw`, { method: 'POST' });
  } catch (err) {
    alert(err.message);
    isSpinning = false;
    document.getElementById('btnSpin').disabled = false;
    return;
  }

  const participants = currentRaffle.participants; // lista previa al sorteo (incluye ganador)
  const totalTickets = participants.reduce((sum, p) => sum + (p.tickets || 1), 0);

  // Ángulo acumulado hasta el inicio de la porción ganadora
  let angleBeforeWinner = 0;
  for (let i = 0; i < result.winnerIndex; i++) {
    angleBeforeWinner += ((participants[i].tickets || 1) / totalTickets) * Math.PI * 2;
  }
  const winnerSliceAngle = ((participants[result.winnerIndex].tickets || 1) / totalTickets) * Math.PI * 2;
  const targetMiddleAngle = angleBeforeWinner + winnerSliceAngle / 2;

  // El puntero apunta hacia arriba (-PI/2). Se calcula la rotación final para
  // que el centro de la porción ganadora quede bajo el puntero.
  const config = currentRaffle.config;
  const extraSpins = (config.minSpins || 5) + Math.floor(Math.random() * 3);
  const targetRotation =
    extraSpins * Math.PI * 2 + (-Math.PI / 2 - targetMiddleAngle);

  const duration = config.spinDurationMs || 6000;
  const startRotation = currentRotation;
  const deltaRotation = targetRotation - (startRotation % (Math.PI * 2)) - Math.floor(startRotation / (Math.PI * 2)) * (Math.PI * 2);
  // Aseguramos giro siempre hacia adelante desde la rotación actual
  const finalRotation = startRotation + extraSpins * Math.PI * 2 + normalizeAngleDelta(startRotation, targetMiddleAngle);

  const startTime = performance.now();

  function animate(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(t);
    currentRotation = startRotation + (finalRotation - startRotation) * eased;
    drawWheel(currentRotation);

    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      onSpinComplete(result);
    }
  }

  requestAnimationFrame(animate);
}

// Calcula cuánto falta girar (en radianes, siempre positivo) para que la
// porción indicada quede alineada bajo el puntero superior.
function normalizeAngleDelta(currentRot, targetMiddleAngle) {
  const pointerAngle = -Math.PI / 2;
  const currentEffective = currentRot % (Math.PI * 2);
  let needed = pointerAngle - targetMiddleAngle - currentEffective;
  needed = ((needed % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return needed;
}

async function onSpinComplete(result) {
  isSpinning = false;
  const banner = document.getElementById('winnerBanner');
  banner.textContent = `🎉 ¡Ganador: ${result.winner.name}! 🎉`;
  banner.classList.remove('hidden');

  await refreshCurrentRaffle();
  document.getElementById('btnSpin').disabled = currentRaffle.participants.length < 2 && !currentRaffle.config.allowRepeatWinners;
  if (currentRaffle.config.allowRepeatWinners || currentRaffle.participants.length >= 1) {
    document.getElementById('btnSpin').disabled = currentRaffle.participants.length === 0;
  }
}

// ================== Inicio ==================
loadRaffles();
