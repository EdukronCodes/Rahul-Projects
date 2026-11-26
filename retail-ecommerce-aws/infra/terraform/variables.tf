variable "aws_region" {
  description = "AWS region to provision resources in."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short lowercase project name used to prefix resources."
  type        = string
  default     = "retail"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,14}$", var.project_name))
    error_message = "project_name must be 2-15 lowercase letters, digits, or hyphens and start with a letter."
  }
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "dev"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "kubernetes_version" {
  description = "EKS Kubernetes minor version supported in the selected region."
  type        = string
  default     = "1.31"
}

variable "deployment_role_arn" {
  description = "Existing GitHub Actions OIDC IAM role ARN; Terraform grants it EKS cluster admin access."
  type        = string
}
