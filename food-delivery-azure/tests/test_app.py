import pytest

from app import create_app, db


@pytest.fixture()
def client():
    app = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite://",
    })
    with app.test_client() as client:
        yield client
    with app.app_context():
        db.session.remove()
        db.drop_all()


def test_menu_is_seeded_and_health_checks_database(client):
    assert client.get("/api/health").json == {"status": "ok"}
    assert len(client.get("/api/menu").json) >= 1


def test_order_total_is_server_calculated_and_statuses_follow_workflow(client):
    menu_item = client.get("/api/menu").json[0]
    response = client.post("/api/orders", json={
        "customer_name": "Ari",
        "delivery_address": "10 Market Street",
        "items": [{"menu_item_id": menu_item["id"], "quantity": 2}],
    })
    assert response.status_code == 201
    order = response.json
    assert order["total_cents"] == menu_item["price_cents"] * 2
    assert client.patch(f"/api/orders/{order['id']}", json={"status": "accepted"}).status_code == 200
    assert client.patch(f"/api/orders/{order['id']}", json={"status": "delivered"}).status_code == 400


@pytest.mark.parametrize("payload", [
    {},
    {"customer_name": "Ari", "delivery_address": "Address", "items": [{"menu_item_id": 1, "quantity": 0}]},
    {"customer_name": "Ari", "delivery_address": "Address", "items": [{"menu_item_id": 999, "quantity": 1}]},
])
def test_invalid_orders_are_rejected(client, payload):
    assert client.post("/api/orders", json=payload).status_code == 400
