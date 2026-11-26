import pytest

from app import create_app, db


@pytest.fixture()
def client():
    app = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite://",
        "ADMIN_TOKEN": "test-admin",
    })
    with app.test_client() as client:
        yield client
    with app.app_context():
        db.session.remove()
        db.drop_all()


def test_catalog_inventory_and_health(client):
    assert client.get("/api/health").json == {"status": "ok"}
    products = client.get("/api/products").json
    assert len(products) >= 1
    assert client.get("/api/products?category=Home").json[0]["category"] == "Home"


def test_order_decrements_stock_and_cancellation_restores_it(client):
    product = client.get("/api/products").json[0]
    original_stock = product["stock"]
    response = client.post("/api/orders", json={
        "customer_name": "Ari",
        "email": "ari@example.com",
        "shipping_address": "10 Market Street",
        "items": [{"product_id": product["id"], "quantity": 2}],
    })
    assert response.status_code == 201
    order = response.json
    assert order["total_cents"] == product["price_cents"] * 2
    assert client.get("/api/inventory").json[0]["stock"] == original_stock - 2
    assert client.patch(
        f"/api/orders/{order['id']}",
        json={"status": "cancelled"},
        headers={"X-Admin-Token": "test-admin"},
    ).status_code == 200
    assert client.get("/api/inventory").json[0]["stock"] == original_stock


def test_out_of_stock_order_does_not_change_inventory(client):
    product = client.get("/api/products").json[0]
    client.put(f"/api/inventory/{product['id']}", json={"stock": 0}, headers={"X-Admin-Token": "test-admin"})
    response = client.post("/api/orders", json={
        "customer_name": "Ari",
        "email": "ari@example.com",
        "shipping_address": "10 Market Street",
        "items": [{"product_id": product["id"], "quantity": 1}],
    })
    assert response.status_code == 409
    assert client.get("/api/inventory").json[0]["stock"] == 0


def test_order_lookup_and_management_require_correct_identity(client):
    product = client.get("/api/products").json[0]
    response = client.post("/api/orders", json={
        "customer_name": "Ari",
        "email": "ari@example.com",
        "shipping_address": "10 Market Street",
        "items": [{"product_id": product["id"], "quantity": 1}],
    })
    order = response.json
    assert client.get("/api/orders").status_code == 401
    assert client.get("/api/orders", headers={"X-Admin-Token": "test-admin"}).status_code == 200
    lookup = client.post("/api/orders/lookup", json={"order_id": order["id"], "email": "ari@example.com"})
    assert lookup.status_code == 200
    assert "email" not in lookup.json
    assert client.post("/api/orders/lookup", json={"order_id": order["id"], "email": "wrong@example.com"}).status_code == 404
    assert client.put(f"/api/inventory/{product['id']}", json={"stock": 5}).status_code == 401


@pytest.mark.parametrize("payload", [
    {},
    {"customer_name": "Ari", "email": "ari@example.com", "shipping_address": "Somewhere", "items": [{"product_id": 1, "quantity": 0}]},
    {"customer_name": "Ari", "email": "ari@example.com", "shipping_address": "Somewhere", "items": [{"product_id": 999, "quantity": 1}]},
])
def test_invalid_orders_are_rejected(client, payload):
    assert client.post("/api/orders", json=payload).status_code == 400


def test_non_object_json_is_rejected(client):
    assert client.post("/api/orders", json=[]).status_code == 400
    assert client.post("/api/orders/lookup", json=[]).status_code == 400
    assert client.put("/api/inventory/1", json=[], headers={"X-Admin-Token": "test-admin"}).status_code == 400
