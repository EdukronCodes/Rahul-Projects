output "aks_subnet_id" {
  value = azurerm_subnet.aks.id
}

output "database_subnet_id" {
  value = azurerm_subnet.database.id
}

output "database_private_dns_zone_id" {
  value = azurerm_private_dns_zone.postgres.id
}
