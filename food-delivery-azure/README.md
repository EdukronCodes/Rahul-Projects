# DashDish — Food Delivery and Restaurant Order Management

DashDish is a full-stack food-ordering MVP: customers browse a menu, build a cart, place delivery orders, and look up order progress. Restaurant staff use a token-protected operations desk to review orders and advance each order through its valid fulfillment states.

The Azure edition uses Flask, PostgreSQL, Docker, Azure Kubernetes Service (AKS), Azure Container Registry (ACR), Terraform, Kubernetes/Kustomize, and an Azure DevOps YAML pipeline.

## What is included

- **Customer storefront:** responsive menu, cart, checkout, and order lookup by order number plus checkout email.
- **Restaurant desk:** order queue, address/email visibility for staff, and validated order status changes.
- **API:** menu, checkout, status lookup, health, and protected restaurant-management endpoints.
- **Persistence:** PostgreSQL in cloud/Compose; isolated SQLite databases in tests and optional Python-only local mode.
- **Container:** production Gunicorn server, non-root user, Docker Compose with PostgreSQL.
- **Platform:** reusable Terraform modules for VNet/private DNS, private PostgreSQL Flexible Server, ACR, AKS, and required access roles.
- **Kubernetes:** Kustomize base with Namespace, ConfigMap, Deployment, Service, Ingress, NetworkPolicy, HPA, PodDisruptionBudget, probes, resource bounds, and restricted pod security.
- **CI/CD:** Azure DevOps runs tests/build on PRs and provisions infrastructure, publishes the image, and deploys to AKS from `main`.

This is a portfolio/demo MVP. It does **not** process payments, provide customer accounts, send email/SMS, calculate delivery fees/tax, or expose a production-grade multi-tenant identity system. Restaurant and merchant endpoints use a shared administrator token; replace this with Entra ID/OIDC and role-based authorization before public production use.

## Run locally

### Docker Compose (recommended)

Requirements: Docker Engine and the Docker Compose plugin.

```bash
cd food-delivery-azure
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080). The demo restaurant desk token is `local-dev-change-me`; enter it under **Restaurant desk**. This token is strictly for local learning and must never be reused in Azure. Orders and menu data persist in the `food_data` Docker volume.

To stop containers, run `docker compose down`. To intentionally remove the local database volume as well, run `docker compose down -v`.

### Python-only local run

Requires Python 3.12 and PostgreSQL if using `DATABASE_URL`; otherwise SQLite is used.

```bash
cd food-delivery-azure
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
export ADMIN_TOKEN='replace-with-a-long-local-secret'
python app.py
```

Browse `http://localhost:8080`. To use PostgreSQL, set `DATABASE_URL` (or `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and `DB_SSLMODE`). Never commit local `.env` files or real credentials.

## Application and API flow

1. `GET /api/menu` returns server-priced menu items.
2. The browser builds a cart; the API independently validates each menu ID and quantity, calculates the total in cents, and creates the order.
3. `POST /api/orders/lookup` requires the order number and checkout email; it returns status and line items without exposing the delivery address or customer email.
4. Restaurant staff enter `ADMIN_TOKEN` in the desk. `GET /api/orders` and `PATCH /api/orders/<id>` require the `X-Admin-Token` header.
5. Status moves are enforced by the API: `placed → accepted → preparing → ready → out_for_delivery → delivered`; cancellation is allowed before dispatch.
6. `/api/health` executes a database query and returns `{"status":"ok"}` when the application can reach its database.

The administrator token is a shared-secret demonstration mechanism, not user authentication. Use HTTPS, a high-entropy secret, restricted access, and a real identity provider for internet-facing deployments.

## Run tests

```bash
cd food-delivery-azure
python -m pip install -r requirements.txt
pytest -q
```

The tests cover database health/menu seeding, server-calculated totals, lookup privacy, admin authorization, valid/invalid status transitions, and rejected order inputs.

## Azure end-to-end deployment flow

### Architecture

```text
Azure DevOps
  ├─ PR/main test job: pytest + Docker build
  └─ main deploy job
      ├─ Terraform remote state (Azure Blob)
      ├─ Azure VNet + private DNS + private PostgreSQL Flexible Server
      ├─ ACR + AKS (2-node autoscaling pool) + RBAC
      ├─ ACR Tasks builds/publishes the application image
      └─ kubectl/Kustomize deploys app + Kubernetes secret + ingress
```

The Terraform backend storage account and target resource group are bootstrap resources and are created once. Terraform creates the application infrastructure inside the existing target resource group. Cloud resources (AKS nodes, PostgreSQL, storage/networking, and load balancers) are billable.

### One-time prerequisites

