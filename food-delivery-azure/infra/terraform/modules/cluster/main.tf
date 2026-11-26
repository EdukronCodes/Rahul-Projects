resource "azurerm_kubernetes_cluster" "this" {
  name                = "${var.name}-aks"
  location            = var.location
  resource_group_name = var.resource_group_name
  dns_prefix          = "${var.name}-aks"
  sku_tier            = "Free"
  tags                = var.tags

  default_node_pool {
    name                = "system"
    vm_size             = "Standard_D2s_v3"
    node_count          = 2
    min_count           = 2
    max_count           = 4
    auto_scaling_enabled = true
    vnet_subnet_id      = var.subnet_id
    os_disk_size_gb     = 64
    only_critical_addons_enabled = true
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin      = "azure"
    network_plugin_mode = "overlay"
    network_policy      = "azure"
    load_balancer_sku   = "standard"
    outbound_type       = "loadBalancer"
    service_cidr        = "10.41.0.0/16"
    dns_service_ip      = "10.41.0.10"
  }

  azure_active_directory_role_based_access_control {
    azure_rbac_enabled = true
    tenant_id          = data.azurerm_client_config.current.tenant_id
  }

  maintenance_window_auto_upgrade {
    frequency   = "Weekly"
    interval    = 1
    day_of_week = "Sunday"
    start_time  = "03:00"
    duration    = 4
    utc_offset  = "+00:00"
  }
}

data "azurerm_client_config" "current" {}

resource "azurerm_role_assignment" "acr_pull" {
  scope                = var.registry_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_kubernetes_cluster.this.kubelet_identity[0].object_id
  principal_type       = "ServicePrincipal"
}
