variable "name" { type = string }
variable "environment" { type = string }
variable "kubernetes_version" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "private_subnet_ids" { type = list(string) }
