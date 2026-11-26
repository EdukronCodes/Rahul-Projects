
# Cloud DevOps Portfolio — Two End-to-End Platforms

This repository contains two independent, runnable full-stack projects. Each includes its application, frontend, REST API, database persistence, container build, automated tests, Kubernetes deployment files, cloud-specific Terraform modules, and a CI/CD pipeline:

| Project | Cloud / DevOps | Main capabilities |
|---|---|---|
| [Food Delivery & Restaurant Order Management](./food-delivery-azure/README.md) | Microsoft Azure, Azure DevOps, AKS, ACR, Terraform | Menu, cart, checkout, order tracking, restaurant fulfillment desk |
| [Retail E-Commerce & Inventory Management](./retail-ecommerce-aws/README.md) | AWS, GitHub Actions OIDC, EKS, ECR, RDS, Terraform | Product catalog, cart, checkout, order tracking, inventory/merchant desk |

Both use Python 3.12, Flask, SQLAlchemy, PostgreSQL, Docker, Kustomize, and Kubernetes. The projects are intentionally separate: each has independent app code, data model, local Compose stack, cloud infrastructure, Kubernetes namespace, and deployment workflow.

## What “end to end” includes

```text
Browser
  ├─ Catalog/menu → cart → checkout → confirmation/order tracking
  └─ Token-protected staff desk → inventory / order fulfillment
        ↓
Flask REST API + SQLAlchemy + PostgreSQL
        ↓
Docker image (non-root runtime) + /api/health + pytest suite
        ↓
Terraform cloud resources + private managed PostgreSQL + container registry
        ↓
Kubernetes Deployment/Service/Ingress/Secret/HPA/PDB/NetworkPolicy
        ↓
CI pipeline tests → builds/publishes immutable image → deploys → verifies rollout
```

## Quick start: run both apps locally

Requirements: Docker Engine and Docker Compose.

Terminal 1:

```bash
cd food-delivery-azure
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080). Local restaurant token: `local-dev-change-me`.

Terminal 2:

```bash
cd retail-ecommerce-aws
docker compose up --build
```

Open [http://localhost:8081](http://localhost:8081). Local merchant token: `local-dev-change-me`.

Each Compose app starts its own PostgreSQL container and persists data in its own named volume. The local demo tokens are deliberately convenient; never use them in a shared or cloud environment.

Stop an app with `docker compose down` from that project's directory. To also intentionally delete its local database volume, run `docker compose down -v`.

## Test the applications

Each app has an isolated test suite using SQLite in-memory databases:

```bash
cd food-delivery-azure
python -m pip install -r requirements.txt
pytest -q

cd ../retail-ecommerce-aws
python -m pip install -r requirements.txt
pytest -q
```

The Azure DevOps pipeline runs the food app tests on pull requests and main; GitHub Actions runs the retail app tests on pull requests and main.

## Project folders

```text
food-delivery-azure/
  app.py                         Flask API, models, validation, order transitions
  static/                        Responsive customer and restaurant UI
  tests/                         API and persistence tests
  Dockerfile, docker-compose.yml Local container + PostgreSQL
  azure-pipelines.yml            Azure DevOps test/build/provision/deploy pipeline
  infra/terraform/
    main.tf, variables.tf        Azure composition and inputs
    modules/network/             VNet, delegated/private database DNS
    modules/database/            Private Azure PostgreSQL Flexible Server
    modules/registry/             ACR and pipeline permissions
    modules/cluster/              AKS, autoscaling node pool, RBAC
  k8s/                           Kustomize workload, ingress, security/scaling

retail-ecommerce-aws/
  app.py                         Flask catalog, checkout, inventory/order APIs
  static/                        Responsive storefront and merchant UI
  tests/                         API, stock, authorization, workflow tests
  Dockerfile, docker-compose.yml Local container + PostgreSQL
  .github/workflows/deploy.yml   GitHub Actions OIDC Terraform/ECR/EKS workflow
  infra/terraform/
    main.tf, variables.tf        AWS composition and inputs
    modules/network/             Two-AZ VPC, subnets, IGW, NAT and routes
    modules/registry/            ECR, scan-on-push, lifecycle cleanup
    modules/cluster/              EKS control plane and managed node group
    modules/database/            Private encrypted PostgreSQL RDS
  k8s/                           Kustomize workload, ingress, security/scaling
