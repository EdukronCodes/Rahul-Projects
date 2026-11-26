# Field & Form — Retail E-Commerce and Inventory Management

Field & Form is a full-stack commerce and stockroom MVP. Customers browse a categorized catalog, add products to a bag, place orders, and look up fulfillment status. Store staff use a token-protected merchant desk to manage inventory and order status.

The AWS edition uses Flask, PostgreSQL, Docker, Amazon EKS, Amazon ECR, Amazon RDS, AWS Secrets Manager, Terraform modules, Kubernetes/Kustomize, and GitHub Actions OIDC CI/CD.

## Features

- Responsive catalog, category filters, cart, checkout, and order lookup with order number + email.
- Order workflow and status transitions; inventory decrements during checkout and is restored when an order is cancelled.
- Merchant-only inventory updates and order fulfillment actions, protected by a shared high-entropy admin token.
- Transaction-safe product stock checks, integer-cent totals, PostgreSQL cloud persistence, and isolated SQLite tests.
- Docker Compose local environment, non-root production image, health endpoint, Python tests.
- Terraform-managed EKS, ECR, encrypted/private RDS PostgreSQL, two-AZ VPC, Secrets Manager credentials, and EKS access entry.
- Kubernetes restricted pod security, probes, resources, Service/Ingress, NetworkPolicy, HPA, and PDB.
- GitHub Actions test-on-PR and main-branch Terraform/build/deploy workflow using AWS OIDC.

This is a portfolio/demo MVP, not a payment-ready production store. It has no customer accounts, payment processor, email/shipping integrations, product editing, or per-user merchant roles. Replace the shared admin token with an identity provider and role-based authorization before public production use.

## Run locally

### Docker Compose (recommended)

Requirements: Docker Engine and Docker Compose.

```bash
cd retail-ecommerce-aws
docker compose up --build
```

