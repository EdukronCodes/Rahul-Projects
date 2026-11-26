# DashDish — Food Delivery and Restaurant Order Management

A runnable food-ordering experience with a restaurant order desk. The Azure edition includes an Azure DevOps pipeline, Azure Container Apps, Azure Container Registry, and Azure Database for PostgreSQL infrastructure.

## Features

- Browse a seeded menu, build a cart, and place delivery orders.
- Follow an order through a validated restaurant status workflow.
- Review customer orders and update their status at the restaurant desk.
- Persist menu, order, and line-item data in PostgreSQL (SQLite is available for tests and quick local runs).
- Run as a non-root container; health endpoint at `/api/health`.

## Run locally

Requires Docker Compose.

```bash
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080). Orders are saved in the `food_data` volume. To stop: `docker compose down`; to also delete local data, explicitly remove the volume with `docker compose down -v`.

For a Python-only run, install `requirements.txt` and set `DATABASE_URL` (or omit it to use local SQLite), then run `python app.py`. Run tests with `pytest -q`.

## Azure DevOps deployment

1. Create an Azure Resource Group, Azure Container Registry, and Azure DevOps service connections for Azure Resource Manager and the registry.
2. Set pipeline variables `AZURE_SERVICE_CONNECTION`, `ACR_SERVICE_CONNECTION`, `ACR_LOGIN_SERVER`, `ACR_USERNAME`, `ACR_PASSWORD`, `AZURE_RESOURCE_GROUP`, `AZURE_LOCATION`, and `AZURE_APP_NAME`. Mark credentials and `FOOD_DB_PASSWORD` secret.
3. Ensure the container registry exists before the pipeline's image-push step. The Bicep template creates the registry as well; for an initial run, create it first or split infrastructure provisioning from image publishing.
4. Add `food-delivery-azure/azure-pipelines.yml` as the pipeline definition and run it from `main`.

The pipeline runs tests and builds the image on every branch, then provisions the app on `main`. For production, replace the registry admin credentials with managed identity/federated credentials, put database secrets in Key Vault, and restrict PostgreSQL network access to the app environment rather than enabling broad public access.
