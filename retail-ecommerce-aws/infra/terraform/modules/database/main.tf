resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-subnets"
  subnet_ids = var.private_subnet_ids
  tags       = { Name = "${var.name}-subnets" }
}

resource "aws_security_group" "database" {
  name        = "${var.name}-sg"
  description = "Allow PostgreSQL only from the EKS cluster security group."
  vpc_id      = var.vpc_id
  ingress {
    description     = "PostgreSQL from EKS cluster and worker nodes."
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.allowed_security_group_id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.name}-sg" }
}

resource "aws_db_instance" "this" {
  identifier                      = var.name
  engine                          = "postgres"
  engine_version                  = "16.4"
  instance_class                  = "db.t4g.micro"
  allocated_storage               = 20
  max_allocated_storage           = 100
  storage_type                    = "gp3"
  storage_encrypted               = true
  db_name                         = "retail"
  username                        = "retailadmin"
  password                        = var.database_password
  port                            = 5432
  db_subnet_group_name            = aws_db_subnet_group.this.name
  vpc_security_group_ids          = [aws_security_group.database.id]
  publicly_accessible             = false
  multi_az                        = var.environment == "prod"
  backup_retention_period         = var.environment == "prod" ? 7 : 1
  deletion_protection             = var.environment == "prod"
  skip_final_snapshot             = var.environment != "prod"
  final_snapshot_identifier       = var.environment == "prod" ? "${var.name}-final" : null
  auto_minor_version_upgrade      = true
  apply_immediately               = var.environment != "prod"
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  tags                            = { Name = var.name }
}
