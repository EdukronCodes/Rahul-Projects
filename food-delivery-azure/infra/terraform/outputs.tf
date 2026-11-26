output "acr_name" {
  description = "Azure Container Registry name."
  value       = module.registry.name
}

output "acr_login_server" {
  description = "Registry hostname used in image tags."
  value       = module.registry.login_server
}

output "aks_name" {
  description = "AKS cluster name."
  value       = module.cluster.name
}

output "postgres_host" {
  description = "Private PostgreSQL hostname."
  value       = module.database.fqdn
}

output "postgres_database" {
  description = "Application database."
  value       = module.database.database_name
}

output "postgres_username" {
  description = "Database application/admin username."
  value       = module.database.administrator_login
}
