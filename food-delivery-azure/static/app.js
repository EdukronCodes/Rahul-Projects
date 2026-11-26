const money = cents => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
const cart = new Map();
const icons = ["🍕", "🍔", "🥗", "🥬", "🍜", "🌮", "🥪", "🍰"];
const statuses = ["placed", "accepted", "preparing", "ready", "out_for_delivery", "delivered", "cancelled"];
const nextStatuses = {
  placed: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered"],
  delivered: [],
  cancelled: [],
};
let adminToken = sessionStorage.getItem("food-admin-token") || "";
let menu = [];

async function api(url, options) {
  const headers = { "Content-Type": "application/json", ...(options?.headers || {}) };
  if (adminToken) headers["X-Admin-Token"] = adminToken;
  const response = await fetch(url, { ...options, headers });
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
  const controls = manager && nextStatuses[order.status].length
    ? `<div class="manage-controls"><select aria-label="Next status for order ${order.id}">${nextStatuses[order.status].map(status => `<option value="${status}">${status.replaceAll("_", " ")}</option>`).join("")}</select><button data-update="${order.id}">Update</button></div>`
    : `<span class="status-pill">${order.status.replaceAll("_", " ")}</span>`;
  return `<article class="order-card"><div><h3>Order #${order.id} · ${escapeHtml(order.customer_name)}</h3><p>${escapeHtml(lines)}${manager ? ` · ${escapeHtml(order.delivery_address)} · ${escapeHtml(order.email)}` : ""}</p>${!manager ? `<span class="status-pill">${order.status.replaceAll("_", " ")}</span>` : ""}</div><div class="order-total">${money(order.total_cents)}${manager ? `<br>${controls}` : ""}</div></article>`;
}

async function refreshOrders() {
  const orders = await api("/api/orders");
  document.querySelector("#manager-list").innerHTML = orders.length ? orders.map(order => orderCard(order, true)).join("") : '<p class="muted">No active orders right now.</p>';
}

function showTrackedOrder(order) {
  document.querySelector("#order-status").innerHTML = `<article class="order-card"><div><h3>Order #${order.id}</h3><p>${order.items.map(item => `${item.quantity} × ${escapeHtml(item.name)}`).join(", ")}</p><span class="status-pill">${order.status.replaceAll("_", " ")}</span></div><div class="order-total">${money(order.total_cents)}</div></article>`;
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

document.querySelector("#lookup-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const result = document.querySelector("#order-status");
  result.textContent = "Looking up your order…";
  try {
    const order = await api("/api/orders/lookup", {
      method: "POST",
      body: JSON.stringify({ order_id: Number(form.get("order_id")), email: form.get("email") }),
    });
    showTrackedOrder(order);
  } catch (error) {
    result.textContent = error.message;
  }
});

document.querySelector("#admin-login").addEventListener("click", async () => {
  const input = document.querySelector("#admin-token");
  const message = document.querySelector("#admin-message");
  adminToken = input.value;
  try {
    await refreshOrders();
    sessionStorage.setItem("food-admin-token", adminToken);
    input.value = "";
    message.textContent = "Restaurant desk unlocked for this browser session.";
  } catch (error) {
    adminToken = "";
    sessionStorage.removeItem("food-admin-token");
    message.textContent = error.message;
  }
});

document.querySelector("#admin-logout").addEventListener("click", () => {
  adminToken = "";
  sessionStorage.removeItem("food-admin-token");
  document.querySelector("#manager-list").innerHTML = '<p class="muted">Unlock the desk to view restaurant orders.</p>';
  document.querySelector("#admin-message").textContent = "Restaurant desk locked.";
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
        email: form.get("email"),
        delivery_address: form.get("delivery_address"),
        items: [...cart.values()].map(({ item, quantity }) => ({ menu_item_id: item.id, quantity })),
      }),
    });
    cart.clear();
    event.currentTarget.reset();
    renderCart();
    message.textContent = `Order #${order.id} is in!`;
    showTrackedOrder(order);
    document.querySelector("#orders").scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#refresh-orders").addEventListener("click", () => refreshOrders().catch(error => {
  document.querySelector("#admin-message").textContent = error.message;
}));

api("/api/menu")
  .then(items => {
    menu = items;
    renderMenu();
  })
  .catch(error => { document.querySelector("#menu-grid").innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`; });

if (adminToken) {
  refreshOrders()
    .then(() => { document.querySelector("#admin-message").textContent = "Restaurant desk unlocked for this browser session."; })
    .catch(error => {
      adminToken = "";
      sessionStorage.removeItem("food-admin-token");
      document.querySelector("#admin-message").textContent = error.message;
    });
}
