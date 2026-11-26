# AWS infrastructure (Terraform)

Terraform provisions a two-AZ VPC (public/private subnets, internet gateway, one NAT gateway), private EKS managed nodes, ECR with scan-on-push and lifecycle policy, encrypted private PostgreSQL RDS, a Secrets Manager credential, and EKS access for the existing GitHub Actions deployment role.

## Prerequisites

- Terraform 1.6+, AWS CLI, `kubectl`, and an AWS account/region with EKS, EC2, ECR, RDS, and IAM quotas.
- An existing GitHub Actions OIDC IAM role. Its trust policy must restrict `token.actions.githubusercontent.com:sub` to this repository's `repo:OWNER/REPOSITORY:ref:refs/heads/main` (and PR refs only if needed). Grant only the AWS permissions Terraform requires. This role receives cluster-admin access in the provisioned EKS cluster.
- Configure a remote encrypted S3 backend with state locking before CI/team use. Terraform state contains database secrets; restrict access and enable encryption/versioning.

## Deploy

```bash
aws configure
cd retail-ecommerce-aws/infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Set the account's existing GitHub Actions deployment role ARN.
terraform init \
  -backend-config="bucket=YOUR_STATE_BUCKET" \
  -backend-config="key=retail/dev/terraform.tfstate" \
  -backend-config="region=us-east-1" \
  -backend-config="dynamodb_table=YOUR_LOCK_TABLE" \
  -backend-config="encrypt=true"
terraform fmt -recursive
terraform validate
terraform plan -out=infra.tfplan
terraform apply infra.tfplan
```

Resources include two EKS worker nodes, one NAT Gateway, and RDS; all incur charges. Review cost and quota implications before applying. The `database_secret_arn` output points to a JSON secret (`username`, `password`, `database`) in Secrets Manager. Retrieve it with IAM only when creating the Kubernetes secret; don't print it or commit it. The Terraform-generated DB password is stored in Terraform state, so use an encrypted remote backend.

To connect:

```bash
aws eks update-kubeconfig --region "$(terraform output -raw aws_region)" --name "$(terraform output -raw eks_cluster_name)"
```

For the GitHub Actions workflow, configure repository secret `AWS_DEPLOY_ROLE_ARN` and variables `AWS_REGION`, `TF_PROJECT_NAME`, `TF_ENVIRONMENT`, `TF_STATE_BUCKET`, `TF_STATE_LOCK_TABLE`, `SHOP_HOST`, and `ACME_EMAIL`. The role trust policy must allow GitHub's OIDC provider only for this repository's `main` branch. The role also needs permission to manage the Terraform resources, publish to ECR, read the Secrets Manager secret, and use the EKS access entry Terraform creates.

The first successful cluster/ingress provisioning may not yet have public DNS. The workflow prints the ingress load-balancer hostname and then waits for the certificate; if DNS isn't routed yet, create the CNAME for `SHOP_HOST` and rerun the workflow.

For production, review EKS endpoint CIDRs, use a private-only API endpoint or restrict public CIDRs, add WAF/TLS, use multi-AZ RDS and a multi-AZ NAT design, configure deletion protection and backup retention, and use external-secrets/IRSA instead of copying database credentials into Kubernetes.