Open [http://localhost:8081](http://localhost:8081). The local demo merchant token is `local-dev-change-me`; enter it under **Merchant desk**. Never reuse this token in AWS. PostgreSQL data persists in the `retail_data` volume.

Stop with `docker compose down`. To intentionally remove the local database volume, run `docker compose down -v`.

### Python-only run

Requires Python 3.12. If `DATABASE_URL` is unset, the app uses local SQLite.

```bash
cd retail-ecommerce-aws
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
export ADMIN_TOKEN='replace-with-a-long-local-secret'
python app.py
```

Open `http://localhost:8080`. Set `DATABASE_URL` or the separate `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` variables to use PostgreSQL.

## Application and API flow

1. `GET /api/products` returns products (optionally filtered by category); `GET /api/inventory` returns stock counts for storefront availability.
2. `POST /api/orders` validates checkout fields, product IDs, and quantities. It locks matching product rows, checks stock, recalculates totals in integer cents, creates order lines, and decrements stock in one database transaction.
3. `POST /api/orders/lookup` validates the order number and checkout email, then returns only the fulfillment state, total, and line items—not customer contact/address fields.
4. The merchant enters `ADMIN_TOKEN`. `GET /api/orders`, `PATCH /api/orders/<id>`, and `PUT /api/inventory/<id>` require the `X-Admin-Token` header.
5. Order transitions are validated: `placed → processing → shipped → delivered`; cancellation is permitted before dispatch and restores ordered quantities to inventory.
6. `/api/health` executes a database query to verify readiness.

The shared-token mechanism is deliberately simple for this learning project. Use HTTPS, a secret manager, rotation, audit logs, and OIDC/role-based authorization in a production build.

## Tests

```bash
cd retail-ecommerce-aws
python -m pip install -r requirements.txt
pytest -q
```

Tests cover catalog/health, order totals, stock reservation/restoration, out-of-stock conflicts, order lookup privacy, management authorization, and invalid input.

## AWS end-to-end deployment flow

### Architecture

```text
GitHub Actions
  ├─ Pull request: pytest
  └─ main branch: OIDC deployment role
      ├─ Terraform remote state: encrypted S3 + DynamoDB lock table
      ├─ VPC: public/private subnets, IGW, NAT gateway
      ├─ EKS control plane + private managed node group
      ├─ ECR repository + image scanning/lifecycle policy
      ├─ Private encrypted RDS PostgreSQL + Secrets Manager
      ├─ Build/push immutable SHA-tagged container image
      └─ Helm ingress-nginx + Kubernetes secret + Kustomize rollout
```

### One-time prerequisites

1. Install AWS CLI, Terraform 1.6+, `kubectl`, Helm 3, Docker, and `jq` (GitHub-hosted runners include the common tools).
2. Choose an AWS account/region with EKS, EC2, ECR, RDS, VPC, and IAM quotas. EKS, EC2 nodes, NAT gateway, RDS, and load balancers cost money.
3. Create an encrypted, versioned S3 bucket and a DynamoDB table with partition key `LockID` (string) for Terraform backend state/locking. Restrict access: state contains the generated database password.
4. Configure the GitHub OIDC provider `token.actions.githubusercontent.com` in IAM if it is not already present.
5. Create a dedicated IAM role for GitHub Actions. Its trust relationship must restrict `sub` to `repo:OWNER/REPOSITORY:ref:refs/heads/main` and the audience to `sts.amazonaws.com`. Attach only the permissions required to manage the Terraform resources, ECR images, Secrets Manager read, and EKS cluster access. Terraform adds this role to EKS with cluster-admin rights.
6. Set repository secret `AWS_DEPLOY_ROLE_ARN` to that role's ARN.
7. Set repository variables:

| Variable | Example | Purpose |
|---|---|---|
| `AWS_REGION` | `us-east-1` | Deployment region |
| `TF_PROJECT_NAME` | `retail` | Lowercase resource-name prefix |
| `TF_ENVIRONMENT` | `dev` | `dev`, `staging`, or `prod` |
| `TF_STATE_BUCKET` | `company-platform-tfstate` | Existing encrypted/versioned S3 backend bucket |
| `TF_STATE_LOCK_TABLE` | `terraform-locks` | Existing DynamoDB lock table |
| `SHOP_HOST` | `shop.example.com` | Public DNS host for the ingress |

8. Configure a DNS CNAME for `SHOP_HOST` to the ingress controller's AWS load-balancer hostname after the initial ingress service is created. Configure/verify TLS for the hostname before entering administrator credentials over the public internet.

### Pipeline flow

The workflow is [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml):

1. Every pull request runs application tests only.
2. A push to `main` gets temporary AWS credentials through GitHub OIDC; no long-lived AWS access key is stored in GitHub.
3. Terraform initializes against the pre-created S3/DynamoDB backend and provisions/updates network, EKS, ECR, RDS, credentials, and cluster access.
4. The workflow builds the app image, tags it with the Git commit SHA (immutable), scans it through ECR on push, and publishes it.
5. The workflow connects `kubectl` to EKS, installs nginx ingress, fetches the database/admin credentials from Secrets Manager into a short-lived runner file, and creates/updates a Kubernetes Secret. The file is mode-restricted and removed by a shell trap; the secret is not printed.
6. Kustomize applies the cluster resources, sets the exact immutable image tag and configured ingress host, waits for rollout, and reports service/ingress/pod/HPA state.

### Manual Terraform deployment

See [infra/terraform/README.md](./infra/terraform/README.md). Set the AWS deployment role ARN and configure the remote S3 backend values before `terraform init`. The Terraform-generated RDS password and admin token are stored as a JSON value in Secrets Manager and in Terraform state; secure both.

### Kubernetes operations

See [k8s/README.md](./k8s/README.md) for manual secret setup, apply/rollout, access, logs, and rollback commands. The database is external RDS; there is no stateful in-cluster database in the production manifests. The deployment uses restricted pod security, non-root execution, resource bounds, health probes, two baseline replicas, autoscaling, and disruption budget.

## Security and production notes

- RDS is encrypted, private, and accepts PostgreSQL only from the EKS cluster security group. TLS is required by the application database client.
- The Kubernetes Secret is a convenience for this demo. For production, integrate AWS Secrets Manager through External Secrets/CSI and IRSA; enable EKS secret encryption and restrict RBAC.
- The EKS public API endpoint is authenticated by IAM but currently open to public source IPs; restrict CIDRs or disable public access for production.
- Configure TLS at ingress before using the admin token. Hostnames in manifests are examples.
- `create_all()` is used for this demo; use Alembic database migrations for production schema changes.
- Review the Terraform plan, quotas, ingress DNS/TLS, backups, logging, image scans, network policy/CNI behavior, and costs. Destroying Terraform resources can permanently delete order/inventory data; back up first.
