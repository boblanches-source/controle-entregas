const API_BASE = 'https://controle-entregas-owfe.onrender.com';
const socket = io(API_BASE, { transports: ['websocket', 'polling'] });

const state = {
  orders: [],
  finishingOrderId: null,
  darkMode: true,
};

const connectionStatus = document.getElementById('connectionStatus');
const ordersContainer = document.getElementById('ordersContainer');
const refreshBtn = document.getElementById('refreshBtn');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const receiptTemplate = document.getElementById('receiptTemplate');

function statusLabel(status) {
  const map = {
    aguardando: 'Aguardando',
    em_rota: 'Em Rota',
    entregue: 'Entregue',
  };
  return map[status] || status;
}

function statusBadgeClass(status) {
  if (status === 'em_rota') return 'online';
  if (status === 'entregue') return 'offline';
  return 'badge';
}

function paymentLabel(value) {
  return value || '-';
}

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function parseMoneyInput(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.\-]/g, '');

  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function moneyToInput(value) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return num.toFixed(2).replace('.', ',');
}

function isDarkMode() {
  return state.darkMode;
}

function applyTheme() {
  document.body.classList.toggle('dark', isDarkMode());
  themeToggleBtn.textContent = isDarkMode() ? 'Modo claro' : 'Modo escuro';
  localStorage.setItem('motoboy-theme', isDarkMode() ? 'dark' : 'light');
}

function toggleTheme() {
  state.darkMode = !state.darkMode;
  applyTheme();
}

function upsertOrder(order) {
  const index = state.orders.findIndex((item) => item.id === order.id);

  if (index >= 0) {
    state.orders[index] = { ...state.orders[index], ...order };
  } else {
    state.orders.unshift(order);
  }

  state.orders.sort((a, b) => b.id - a.id);
  renderOrders();
}

function setOrders(orders) {
  state.orders = [...orders].sort((a, b) => b.id - a.id);
  renderOrders();
}

function removeOrder(id) {
  state.orders = state.orders.filter((order) => order.id !== id);
  if (state.finishingOrderId === id) {
    state.finishingOrderId = null;
  }
  renderOrders();
}

async function loadOrders() {
  const response = await fetch(`${API_BASE}/api/orders/active`);
  if (!response.ok) throw new Error('Falha ao carregar pedidos ativos.');
  const orders = await response.json();
  setOrders(orders);
}

function updateToggleVisuals() {
  document.querySelectorAll('.choice-grid').forEach((grid) => {
    grid.querySelectorAll('label.choice').forEach((label) => {
      const input = label.querySelector('input');
      if (!input) return;
      label.classList.toggle('is-selected', input.checked);
    });
  });
}

function effectiveMethod(order) {
  return order.paid_at_counter ? order.initial_payment_method : order.final_payment_method;
}

function hasCashCollection(order) {
  return !order.paid_at_counter && order.initial_payment_method === 'Dinheiro';
}

function renderOrders() {
  const activeOrders = state.orders.filter((order) => order.status !== 'entregue');

  if (!activeOrders.length) {
    ordersContainer.innerHTML = `<div class="empty">Nenhum pedido ativo no momento.</div>`;
    updateToggleVisuals();
    return;
  }

  ordersContainer.innerHTML = activeOrders.map(renderCard).join('');
  updateToggleVisuals();
}

