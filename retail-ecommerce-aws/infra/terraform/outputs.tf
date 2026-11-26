output "ecr_repository_url" {
  description = "ECR repository URI for application images."
  value       = module.registry.repository_url
}

output "ecr_repository_name" {
  value = module.registry.repository_name
}

output "eks_cluster_name" {
  value = module.cluster.name
}

output "rds_endpoint" {
  description = "Private PostgreSQL endpoint hostname."
  value       = module.database.endpoint
}

output "database_secret_arn" {
  description = "Secrets Manager secret containing the database name and credentials."
  value       = aws_secretsmanager_secret.database.arn
}

output "aws_account_id" {
  value = data.aws_caller_identity.current.account_id
}

output "aws_region" {
  value = data.aws_region.current.name
}
