variable "subscription_id" {
  description = "Azure subscription ID used by the provider."
  type        = string
}

variable "resource_group_name" {
  description = "Existing resource group for this project."
  type        = string
}

variable "pipeline_principal_id" {
  description = "Object ID of the Azure DevOps service principal. It receives AKS cluster-admin and ACR push/build permissions."
  type        = string
}

variable "project_name" {
  description = "3-15 character lowercase name prefix; the ACR name must be globally unique."
  type        = string
  default     = "fooddelivery"
  validation {
    condition     = can(regex("^[a-z0-9]{3,15}$", var.project_name))
    error_message = "project_name must contain 3-15 lowercase letters or digits."
  }
}

variable "environment" {
  description = "Environment name used for resource tags."
  type        = string
  default     = "dev"
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "eastus"
}

variable "database_password" {
  description = "PostgreSQL administrator password. Supply through TF_VAR_database_password or a secret variable."
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.database_password) >= 12
    error_message = "database_password must be at least 12 characters."
  }
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