function renderCard(order) {
  const isFinishing = state.finishingOrderId === order.id;
  const paidAtCounter = Boolean(order.paid_at_counter);
  const orderMethod = slugify(order.initial_payment_method);
  const hasObservation = Boolean(order.observations && String(order.observations).trim());
  const deliveredAt = order.delivered_at ? formatDateTime(order.delivered_at) : '-';
  const paymentLabelText = paidAtCounter ? 'Pago no balcão' : 'Na entrega';

  return `
    <article class="order-card ${paidAtCounter ? 'paid-true' : ''} status-${order.status} method-${orderMethod}">
      <div class="order-head">
        <div>
          <div class="customer">#${order.id} · ${escapeHtml(order.customer_name)}</div>
          <div class="meta">
            Valor: <strong>${formatMoney(order.order_value || 0)}</strong><br />
            Pagamento: <strong>${paymentLabel(order.initial_payment_method)}</strong><br />
            Situação: <strong>${paymentLabelText}</strong><br />
            Bebida: <strong>${order.has_drink ? 'Sim' : 'Não'}</strong><br />
            Troco: <strong>${order.needs_change ? 'Sim' : 'Não'}</strong><br />
            Status: <strong>${statusLabel(order.status)}</strong><br />
            ${order.final_payment_method ? `Pagamento final: <strong>${paymentLabel(order.final_payment_method)}</strong><br />` : ''}
            ${order.final_payment_method === 'Dinheiro' && order.cash_received != null ? `Recebido: <strong>${formatMoney(order.cash_received)}</strong><br />` : ''}
            ${order.final_payment_method === 'Dinheiro' && order.cash_change != null ? `Troco: <strong>${formatMoney(order.cash_change)}</strong><br />` : ''}
            ${order.delivered_at ? `Hora da entrega: <strong>${deliveredAt}</strong><br />` : ''}
          </div>
        </div>
        <div class="badge ${statusBadgeClass(order.status)}">${statusLabel(order.status)}</div>
      </div>

      <div class="pill-row">
        ${paidAtCounter ? '<span class="pill green">Pago</span>' : '<span class="pill purple">Pagar na entrega</span>'}
        ${order.has_drink ? '<span class="pill blue">Com bebida</span>' : '<span class="pill gray">Sem bebida</span>'}
        ${order.needs_change ? '<span class="pill warn">Com troco</span>' : '<span class="pill gray">Sem troco</span>'}
        ${order.status === 'aguardando' ? '<span class="pill warn">Aguardando partida</span>' : ''}
        ${order.status === 'em_rota' ? '<span class="pill blue">Em rota</span>' : ''}
        ${order.status === 'entregue' ? '<span class="pill green">Entregue</span>' : ''}
      </div>

      ${hasObservation ? `<div class="order-notes"><strong>Observações:</strong> ${escapeHtml(order.observations)}</div>` : ''}

      <div class="actions">
        ${
          order.status === 'aguardando'
            ? `<button class="btn success" data-action="start" data-id="${order.id}">Iniciar Rota</button>`
            : ''
        }

        ${
          order.status !== 'entregue'
            ? `
              <button class="btn warn" data-action="open-finish" data-id="${order.id}">
                Finalizar Entrega
              </button>
            `
            : ''
        }
      </div>

      ${
        isFinishing
          ? `
            <div class="inline">
              ${
                paidAtCounter
                  ? `
                    <div class="cash-box">
                      <strong>Pedido pago no balcão.</strong>
                      <div class="summary-note">Somente confirme a entrega no endereço do cliente.</div>
                    </div>
                  `
                  : `
                    <div class="cash-box">
                      <label style="display:block; font-size:13px; font-weight:700; color:var(--muted);">
                        Forma de pagamento final
                      </label>
                      <select id="payment-${order.id}" data-order-id="${order.id}">
                        <option value="">Selecione</option>
                        <option>Dinheiro</option>
                        <option>Cartão</option>
                        <option>Pix</option>
                      </select>

                      <div id="cashFields-${order.id}" style="display:none;" class="cash-grid">
                        <div>
                          <label style="display:block; font-size:13px; font-weight:700; color:var(--muted); margin-bottom:6px;">Quanto recebeu</label>
                          <input id="received-${order.id}" inputmode="decimal" placeholder="Ex.: 50,00" />
                        </div>
                        <div>
                          <label style="display:block; font-size:13px; font-weight:700; color:var(--muted); margin-bottom:6px;">Quanto deu de troco</label>
                          <input id="change-${order.id}" inputmode="decimal" placeholder="Ex.: 7,00" readonly />
                        </div>
                      </div>

                      <div class="summary-note">O troco é calculado automaticamente com base no valor do pedido.</div>
                    </div>
                  `
              }

              <button class="btn success" data-action="confirm-finish" data-id="${order.id}">
                Confirmar Entrega e Imprimir 58mm
              </button>
              <button class="btn secondary" data-action="cancel-finish" data-id="${order.id}">
                Cancelar
              </button>
            </div>
          `
          : ''
      }
    </article>
  `;
}

