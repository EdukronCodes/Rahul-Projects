locals {
  name = lower(replace(var.project_name, "/[^a-z0-9-]/", "-"))
  tags = merge(var.tags, {
    project     = "food-delivery"
    environment = var.environment
    managed_by  = "terraform"
  })
}

module "network" {
  source              = "./modules/network"
  name                = local.name
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = local.tags
}

module "registry" {
  source              = "./modules/registry"
  name                = local.name
  location            = var.location
  resource_group_name = var.resource_group_name
  pipeline_principal_id = var.pipeline_principal_id
  tags                = local.tags
}

module "database" {
  source                 = "./modules/database"
  name                   = local.name
  location               = var.location
  resource_group_name    = var.resource_group_name
  delegated_subnet_id    = module.network.database_subnet_id
  private_dns_zone_id    = module.network.database_private_dns_zone_id
  administrator_password = var.database_password
  tags                   = local.tags
}

module "cluster" {
  source              = "./modules/cluster"
  name                = local.name
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = module.network.aks_subnet_id
  registry_id         = module.registry.id
  pipeline_principal_id = var.pipeline_principal_id
  tags                = local.tags
}
