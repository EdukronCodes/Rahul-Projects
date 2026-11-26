const money = cents => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
const cart = new Map();
const icons = ["🍕", "🍔", "🥗", "🥬", "🍜", "🌮", "🥪", "🍰"];
const statuses = ["placed", "accepted", "preparing", "ready", "out_for_delivery", "delivered", "cancelled"];
let menu = [];

async function api(url, options) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Something went wrong.");
  return body;
}

function renderMenu() {
  document.querySelector("#menu-grid").innerHTML = menu.map((item, index) => `
    <article class="menu-card"><div class="dish-art">${icons[index % icons.length]}</div>
      <h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description)}</p>
      <div class="card-bottom"><span class="price">${money(item.price_cents)}</span>
      <button class="add-button" data-add="${item.id}" aria-label="Add ${escapeHtml(item.name)} to bag">+</button></div>
    </article>`).join("");
}

function renderCart() {
  const count = [...cart.values()].reduce((sum, line) => sum + line.quantity, 0);
  document.querySelector("#cart-count").textContent = count;
  const container = document.querySelector("#cart-lines");
  if (!cart.size) {
    container.innerHTML = '<p class="muted">Your bag is waiting for something tasty.</p>';
    return;
  }
  const lines = [...cart.values()];
  const total = lines.reduce((sum, line) => sum + line.item.price_cents * line.quantity, 0);
  container.innerHTML = lines.map(({ item, quantity }) => `
    <div class="cart-line"><span>${escapeHtml(item.name)} <small>${money(item.price_cents)}</small></span>
      <span class="quantity-controls"><button data-quantity="${item.id}" data-change="-1" aria-label="Remove one">−</button>${quantity}<button data-quantity="${item.id}" data-change="1" aria-label="Add one">+</button></span></div>`).join("") +
    `<div class="cart-total"><span>Subtotal</span><span>${money(total)}</span></div>`;
}

function orderCard(order, manager = false) {
  const lines = order.items.map(item => `${item.quantity} × ${escapeHtml(item.name)}`).join(", ");
  const controls = manager && !["delivered", "cancelled"].includes(order.status)
    ? `<div class="manage-controls"><select aria-label="Next status for order ${order.id}">${statuses.filter(status => status !== order.status).map(status => `<option value="${status}">${status.replaceAll("_", " ")}</option>`).join("")}</select><button data-update="${order.id}">Update</button></div>`
    : `<span class="status-pill">${order.status.replaceAll("_", " ")}</span>`;
  return `<article class="order-card"><div><h3>Order #${order.id} · ${escapeHtml(order.customer_name)}</h3><p>${escapeHtml(lines)}${manager ? ` · ${escapeHtml(order.delivery_address)}` : ""}</p>${!manager ? `<span class="status-pill">${order.status.replaceAll("_", " ")}</span>` : ""}</div><div class="order-total">${money(order.total_cents)}${manager ? `<br>${controls}` : ""}</div></article>`;
}

async function refreshOrders() {
  const orders = await api("/api/orders");
  const empty = '<p class="muted">No orders yet. That’s about to change.</p>';
  document.querySelector("#orders-list").innerHTML = orders.length ? orders.map(order => orderCard(order)).join("") : empty;
  document.querySelector("#manager-list").innerHTML = orders.length ? orders.map(order => orderCard(order, true)).join("") : '<p class="muted">No active orders right now.</p>';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

document.addEventListener("click", async event => {
  const addButton = event.target.closest("[data-add]");
  const quantityButton = event.target.closest("[data-quantity]");
  const updateButton = event.target.closest("[data-update]");
  if (addButton) {
    const item = menu.find(candidate => candidate.id === Number(addButton.dataset.add));
    if (item) cart.set(item.id, { item, quantity: Math.min(20, (cart.get(item.id)?.quantity || 0) + 1) });
    renderCart();
  }
  if (quantityButton) {
    const id = Number(quantityButton.dataset.quantity);
    const line = cart.get(id);
    if (line) {
      line.quantity += Number(quantityButton.dataset.change);
      if (line.quantity < 1) cart.delete(id);
      else line.quantity = Math.min(line.quantity, 20);
    }
    renderCart();
  }
  if (updateButton) {
    const select = updateButton.parentElement.querySelector("select");
    updateButton.disabled = true;
    try {
      await api(`/api/orders/${updateButton.dataset.update}`, { method: "PATCH", body: JSON.stringify({ status: select.value }) });
      await refreshOrders();
    } catch (error) {
      alert(error.message);
    } finally {
      updateButton.disabled = false;
    }
  }
});

document.querySelector("#checkout-form").addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.querySelector("#checkout-message");
  if (!cart.size) {
    message.textContent = "Add something tasty to your bag first.";
    return;
  }
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  message.textContent = "";
  try {
    const order = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        customer_name: form.get("customer_name"),
        delivery_address: form.get("delivery_address"),
        items: [...cart.values()].map(({ item, quantity }) => ({ menu_item_id: item.id, quantity })),
      }),
    });
    cart.clear();
    event.currentTarget.reset();
    renderCart();
    message.textContent = `Order #${order.id} is in!`;
    await refreshOrders();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#refresh-orders").addEventListener("click", () => refreshOrders().catch(error => alert(error.message)));

Promise.all([api("/api/menu"), refreshOrders()])
  .then(([items]) => { menu = items; renderMenu(); })
  .catch(error => { document.querySelector("#menu-grid").innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`; });