function updateCashFieldsVisibility(orderId) {
  const select = document.getElementById(`payment-${orderId}`);
  const cashFields = document.getElementById(`cashFields-${orderId}`);
  if (!select || !cashFields) return;
  cashFields.style.display = select.value === 'Dinheiro' ? 'grid' : 'none';
}

function updateChangeCalculation(orderId) {
  const order = state.orders.find((item) => item.id === Number(orderId));
  if (!order) return;

  const receivedInput = document.getElementById(`received-${orderId}`);
  const changeInput = document.getElementById(`change-${orderId}`);
  if (!receivedInput || !changeInput) return;

  const received = parseMoneyInput(receivedInput.value);
  const orderValue = Number(order.order_value || 0) || 0;

  if (received === null) {
    changeInput.value = '';
    return;
  }

  const change = received - orderValue;
  changeInput.value = change > 0 ? moneyToInput(change) : '0,00';
}

function printReceipt(order) {
  const windowRef = window.open('', '_blank', 'width=380,height=700');
  if (!windowRef) {
    alert('O navegador bloqueou a impressão. Permita pop-ups para imprimir o comprovante.');
    return;
  }

  const html = `
    <!doctype html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Comprovante 58mm</title>
      <style>
        @page { size: 58mm auto; margin: 2mm; }
        body {
          width: 58mm;
          margin: 0;
          padding: 0;
          font-family: Arial, Helvetica, sans-serif;
          color: #000;
          font-size: 10pt;
        }
        .receipt { width: 58mm; padding: 2mm; box-sizing: border-box; }
        h1 {
          font-size: 12pt;
          margin: 0 0 4px;
          text-align: center;
        }
        .center { text-align: center; }
        .line {
          border-top: 1px dashed #000;
          margin: 6px 0;
        }
        .row {
          display: flex;
          justify-content: space-between;
          gap: 6px;
          margin: 2px 0;
          word-break: break-word;
        }
        .muted {
          font-size: 9pt;
        }
        .btn {
          margin-top: 10px;
          width: 100%;
          padding: 8px 10px;
          border: 0;
          border-radius: 8px;
          background: #000;
          color: #fff;
        }
      </style>
    </head>
    <body>
      <div class="receipt">
        <h1>Bob Lanches</h1>
        <div class="center muted">Comprovante de Entrega</div>
        <div class="line"></div>
        <div class="row"><strong>Pedido</strong><span>${escapeHtml(order.id)}</span></div>
        <div class="row"><strong>Cliente</strong><span>${escapeHtml(order.customer_name)}</span></div>
        <div class="row"><strong>Pagamento</strong><span>${escapeHtml(order.final_payment_method || '-')}</span></div>
        <div class="row"><strong>Valor</strong><span>${escapeHtml(formatMoney(order.order_value))}</span></div>
        <div class="row"><strong>Hora entrega</strong><span>${escapeHtml(formatDateTime(order.delivered_at))}</span></div>
        <div class="row"><strong>Recebido</strong><span>${escapeHtml(formatMoney(order.cash_received))}</span></div>
        <div class="row"><strong>Troco</strong><span>${escapeHtml(formatMoney(order.cash_change))}</span></div>
        <div class="line"></div>
        <div class="center muted">Obrigado e volte sempre!</div>
        <button class="btn" onclick="window.print()">Imprimir</button>
      </div>
      <script>
        window.onload = function () {
          setTimeout(function () {
            window.print();
          }, 250);
        };
      </script>
    </body>
    </html>
  `;

  windowRef.document.open();
  windowRef.document.write(html);
  windowRef.document.close();
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

ordersContainer.addEventListener('change', (event) => {
  const paymentSelect = event.target.closest('select[data-order-id]');
  if (paymentSelect) {
    const orderId = paymentSelect.getAttribute('data-order-id');
    updateCashFieldsVisibility(orderId);
    return;
  }

  const receivedInput = event.target.closest('input[id^="received-"]');
  if (receivedInput) {
    const orderId = receivedInput.id.replace('received-', '');
    updateChangeCalculation(orderId);
  }
});

ordersContainer.addEventListener('input', (event) => {
  const receivedInput = event.target.closest('input[id^="received-"]');
  if (receivedInput) {
    const orderId = receivedInput.id.replace('received-', '');
    updateChangeCalculation(orderId);
  }
});

ordersContainer.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const { action, id } = button.dataset;
  const orderId = Number(id);

  if (action === 'start') {
    const response = await fetch(`${API_BASE}/api/orders/${orderId}/start`, {
      method: 'PATCH',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      alert(error.error || 'Não foi possível iniciar a rota.');
      return;
    }

    const updated = await response.json();
    upsertOrder(updated);
    return;
  }

  if (action === 'open-finish') {
    state.finishingOrderId = orderId;
    renderOrders();
    return;
  }

  if (action === 'cancel-finish') {
    state.finishingOrderId = null;
    renderOrders();
    return;
  }

  if (action === 'confirm-finish') {
    const order = state.orders.find((item) => item.id === orderId);
    const select = document.getElementById(`payment-${orderId}`);
    const finalPayment = select ? select.value : '';

    let cashReceived = null;
    let cashChange = null;

    if (!order?.paid_at_counter) {
      if (!finalPayment) {
        alert('Selecione a forma de pagamento final.');
        return;
      }

      if (finalPayment === 'Dinheiro') {
        const receivedInput = document.getElementById(`received-${orderId}`);
        const changeInput = document.getElementById(`change-${orderId}`);

        cashReceived = parseMoneyInput(receivedInput?.value);
        cashChange = parseMoneyInput(changeInput?.value);

        if (cashReceived === null) {
          alert('Informe quanto recebeu do cliente.');
          return;
        }

        if (cashChange === null) {
          alert('Informe quanto deu de troco.');
          return;
        }
      }
    }

    const response = await fetch(`${API_BASE}/api/orders/${orderId}/finish`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        final_payment_method: finalPayment,
        cash_received: cashReceived,
        cash_change: cashChange,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      alert(error.error || 'Não foi possível finalizar a entrega.');
      return;
    }

    state.finishingOrderId = null;
    const updated = await response.json();
    printReceipt(updated);
    removeOrder(updated.id);
    await loadOrders();
  }
});

refreshBtn.addEventListener('click', async () => {
  await loadOrders();
});

themeToggleBtn.addEventListener('click', toggleTheme);

socket.on('connect', () => {
  connectionStatus.textContent = 'Online';
  connectionStatus.classList.remove('offline');
  connectionStatus.classList.add('online');
  socket.emit('sync:request');
});

socket.on('disconnect', () => {
  connectionStatus.textContent = 'Offline';
  connectionStatus.classList.remove('online');
  connectionStatus.classList.add('offline');
});

socket.on('sync:orders', ({ orders }) => {
  setOrders((orders || []).filter((order) => order.status !== 'entregue'));
});

socket.on('order:created', (order) => {
  if (order.status !== 'entregue') {
    upsertOrder(order);
  }
});

socket.on('order:updated', (order) => {
  if (order.status === 'entregue') {
    removeOrder(order.id);
  } else {
    upsertOrder(order);
  }
});

socket.on('order:delivered', (order) => {
  removeOrder(order.id);
});

const savedTheme = localStorage.getItem('motoboy-theme');
if (savedTheme === 'light') {
  state.darkMode = false;
}
applyTheme();

loadOrders().catch((error) => console.error(error));