1. Install Azure CLI, Terraform 1.6+, `kubectl`, Helm 3, and Docker for local/manual operations.
2. Create an Azure Resource Group, for example `rg-food-delivery-prod`.
3. Create a dedicated Storage Account and private blob container for Terraform state. Enable storage encryption and versioning, and grant the Azure DevOps service principal **Storage Blob Data Contributor** on the container.
4. Create an Azure Resource Manager service connection in Azure DevOps. Its service principal needs to create networking, AKS, ACR, PostgreSQL, and Azure role assignments in the subscription/resource group. Limit scope to the target subscription/resource group as appropriate.
5. Find the service principal's **object ID** (not app/client ID); Terraform assigns it ACR build/push rights and AKS RBAC Cluster Admin:

   ```bash
   az ad sp show --id '<AZURE_SERVICE_CONNECTION_APPLICATION_CLIENT_ID>' --query id --output tsv
   ```

6. Choose a globally unique 3–15 character lowercase-alphanumeric `FOOD_PROJECT_NAME` (it forms the ACR name); choose an available Azure region.
7. Choose a DNS name such as `food.example.com` and create an A record after the ingress controller obtains its public IP. Configure TLS at the ingress before entering administrator credentials over the public internet.

### Azure DevOps pipeline setup

Create an Azure DevOps variable group named `food-delivery-secrets`, authorize the pipeline to use it, and add:

| Variable | Secret? | Purpose |
|---|---:|---|
| `FOOD_DB_PASSWORD` | Yes | PostgreSQL administrator password, at least 12 characters |
| `FOOD_ADMIN_TOKEN` | Yes | High-entropy shared token for restaurant operations |

Add these pipeline variables (not secrets unless your organization requires otherwise):

| Variable | Example | Purpose |
|---|---|---|
| `AZURE_SERVICE_CONNECTION` | `sc-food-delivery-prod` | Name of the Azure Resource Manager service connection |
| `AZURE_RESOURCE_GROUP` | `rg-food-delivery-prod` | Existing resource group for Terraform-managed resources |
| `AZURE_PIPELINE_PRINCIPAL_ID` | `00000000-...` | Service principal object ID from the prerequisite above |
| `FOOD_PROJECT_NAME` | `fooddelivery123` | Unique ACR-safe project name, 3–15 lower-case letters/digits |
| `AZURE_LOCATION` | `eastus` | Azure region |
| `TF_STATE_RESOURCE_GROUP` | `rg-platform-state` | Resource group containing the pre-created Terraform state account |
| `TF_STATE_STORAGE_ACCOUNT` | `tfstatefood123` | Existing Azure Storage Account name |
| `TF_STATE_CONTAINER` | `tfstate` | Existing private Blob container name |
| `FOOD_APP_HOST` | `food.example.com` | Public hostname used by the ingress |

Add `food-delivery-azure/azure-pipelines.yml` as the pipeline definition. PRs run tests and build the Docker image. A successful `main` run:

1. Authenticates using the Azure DevOps service connection.
2. Initializes Terraform with Azure Blob remote state and applies the versioned infrastructure modules.
3. Builds the Docker image in ACR Tasks with the Azure CLI identity.
4. Retrieves AKS credentials, installs nginx ingress, and creates a Kubernetes Secret from protected pipeline variables (the secret values are not written into repository files).
5. Applies the Kustomize resources, pins the deployment to the build ID image, sets the configured ingress hostname, and waits for the AKS rollout.

### Manual Terraform deployment (optional)

For a local first deployment, follow [infra/terraform/README.md](./infra/terraform/README.md). Provide `pipeline_principal_id` and `database_password` through environment variables (`TF_VAR_pipeline_principal_id`, `TF_VAR_database_password`) or a secret manager; do not put real secrets in `terraform.tfvars`.

### Kubernetes operations

Follow [k8s/README.md](./k8s/README.md) to deploy manually, install ingress, create secrets, inspect health, and roll back. The pod runs non-root with a read-only root filesystem, a restricted seccomp profile, resource requests/limits, probes, two baseline replicas, CPU autoscaling, and a disruption budget.

## Security, limitations, and production hardening

- The Terraform database is private to the VNet; only AKS can resolve/reach it. PostgreSQL TLS is required by the app.
- The Kubernetes Secret is base64-encoded at rest by default, not encrypted application-level. Enable AKS secret encryption/Key Vault integration and restrict RBAC.
- Admin endpoints are protected by a shared token, but the application has no per-user roles, rate limiting, audit log, payment provider, or email notifications. Rotate token and use Entra ID/OIDC before wider release.
- Configure and verify TLS at nginx ingress before transmitting customer or administrator data; the checked-in host is a placeholder.
- Database schema creation uses `create_all()` for this small demo. Add versioned Alembic migrations before deploying schema changes to persistent environments.
- Review Terraform plan, quotas, IP/DNS, backups, logs, network policy support, and cost. `terraform destroy` removes cloud resources and may delete customer data; export/backup first.
