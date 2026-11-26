# Azure infrastructure (Terraform)

Terraform provisions a dedicated VNet, delegated private PostgreSQL subnet and DNS zone, private Azure Database for PostgreSQL, ACR, AKS with autoscaling system nodes, and the AKS kubelet's least-purpose `AcrPull` assignment. PostgreSQL has public access disabled.

## Prerequisites

- Terraform 1.6+, Azure CLI, `kubectl`, an Azure subscription, and an existing resource group. In Azure DevOps, install the Terraform Installer extension that provides `TerraformInstaller@1`; `HelmInstaller@1` is used for Helm.
- An Azure identity authorized to create networking, AKS, PostgreSQL, ACR, and role assignments in the subscription/resource group.
- The identity's service-principal object ID (for the role assignments granted to the CI principal).
- Create an Azure Storage Account and private blob container for Terraform remote state. The Azure DevOps service connection needs blob data access (for example, Storage Blob Data Contributor) on that container.

## Deploy

```bash
az login
az group create --name rg-food-delivery-dev --location eastus
cd food-delivery-azure/infra/terraform
export TF_VAR_subscription_id="$(az account show --query id -o tsv)"
export TF_VAR_resource_group_name="rg-food-delivery-dev"
export TF_VAR_project_name="fooddelivery123"
export TF_VAR_location="eastus"
export TF_VAR_pipeline_principal_id="SERVICE_PRINCIPAL_OBJECT_ID"
export TF_VAR_database_password='use-a-unique-secret-value'
terraform init \
  -backend-config="resource_group_name=STATE_RESOURCE_GROUP" \
  -backend-config="storage_account_name=STATE_STORAGE_ACCOUNT" \
  -backend-config="container_name=STATE_CONTAINER" \
  -backend-config="key=food-delivery/dev.tfstate" \
  -backend-config="use_azuread_auth=true"
terraform fmt -recursive
terraform validate
terraform plan
terraform apply
```

The plan creates billable Azure resources (including a two-node AKS cluster and managed PostgreSQL). Review cost estimates before applying. To connect:

```bash
az aks get-credentials --resource-group rg-food-delivery-dev --name "$(terraform output -raw aks_name)"
```

`acr_name`, `acr_login_server`, `postgres_host`, `postgres_database`, and `postgres_username` are Terraform outputs. Keep the database password only in your secret manager/CI variables. The CI identity must also be authorized for Azure RBAC cluster access; Azure subscription permissions alone do not automatically grant Kubernetes access.

## Azure DevOps pipeline

Create a secret variable group named `food-delivery-secrets` with `FOOD_DB_PASSWORD` and `FOOD_ADMIN_TOKEN`; create pipeline variables `AZURE_SERVICE_CONNECTION`, `AZURE_RESOURCE_GROUP`, `AZURE_PIPELINE_PRINCIPAL_ID`, `FOOD_PROJECT_NAME`, `AZURE_LOCATION`, `TF_STATE_RESOURCE_GROUP`, `TF_STATE_STORAGE_ACCOUNT`, `TF_STATE_CONTAINER`, `FOOD_APP_HOST`, and `ACME_EMAIL`. The Azure Resource Manager service connection needs infrastructure/role-assignment permissions and the Terraform state container's blob data role. Add `food-delivery-azure/azure-pipelines.yml` as the pipeline. It tests, provisions the infrastructure, builds/pushes the image through ACR Tasks, installs nginx ingress and cert-manager, creates the runtime secret from protected variables, and rolls out the app to AKS on `main`. DNS for `FOOD_APP_HOST` must resolve to the ingress IP before Let's Encrypt can issue the TLS certificate; the first pipeline run prints the IP and may stop at certificate readiness, so create DNS and rerun.
