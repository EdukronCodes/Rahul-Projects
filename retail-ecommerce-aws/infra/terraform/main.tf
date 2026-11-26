data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  name = "${var.project_name}-${var.environment}"
}

module "network" {
  source      = "./modules/network"
  name        = local.name
  environment = var.environment
}

module "registry" {
  source      = "./modules/registry"
  name        = "${local.name}-app"
  environment = var.environment
}

module "cluster" {
  source             = "./modules/cluster"
  name               = "${local.name}-eks"
  environment        = var.environment
  private_subnet_ids = module.network.private_subnet_ids
  public_subnet_ids  = module.network.public_subnet_ids
  kubernetes_version = var.kubernetes_version
}

resource "random_password" "database" {
  length           = 32
  special          = false
  override_special = ""
}

resource "random_password" "admin_token" {
  length           = 48
  special          = false
  override_special = ""
}

resource "aws_secretsmanager_secret" "database" {
  name                    = "${local.name}/database"
  description             = "Credentials for the retail PostgreSQL database."
  recovery_window_in_days = var.environment == "prod" ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "database" {
  secret_id = aws_secretsmanager_secret.database.id
  secret_string = jsonencode({
    username    = "retailadmin"
    password    = random_password.database.result
    database    = "retail"
    admin_token = random_password.admin_token.result
  })
}

module "database" {
  source                    = "./modules/database"
  name                      = "${local.name}-db"
  environment               = var.environment
  vpc_id                    = module.network.vpc_id
  private_subnet_ids        = module.network.private_subnet_ids
  database_password         = random_password.database.result
  allowed_security_group_id = module.cluster.cluster_security_group_id
}

resource "aws_eks_access_entry" "deployment" {
  cluster_name      = module.cluster.name
  principal_arn     = var.deployment_role_arn
  kubernetes_groups = []
  type              = "STANDARD"
}

resource "aws_eks_access_policy_association" "deployment_admin" {
  cluster_name  = module.cluster.name
  principal_arn = var.deployment_role_arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
  access_scope {
    type = "cluster"
  }
  depends_on = [aws_eks_access_entry.deployment]
}
