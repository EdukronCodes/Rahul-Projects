# Azure infrastructure (Terraform)

Terraform provisions a dedicated VNet, delegated private PostgreSQL subnet and DNS zone, private Azure Database for PostgreSQL, ACR, AKS with autoscaling system nodes, and the AKS kubelet's least-purpose `AcrPull` assignment. PostgreSQL has public access disabled.

## Prerequisites

- Terraform 1.6+, Azure CLI, `kubectl`, an Azure subscription, and an existing resource group.
- An Azure identity authorized to create networking, AKS, PostgreSQL, ACR, and role assignments in the subscription/resource group.
- Set up remote state before team/CI use. The example uses local state for first-time learning; do not share local state files, which can contain secrets.

## Deploy

```bash
az login
az group create --name rg-food-delivery-dev --location eastus
cd food-delivery-azure/infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit subscription_id, resource group, and globally unique project_name.
export TF_VAR_database_password='use-a-unique-secret-value'
terraform init
terraform fmt -recursive
terraform validate
terraform plan -out=infra.tfplan
terraform apply infra.tfplan
```

The plan creates billable Azure resources (including a two-node AKS cluster and managed PostgreSQL). Review cost estimates before applying. To connect:

```bash
az aks get-credentials --resource-group rg-food-delivery-dev --name "$(terraform output -raw aks_name)"
```

`acr_name`, `acr_login_server`, `postgres_host`, `postgres_database`, and `postgres_username` are Terraform outputs. Keep the database password only in your secret manager/CI variables. The CI identity must also be authorized for Azure RBAC cluster access; Azure subscription permissions alone do not automatically grant Kubernetes access.