```

The detailed [Azure project guide](./food-delivery-azure/README.md) and [AWS project guide](./retail-ecommerce-aws/README.md) explain application behavior, API flows, secrets, cloud setup, CI variables, Kubernetes operations, and production limitations. Terraform module inputs, state configuration, and manual commands are documented in each `infra/terraform/README.md`.

## End-to-end cloud deployment flow

Cloud resources are **not provisioned automatically by this repository checkout**. Before enabling a deployment pipeline, create the cloud account/project prerequisites, configure a state backend and scoped deployment identity, set pipeline secrets, and review the Terraform plan. Provisioning AKS/EKS, managed PostgreSQL, NAT gateways, and load balancers incurs ongoing charges.

### Azure: Azure DevOps → ACR → AKS

1. Create a target Azure Resource Group and a separate encrypted/versioned Azure Blob Storage account/container for Terraform state.
2. Create an Azure Resource Manager service connection; grant the service principal required infrastructure/role-assignment permissions and Blob Data Contributor on the state container.
3. Configure the `food-delivery-secrets` variable group with `FOOD_DB_PASSWORD` and `FOOD_ADMIN_TOKEN`. Add `AZURE_SERVICE_CONNECTION`, `AZURE_RESOURCE_GROUP`, `AZURE_PIPELINE_PRINCIPAL_ID`, `FOOD_PROJECT_NAME`, `AZURE_LOCATION`, `TF_STATE_RESOURCE_GROUP`, `TF_STATE_STORAGE_ACCOUNT`, `TF_STATE_CONTAINER`, `FOOD_APP_HOST`, and `ACME_EMAIL`.
4. Add `food-delivery-azure/azure-pipelines.yml` as the Azure DevOps pipeline. PRs run tests/build; successful `main` builds use Terraform to provision VNet, private Azure PostgreSQL, ACR, and AKS, then build the image, install ingress/cert-manager, create runtime secrets, and apply the Kubernetes rollout.
5. On first deployment, read the ingress public IP printed by the pipeline and create an A record for `FOOD_APP_HOST`. Re-run the pipeline after DNS resolves so cert-manager can issue a TLS certificate through Let's Encrypt HTTP-01.
6. Verify `kubectl -n food-delivery rollout status deployment/food-delivery`, the certificate, ingress, and `https://FOOD_APP_HOST`.

### AWS: GitHub Actions → ECR → EKS

1. Create an encrypted/versioned S3 Terraform state bucket and DynamoDB table (`LockID` string partition key); restrict access to the deployment role.
2. Configure GitHub's AWS OIDC provider and create a least-privilege GitHub Actions IAM role restricted to this repository's `main` branch. Save its ARN as `AWS_DEPLOY_ROLE_ARN`.
3. Configure repository variables `AWS_REGION`, `TF_PROJECT_NAME`, `TF_ENVIRONMENT`, `TF_STATE_BUCKET`, `TF_STATE_LOCK_TABLE`, `SHOP_HOST`, and `ACME_EMAIL`.
4. The [`retail-ecommerce-aws/.github/workflows/deploy.yml`](./retail-ecommerce-aws/.github/workflows/deploy.yml) runs tests on PRs. On `main`, it assumes the AWS role via OIDC, applies Terraform for VPC, private EKS workers, ECR, private encrypted RDS and Secrets Manager, publishes an immutable SHA image, deploys secrets/workloads, and waits for Kubernetes health.
5. On first deployment, use the ingress load-balancer hostname printed by the workflow to create a CNAME for `SHOP_HOST`. Re-run after DNS resolves so cert-manager can issue the TLS certificate.
6. Verify `kubectl -n retail rollout status deployment/retail`, the certificate, ingress, and `https://SHOP_HOST`.

See each project's README for exact prerequisites and variable tables. Do not copy passwords or Terraform state into source control. The Terraform backends must exist before CI can initialize Terraform.

## Kubernetes operations

Both `k8s/` folders have a Kustomize base with:

- Namespace with Kubernetes restricted Pod Security enforcement.
- Deployment with non-root UID, read-only root filesystem, dropped Linux capabilities, resource requests/limits, and HTTP readiness/liveness probes.
- ClusterIP Service and nginx Ingress with TLS/cert-manager issuer.
- HorizontalPodAutoscaler (2–8 replicas), PodDisruptionBudget, and ingress-only NetworkPolicy.
- External database credentials supplied through Kubernetes Secrets; no production DB password is stored in YAML.

Install nginx ingress and cert-manager before applying the issuer/Ingress. Configure a real DNS hostname and ACME contact email; HTTP-01 certificate issuance requires the DNS name to resolve publicly to the ingress controller. The AWS workflow also needs EKS IAM cluster access; Azure pipeline needs Azure Kubernetes Service RBAC Cluster Admin for its service principal. Refer to [food Kubernetes guide](./food-delivery-azure/k8s/README.md) and [retail Kubernetes guide](./retail-ecommerce-aws/k8s/README.md).

## Security and production scope

- Customer order lookups require both an order number and checkout email; lookup results omit customer email/address.
- Staff order/inventory endpoints require an admin token; local Compose uses a demo-only token. Cloud values are stored in Azure pipeline secrets or AWS Secrets Manager and injected into Kubernetes at deploy time.
- Configure and verify TLS before entering staff credentials. Use a proper login/OIDC provider, role-based permissions, rate limiting, and audit logs for real users.
- PostgreSQL is private in the cloud and the app requires SSL for database connections.
- Kubernetes NetworkPolicy requires CNI enforcement; validate the selected cloud cluster's enforcement and ingress namespace labels.
- Add database migrations, monitoring/alerts, backups/restore tests, image signing, secrets CSI integration, and disaster recovery before production use.
- Prices are sample USD amounts. No payment is captured and no real delivery/shipping is integrated.

## Cost and cleanup

AKS/EKS clusters, managed database instances, NAT gateway, public load balancers, storage, and logs can incur charges even when the demos are idle. Review provider pricing and `terraform plan` before applying.

To delete one cloud environment, use that project's remote backend and review a destroy plan carefully:

```bash
cd <project>/infra/terraform
terraform plan -destroy
terraform destroy
```

Destroying infrastructure can delete databases and orders. Back up/export data first. Keep or separately clean Terraform state backend resources according to your organization's retention policy.
