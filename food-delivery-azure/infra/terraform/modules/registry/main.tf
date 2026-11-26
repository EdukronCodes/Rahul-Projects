resource "azurerm_container_registry" "this" {
  name                = "${var.name}acr"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "Basic"
  admin_enabled       = false
  tags                = var.tags
}

resource "azurerm_role_assignment" "pipeline_acr_push" {
  scope                = azurerm_container_registry.this.id
  role_definition_name = "AcrPush"
  principal_id         = var.pipeline_principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_role_assignment" "pipeline_acr_tasks" {
  scope                = azurerm_container_registry.this.id
  role_definition_name = "Container Registry Tasks Contributor"
  principal_id         = var.pipeline_principal_id
  principal_type       = "ServicePrincipal"
}
